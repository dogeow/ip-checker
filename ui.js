"use strict";

/**
 * Register the DOM rendering and interaction helpers on the global scope.
 * @param {typeof globalThis} globalScope
 */
(function initUI(globalScope) {
  /**
   * Build the browser-side UI helpers and state container.
   * @param {{
   *   keys: string[],
   *   status: Record<string, string>,
   *   isValidIP: (value: string) => boolean,
   *   summarizeResults: (results: Record<string, string | null>, keys: string[]) => { text: string, badgeText: string, badgeClass: string },
   *   getLatencyTier: (latency: number) => string,
   *   toastDurationMs: number,
   * }} options
   * @returns {{
   *   AppState: typeof AppState,
   *   copyToClipboard: (text: string) => Promise<boolean>,
   *   hideTip: () => void,
   *   isTouch: boolean,
   *   moveTip: (x: number, y: number) => void,
   *   resetUI: (appState: AppState) => void,
   *   showTip: (text: string, x: number, y: number) => void,
   *   el: (id: string) => HTMLElement | null,
   * }}
   */
  function createUI({
    keys,
    status,
    isValidIP,
    summarizeResults,
    getLatencyTier,
    toastDurationMs,
  }) {
    const isTouch = !window.matchMedia("(hover: hover)").matches;
    const tipEl = document.getElementById("copy-tip");

    /**
     * Fetch a DOM node by id.
     * @param {string} id
     * @returns {HTMLElement | null}
     */
    const el = (id) => document.getElementById(id);

    /**
     * Show a transient toast message near the bottom of the page.
     * @param {string} message
     */
    function showToast(message) {
      const toast = el("toast");
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(
        () => toast.classList.remove("show"),
        toastDurationMs,
      );
    }

    /**
     * Copy text using a hidden textarea when the Clipboard API is unavailable.
     * @param {string} text
     * @returns {boolean}
     */
    function fallbackCopyToClipboard(text) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        textarea.remove();
      }

      return copied;
    }

    /**
     * Copy text and surface the result through the toast UI.
     * @param {string} text
     * @returns {Promise<boolean>}
     */
    async function copyToClipboard(text) {
      try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else if (!fallbackCopyToClipboard(text)) {
          throw new Error("Clipboard API unavailable");
        }
        showToast(`已复制: ${text}`);
        return true;
      } catch {
        showToast("复制失败");
        return false;
      }
    }

    /**
     * Move the desktop-only tooltip alongside the cursor.
     * @param {number} x
     * @param {number} y
     */
    function moveTip(x, y) {
      if (!tipEl) return;
      tipEl.style.left = `${x + 14}px`;
      tipEl.style.top = `${y - 28}px`;
    }

    /**
     * Reveal the desktop-only tooltip with a short hint.
     * @param {string} text
     * @param {number} x
     * @param {number} y
     */
    function showTip(text, x, y) {
      if (!tipEl || isTouch) return;
      tipEl.textContent = text;
      tipEl.style.opacity = "1";
      moveTip(x, y);
    }

    /**
     * Hide the desktop-only copy tooltip.
     */
    function hideTip() {
      if (tipEl) tipEl.style.opacity = "0";
    }

    /**
     * Render the summary banner text and optional badge.
     * @param {string} text
     * @param {string} [badgeText]
     * @param {string} [badgeClass]
     */
    function setSummaryStatus(text, badgeText = "", badgeClass = "") {
      const statusEl = el("summary-status");
      if (!statusEl) return;

      statusEl.textContent = text;
      if (!badgeText) return;

      const badge = document.createElement("span");
      badge.className = `badge ${badgeClass}`;
      badge.textContent = badgeText;
      statusEl.append(" ", badge);
    }

    /**
     * Escape user-visible text before inserting it through innerHTML.
     * @param {string} text
     * @returns {string}
     */
    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    /**
     * Render a single result card, including its latency and source metadata.
     * @param {string} key
     * @param {string} ip
     * @param {string} location
     * @param {string} cardStatus
     * @param {number | null} [latency]
     * @param {string | null} [source]
     */
    function renderCard(key, ip, location, cardStatus, latency = null, source = null) {
      const ipEl = el(`${key}-ip`);
      const locEl = el(`${key}-location`);
      const card = document.querySelector(`.card[data-key="${key}"]`);
      const statusDot = card?.querySelector(".card-status");
      const copyBtn = card?.querySelector(".copy-btn");

      if (copyBtn) {
        copyBtn.hidden =
          cardStatus === status.LOADING ||
          cardStatus === status.ERROR ||
          !isValidIP(ip);
      }

      if (ipEl) {
        if (cardStatus === status.ERROR) {
          ipEl.innerHTML = `<span class="error">${escapeHtml(ip)}</span>`;
        } else if (cardStatus === status.LOADING) {
          ipEl.innerHTML = ip;
        } else {
          ipEl.textContent = ip;
        }
      }

      if (locEl) locEl.textContent = location || "";

      let metaEl = card?.querySelector(".card-meta");
      if (!metaEl && card) {
        metaEl = document.createElement("div");
        metaEl.className = "card-meta";
        card.appendChild(metaEl);
      }

      if (metaEl) {
        if (latency !== null && cardStatus !== status.LOADING && cardStatus !== status.ERROR) {
          const tier = getLatencyTier(latency);
          metaEl.textContent = "";

          const latencyEl = document.createElement("span");
          latencyEl.className = `latency ${tier}`;
          latencyEl.textContent = `${latency} ms`;
          metaEl.appendChild(latencyEl);

          if (source) {
            const sourceEl = document.createElement("span");
            sourceEl.className = "api-source";
            sourceEl.textContent = source;
            metaEl.appendChild(sourceEl);
          }
        } else {
          metaEl.textContent = "";
        }
      }

      if (statusDot) {
        statusDot.className =
          "card-status " +
          (cardStatus === status.SUCCESS
            ? status.SUCCESS
            : cardStatus === status.ERROR
              ? status.ERROR
              : status.WARN);
      }
    }

    class AppState {
      /**
       * Initialize the per-card result state and refresh timer handle.
       */
      constructor() {
        this.results = Object.fromEntries(keys.map((key) => [key, null]));
        this._checkTimer = null;
      }

      /**
       * Clear all card results before a fresh detection round starts.
       */
      reset() {
        keys.forEach((key) => {
          this.results[key] = null;
        });
      }

      /**
       * Recompute and render the summary banner from the latest results.
       */
      updateSummary() {
        const summary = summarizeResults(this.results, keys);
        setSummaryStatus(summary.text, summary.badgeText, summary.badgeClass);
      }

      /**
       * Store and render a successful result for one card.
       * @param {string} key
       * @param {string} ip
       * @param {string} [location]
       * @param {number | null} [latency]
       * @param {string | null} [source]
       */
      setResult(key, ip, location = "", latency = null, source = null) {
        this.results[key] = ip;
        renderCard(key, ip, location, status.SUCCESS, latency, source);
        this.updateSummary();
      }

      /**
       * Store and render a failed result for one card.
       * @param {string} key
       * @param {string} [message]
       */
      setError(key, message) {
        this.results[key] = "error";
        renderCard(key, message || "检测失败", "", status.ERROR);
        this.updateSummary();
      }

      /**
       * Store and render a warning result for one card.
       * @param {string} key
       * @param {string} ip
       * @param {string} [location]
       * @param {number | null} [latency]
       * @param {string | null} [source]
       */
      setWarning(key, ip, location = "", latency = null, source = null) {
        this.results[key] = ip;
        renderCard(key, ip, location, status.WARN, latency, source);
        this.updateSummary();
      }
    }

    /**
     * Reset every card back to its loading state.
     * @param {AppState} appState
     */
    function resetUI(appState) {
      appState.reset();
      keys.forEach((key) => {
        renderCard(key, '<span class="loading">检测中</span>', "", status.LOADING);
        const dot = document
          .querySelector(`.card[data-key="${key}"]`)
          ?.querySelector(".card-status");
        if (dot) dot.className = "card-status";
      });
      appState.updateSummary();
    }

    return {
      AppState,
      copyToClipboard,
      hideTip,
      isTouch,
      moveTip,
      resetUI,
      showTip,
      el,
    };
  }

  globalScope.IPCheckerUI = { createUI };
})(typeof globalThis !== "undefined" ? globalThis : window);
