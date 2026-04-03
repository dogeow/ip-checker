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
     * Resolve the domestic exit IP from the available mainland endpoints.
     * @param {{ id: number, signal: AbortSignal }} run
     * @returns {Promise<void>}
     */
    async function checkDomestic(run) {
      for (const api of DOMESTIC_APIS) {
        try {
          const t0 = performance.now();
          const res = await safeFetch(
            api.url,
            { signal: run.signal },
            timeouts.domestic,
          );
          if (!res.ok) continue;

          const text = await res.text();
          if (!text.trim()) continue;

          const latency = Math.round(performance.now() - t0);
          const data = api.parse(JSON.parse(text));
          if (!data.ip || !isValidIP(data.ip)) continue;

          state.setResultForRun(
            run.id,
            "domestic",
            data.ip,
            data.location,
            latency,
            new URL(api.url).hostname,
          );
          return;
        } catch (error) {
          if (isRunAborted(run.signal)) return;
        }
      }

      state.setErrorForRun(run.id, "domestic");
    }

    /**
     * Resolve the foreign exit IP and release any dependents when done.
     * @param {{ id: number, signal: AbortSignal, foreignDeferred: { resolve: () => void } }} run
     * @returns {Promise<void>}
     */
    async function checkForeign(run) {
      try {
        for (const api of FOREIGN_APIS) {
          try {
            const t0 = performance.now();
            const res = await safeFetch(
              api.url,
              { signal: run.signal },
              timeouts.foreign,
            );
            if (!res.ok) continue;

            const text = (await res.text()).trim();
            if (!text) continue;

            const latency = Math.round(performance.now() - t0);
            let ip;

            if (api.parseText) {
              ip = text.split("\n")[0].trim();
            } else {
              ip = api.parse(JSON.parse(text)).ip?.trim();
            }

            if (!ip || !isValidIP(ip)) continue;

            const location = await lookupLocation(ip, run.signal);
            state.setResultForRun(
              run.id,
              "foreign",
              ip,
              location || "",
              latency,
              new URL(api.url).hostname,
            );
            return;
          } catch (error) {
            if (isRunAborted(run.signal)) return;
          }
        }

        state.setErrorForRun(run.id, "foreign");
      } finally {
        run.foreignDeferred.resolve();
      }
    }

    /**
     * Probe Google reachability and infer the exit from the foreign result.
     * @param {{ id: number, signal: AbortSignal, foreignDeferred: { promise: Promise<void> } }} run
     * @returns {Promise<void>}
     */
    async function checkGoogle(run) {
      for (const url of GOOGLE_PROBES) {
        try {
          const t0 = performance.now();
          const res = await safeFetch(
            url,
            { mode: "no-cors", signal: run.signal },
            timeouts.foreign,
          );
          const latency = Math.round(performance.now() - t0);
          const reachable =
            res.type === "opaque" ||
            res.type === "opaqueredirect" ||
            res.ok ||
            res.status === 204;
          if (!reachable) continue;

          await run.foreignDeferred.promise;
          if (!isCurrentRun(run.id)) return;

          const foreignIp = state.results.foreign;
          const source = new URL(url).hostname;
          if (foreignIp && foreignIp !== "error") {
            const location = await lookupLocation(foreignIp, run.signal);
            state.setWarningForRun(
              run.id,
              "google",
              foreignIp,
              location || "谷歌链路可达",
              latency,
              source,
            );
          } else {
            state.setWarningForRun(
              run.id,
              "google",
              "可达（IP 推断自国外出口）",
              "",
              latency,
              source,
            );
          }
          return;
        } catch (error) {
          if (isRunAborted(run.signal)) return;
        }
      }

      state.setErrorForRun(run.id, "google", "谷歌链路不可达（疑似被拦截）");
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

  globalScope.IPCheckerDetectors = { createDetectors };
})(typeof globalThis !== "undefined" ? globalThis : window);
