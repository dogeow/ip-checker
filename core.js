"use strict";

/**
 * Register the shared pure helpers on the global scope and Node exports.
 * @param {typeof globalThis} globalScope
 */
(function initCore(globalScope) {
  const KEYS = ["domestic", "foreign", "google", "cf"];

  /**
   * Validate whether a string is a usable IPv4 or IPv6 literal.
   * @param {string} str
   * @returns {boolean}
   */
  function isValidIP(str) {
    const value = String(str || "").trim();

    const ipv4Parts = value.split(".");
    if (
      ipv4Parts.length === 4 &&
      ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ) {
      return true;
    }

    if (!value.includes(":")) return false;

    const normalized = value.replace(/^\[|\]$/g, "");
    try {
      return new URL(`http://[${normalized}]/`).hostname === `[${normalized}]`;
    } catch {
      return false;
    }
  }

  /**
   * Derive the summary banner content from the current probe results.
   * @param {Record<string, string | null>} results
   * @param {string[]} [keys]
   * @returns {{ text: string, badgeText: string, badgeClass: string }}
   */
  function summarizeResults(results, keys = KEYS) {
    const finishedCount = keys.filter((key) => results[key] !== null).length;

    if (finishedCount === 0) {
      return { text: "检测中…", badgeText: "", badgeClass: "" };
    }

    const validIps = keys
      .map((key) => results[key])
      .filter((value) => value && value !== "error");
    const uniqueCount = new Set(validIps).size;

    if (finishedCount < keys.length) {
      if (validIps.length > 0) {
        return {
          text: `已检测到 ${uniqueCount} 个出口`,
          badgeText: "检测中…",
          badgeClass: "badge-info",
        };
      }

      return { text: "检测中…", badgeText: "", badgeClass: "" };
    }

    const blockedGoogle = results.google === "error" || !results.google;
    const blockedCF = results.cf === "error" || !results.cf;
    const blockedCount = (blockedGoogle ? 1 : 0) + (blockedCF ? 1 : 0);

    if (validIps.length === 0) {
      return { text: "全部失败", badgeText: "不可用", badgeClass: "badge-diff" };
    }

    if (blockedCount === 2) {
      return {
        text: "谷歌 & CF 均被阻断",
        badgeText: "高度封锁",
        badgeClass: "badge-diff",
      };
    }

    if (blockedCount === 1) {
      return {
        text: "部分链路被阻断",
        badgeText: "部分封锁",
        badgeClass: "badge-warn",
      };
    }

    if (uniqueCount === 1) {
      return { text: "同一出口", badgeText: "直连", badgeClass: "badge-same" };
    }

    return {
      text: `检测到 ${uniqueCount} 个出口`,
      badgeText: "已分流",
      badgeClass: "badge-info",
    };
  }

  /**
   * Map a numeric latency to the UI color tier.
   * @param {number} latency
   * @returns {"good" | "mid" | "slow"}
   */
  function getLatencyTier(latency) {
    if (latency < 300) return "good";
    if (latency < 800) return "mid";
    return "slow";
  }

  /**
   * Parse the minimal fields needed from Cloudflare's trace payload.
   * @param {string} text
   * @returns {{ ip: string, countryCode: string | null } | null}
   */
  function parseCloudflareTrace(text) {
    const ipMatch = text.match(/^ip=(.+)$/m);
    if (!ipMatch) return null;

    const locMatch = text.match(/^loc=(.+)$/m);
    return {
      ip: ipMatch[1].trim(),
      countryCode: locMatch ? locMatch[1].trim() : null,
    };
  }

  const core = {
    KEYS,
    getLatencyTier,
    isValidIP,
    parseCloudflareTrace,
    summarizeResults,
  };

  globalScope.IPCheckerCore = core;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = core;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
