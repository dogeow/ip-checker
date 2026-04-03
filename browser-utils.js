"use strict";

/**
 * Register browser-side runtime helpers on the global scope.
 * @param {typeof globalThis} globalScope
 */
(function initBrowserUtils(globalScope) {
  /**
   * Create a promise that can be resolved from outside the executor.
   * @returns {{ promise: Promise<void>, resolve: () => void }}
   */
  function createDeferred() {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  /**
   * Check whether the current run was explicitly aborted by the app.
   * @param {AbortSignal | undefined} signal
   * @returns {boolean}
   */
  function isRunAborted(signal) {
    return Boolean(signal?.aborted);
  }

  /**
   * Build an abort signal that expires after the provided timeout.
   * @param {number} ms
   * @returns {{ signal: AbortSignal, clear: () => void }}
   */
  function withTimeout(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }

  /**
   * Merge multiple abort signals into one signal for a single request.
   * @param {(AbortSignal | undefined)[]} signals
   * @returns {AbortSignal | undefined}
   */
  function combineSignals(signals) {
    const activeSignals = signals.filter(Boolean);
    if (activeSignals.length <= 1) return activeSignals[0];

    if (typeof AbortSignal.any === "function") {
      return AbortSignal.any(activeSignals);
    }

    const controller = new AbortController();
    const abort = () => controller.abort();

    activeSignals.forEach((signal) => {
      if (signal.aborted) {
        controller.abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    });

    return controller.signal;
  }

  /**
   * Create a fetch wrapper that applies timeout and abort handling consistently.
   * @param {number} defaultTimeoutMs
   * @returns {(url: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>}
   */
  function createSafeFetch(defaultTimeoutMs) {
    /**
     * Run a fetch request with timeout and merged abort signals.
     * @param {string} url
     * @param {RequestInit} [options]
     * @param {number} [timeoutMs]
     * @returns {Promise<Response>}
     */
    return async function safeFetch(url, options = {}, timeoutMs = defaultTimeoutMs) {
      const guard = withTimeout(timeoutMs);
      try {
        return await fetch(url, {
          ...options,
          signal: combineSignals([guard.signal, options.signal]),
          cache: "no-store",
        });
      } catch (error) {
        if (guard.signal.aborted && !isRunAborted(options.signal)) {
          throw new DOMException("Request timed out", "TimeoutError");
        }
        throw error;
      } finally {
        guard.clear();
      }
    };
  }

  /**
   * Create a cached geo lookup function backed by ipinfo.io.
   * @param {{ safeFetch: (url: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>, timeoutMs: number }} options
   * @returns {(ip: string, signal?: AbortSignal) => Promise<string | null>}
   */
  function createGeoLookup({ safeFetch, timeoutMs }) {
    const geoCache = new Map();

    /**
     * Resolve an IP into a compact human-readable location string.
     * @param {string} ip
     * @param {AbortSignal} [signal]
     * @returns {Promise<string | null>}
     */
    return async function lookupLocation(ip, signal) {
      if (geoCache.has(ip)) return geoCache.get(ip);
      try {
        const res = await safeFetch(
          `https://ipinfo.io/${ip}/json`,
          { signal },
          timeoutMs,
        );
        if (!res.ok) return null;

        const data = JSON.parse(await res.text());
        if (!data.country) return null;

        const location = [data.country, data.region, data.city]
          .filter(Boolean)
          .join(" ");
        geoCache.set(ip, location);
        return location;
      } catch (error) {
        if (isRunAborted(signal)) throw error;
        return null;
      }
    };
  }

  globalScope.IPCheckerBrowserUtils = {
    createDeferred,
    createGeoLookup,
    createSafeFetch,
    isRunAborted,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
