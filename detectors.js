"use strict";

/**
 * Register the probe implementations on the global scope.
 * @param {typeof globalThis} globalScope
 */
(function initDetectors(globalScope) {
  const DOMESTIC_APIS = [
    {
      url: "https://myip.ipip.net/json",
      parse: (data) => ({
        ip: data.data?.ip,
        location: (data.data?.location || []).join(" "),
      }),
    },
    {
      url: "https://ip.useragentinfo.com/json",
      parse: (data) => ({
        ip: data.ip,
        location: [data.country, data.province, data.city, data.isp]
          .filter(Boolean)
          .join(" "),
      }),
    },
    {
      url: "https://whois.pconline.com.cn/ipJson.jsp?json=true",
      parse: (data) => ({ ip: data.ip, location: data.addr || "" }),
    },
  ];

  const FOREIGN_APIS = [
    { url: "https://api.ipify.org?format=json", parse: (data) => ({ ip: data.ip }) },
    { url: "https://api64.ipify.org?format=json", parse: (data) => ({ ip: data.ip }) },
    { url: "https://api.ip.sb/jsonip", parse: (data) => ({ ip: data.ip }) },
    { url: "https://httpbin.org/ip", parse: (data) => ({ ip: data.origin }) },
    { url: "https://checkip.amazonaws.com/", parseText: true },
    { url: "https://icanhazip.com/", parseText: true },
  ];

  const GOOGLE_PROBES = [
    "https://www.googleapis.com/generate_204",
    "https://www.google.com/generate_204",
    "https://www.gstatic.com/generate_204",
  ];

  const CF_TRACES = [
    "https://1.1.1.1/cdn-cgi/trace",
    "https://cloudflare.com/cdn-cgi/trace",
  ];

  /**
   * Build the full detector set with shared runtime dependencies.
   * @param {{
   *   combineSignals: (signals: (AbortSignal | undefined)[]) => { signal: AbortSignal | undefined, release: () => void },
   *   isCurrentRun: (runId: number) => boolean,
   *   isRunAborted: (signal?: AbortSignal) => boolean,
   *   isValidIP: (value: string) => boolean,
   *   lookupLocation: (ip: string, signal?: AbortSignal) => Promise<string | null>,
   *   parseCloudflareTrace: (text: string) => { ip: string, countryCode: string | null } | null,
   *   safeFetch: (url: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>,
   *   state: {
   *     results: Record<string, string | null>,
   *     setResultForRun: (runId: number, key: string, ip: string, location?: string, latency?: number | null, source?: string | null) => void,
   *     setErrorForRun: (runId: number, key: string, message?: string) => void,
   *     setWarningForRun: (runId: number, key: string, ip: string, location?: string, latency?: number | null, source?: string | null) => void,
   *   },
   *   timeouts: { domestic: number, foreign: number },
   * }} options
   * @returns {{ checkAllDetectors: (run: { id: number, signal: AbortSignal, foreignDeferred: { promise: Promise<void> } }) => Promise<PromiseSettledResult<void>[]> }}
   */
  function createDetectors({
    combineSignals,
    isCurrentRun,
    isRunAborted,
    isValidIP,
    lookupLocation,
    parseCloudflareTrace,
    safeFetch,
    state,
    timeouts,
  }) {
    /**
     * Probe a single IP endpoint and return the parsed IP, latency, and source.
     * Throws on any failure so it can be composed with Promise.any.
     * @param {{ url: string, parse?: (data: any) => { ip?: string, location?: string }, parseText?: boolean }} api
     * @param {AbortSignal} signal
     * @param {number} timeoutMs
     * @returns {Promise<{ ip: string, location: string, latency: number, source: string }>}
     */
    async function probeIpEndpoint(api, signal, timeoutMs) {
      const t0 = performance.now();
      const res = await safeFetch(api.url, { signal }, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = (await res.text()).trim();
      if (!text) throw new Error("empty response");

      const latency = Math.round(performance.now() - t0);
      let ip;
      let location = "";

      if (api.parseText) {
        ip = text.split("\n")[0].trim();
      } else {
        const parsed = api.parse(JSON.parse(text));
        ip = parsed.ip?.trim();
        location = parsed.location || "";
      }

      if (!ip || !isValidIP(ip)) throw new Error("invalid ip");

      return { ip, location, latency, source: new URL(api.url).hostname };
    }

    /**
     * Race multiple IP endpoints; resolve with the first success, abort the rest.
     * @param {Array<{ url: string, parse?: (data: any) => { ip?: string, location?: string }, parseText?: boolean }>} apis
     * @param {AbortSignal} runSignal
     * @param {number} timeoutMs
     * @returns {Promise<{ ip: string, location: string, latency: number, source: string } | null>}
     */
    async function raceIpEndpoints(apis, runSignal, timeoutMs) {
      const inner = new AbortController();
      const composite = combineSignals([runSignal, inner.signal]);
      const signal = composite.signal ?? inner.signal;

      try {
        const attempts = apis.map((api) => probeIpEndpoint(api, signal, timeoutMs));
        return await Promise.any(attempts);
      } catch {
        return null;
      } finally {
        inner.abort();
        composite.release();
      }
    }

    /**
     * Resolve the domestic exit IP from the available mainland endpoints.
     * @param {{ id: number, signal: AbortSignal }} run
     * @returns {Promise<void>}
     */
    async function checkDomestic(run) {
      const winner = await raceIpEndpoints(DOMESTIC_APIS, run.signal, timeouts.domestic);
      if (isRunAborted(run.signal)) return;

      if (!winner) {
        state.setErrorForRun(run.id, "domestic");
        return;
      }

      state.setResultForRun(
        run.id,
        "domestic",
        winner.ip,
        winner.location,
        winner.latency,
        winner.source,
      );
    }

    /**
     * Resolve the foreign exit IP and release any dependents when done.
     * @param {{ id: number, signal: AbortSignal, foreignDeferred: { resolve: () => void } }} run
     * @returns {Promise<void>}
     */
    async function checkForeign(run) {
      try {
        const winner = await raceIpEndpoints(FOREIGN_APIS, run.signal, timeouts.foreign);
        if (isRunAborted(run.signal)) return;

        if (!winner) {
          state.setErrorForRun(run.id, "foreign");
          return;
        }

        const location = await lookupLocation(winner.ip, run.signal);
        state.setResultForRun(
          run.id,
          "foreign",
          winner.ip,
          location || winner.location || "",
          winner.latency,
          winner.source,
        );
      } finally {
        run.foreignDeferred.resolve();
      }
    }

    // Responses below this floor are suspected of being local DNS interception
    // rather than a genuine Google reply, so we reject them.
    const GOOGLE_MIN_LATENCY_MS = 5;

    /**
     * Fire one Google probe and classify the outcome.
     * @param {string} url
     * @param {AbortSignal} signal
     * @returns {Promise<{ url: string, latency: number, reachable: boolean }>}
     */
    async function probeGoogle(url, signal) {
      const t0 = performance.now();
      const res = await safeFetch(
        url,
        { mode: "no-cors", signal },
        timeouts.foreign,
      );
      const latency = Math.round(performance.now() - t0);
      const opaque = res.type === "opaque" || res.type === "opaqueredirect";
      const reachable = opaque && latency >= GOOGLE_MIN_LATENCY_MS;
      return { url, latency, reachable };
    }

    /**
     * Probe Google reachability and infer the exit from the foreign result.
     * @param {{ id: number, signal: AbortSignal, foreignDeferred: { promise: Promise<void> } }} run
     * @returns {Promise<void>}
     */
    async function checkGoogle(run) {
      const outcomes = await Promise.allSettled(
        GOOGLE_PROBES.map((url) => probeGoogle(url, run.signal)),
      );
      if (isRunAborted(run.signal)) return;

      const successes = outcomes
        .filter((o) => o.status === "fulfilled" && o.value.reachable)
        .map((o) => o.value)
        .sort((a, b) => a.latency - b.latency);

      if (successes.length === 0) {
        state.setErrorForRun(run.id, "google", "谷歌链路不可达（疑似被拦截）");
        return;
      }

      const best = successes[0];
      const source = new URL(best.url).hostname;

      await run.foreignDeferred.promise;
      if (!isCurrentRun(run.id)) return;

      const foreignIp = state.results.foreign;
      if (foreignIp && foreignIp !== "error") {
        const location = await lookupLocation(foreignIp, run.signal);
        state.setWarningForRun(
          run.id,
          "google",
          foreignIp,
          location || "谷歌链路可达",
          best.latency,
          source,
        );
      } else {
        state.setWarningForRun(
          run.id,
          "google",
          "可达（IP 推断自国外出口）",
          "",
          best.latency,
          source,
        );
      }
    }

    /**
     * Resolve the Cloudflare exit IP from the trace endpoint family.
     * @param {{ id: number, signal: AbortSignal }} run
     * @returns {Promise<void>}
     */
    async function checkCloudflare(run) {
      let cfIp = null;
      let countryCode = null;
      let latency = null;
      let source = null;

      for (const url of CF_TRACES) {
        try {
          const t0 = performance.now();
          const res = await safeFetch(
            url,
            { signal: run.signal },
            timeouts.foreign,
          );
          if (!res.ok) continue;

          const text = await res.text();
          if (!text.trim()) continue;

          latency = Math.round(performance.now() - t0);
          const traceData = parseCloudflareTrace(text);
          if (!traceData) continue;

          cfIp = traceData.ip;
          countryCode = traceData.countryCode;
          source = new URL(url).hostname;
          break;
        } catch (error) {
          if (isRunAborted(run.signal)) return;
        }
      }

      if (!cfIp) {
        state.setErrorForRun(run.id, "cf", "Cloudflare 链路不可达");
        return;
      }

      const location = await lookupLocation(cfIp, run.signal);
      state.setResultForRun(
        run.id,
        "cf",
        cfIp,
        location || countryCode || "",
        latency,
        source,
      );
    }

    return {
      /**
       * Kick off all detectors in parallel for a single run.
       * @param {{ id: number, signal: AbortSignal, foreignDeferred: { promise: Promise<void>, resolve: () => void } }} run
       * @returns {Promise<PromiseSettledResult<void>[]>}
       */
      checkAllDetectors(run) {
        return Promise.allSettled([
          checkDomestic(run),
          checkForeign(run),
          checkGoogle(run),
          checkCloudflare(run),
        ]);
      },
    };
  }

  const detectorModule = { createDetectors };

  globalScope.IPCheckerDetectors = detectorModule;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = detectorModule;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
