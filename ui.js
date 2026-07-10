"use strict";

/**
 * Register the DOM rendering facade and application state on the global scope.
 * @param {typeof globalThis} globalScope
 */
(function initUI(globalScope) {
  /**
   * Build the browser-side UI facade from reusable components.
   * @param {{
   *   keys: string[],
   *   status: Record<string, string>,
   *   isValidIP: (value: string) => boolean,
   *   summarizeResults: (results: Record<string, string | null>, keys: string[]) => { text: string, badgeText: string, badgeClass: string },
   *   getLatencyTier: (latency: number) => string,
   *   toastDurationMs: number,
   *   onComplete?: () => void,
   * }} options
   */
  function createUI({
    keys,
    status,
    isValidIP,
    summarizeResults,
    getLatencyTier,
    toastDurationMs,
    onComplete,
  }) {
    const components = globalScope.IPCheckerUIComponents;
    if (!components) throw new Error("IP Checker UI components are missing");

    const el = (id) => document.getElementById(id);
    const grid = el("result-grid");
    const summaryRoot = el("summary");
    if (!grid || !summaryRoot) throw new Error("IP Checker UI roots are missing");

    const cardRoots = components.mountResultCards(grid, keys);
    const cards = new Map(
      Array.from(cardRoots, ([key, root]) => [
        key,
        components.createResultCard({
          root,
          status,
          isValidIP,
          getLatencyTier,
        }),
      ]),
    );
    const summary = components.createSummary(summaryRoot);
    const feedback = components.createFeedback({
      toastElement: el("toast"),
      tipElement: el("copy-tip"),
      toastDurationMs,
    });
    const copyLabels = new Map(
      components
        .getCardDefinitions(keys)
        .map((definition) => [definition.key, definition.copyLabel]),
    );

    function renderCard(
      key,
      ip,
      location,
      cardStatus,
      latency = null,
      source = null,
    ) {
      cards.get(key)?.render({ ip, location, cardStatus, latency, source });
    }

    class AppState {
      constructor() {
        this.results = Object.fromEntries(keys.map((key) => [key, null]));
        this._checkTimer = null;
      }

      reset() {
        keys.forEach((key) => {
          this.results[key] = null;
        });
      }

      updateSummary() {
        const result = summarizeResults(this.results, keys);
        summary.render(result.text, result.badgeText, result.badgeClass);

        if (onComplete && keys.every((key) => this.results[key] !== null)) {
          onComplete();
        }
      }

      setResult(key, ip, location = "", latency = null, source = null) {
        this.results[key] = ip;
        renderCard(key, ip, location, status.SUCCESS, latency, source);
        this.updateSummary();
      }

      setError(key, message) {
        this.results[key] = "error";
        renderCard(key, message || "检测失败", "", status.ERROR);
        this.updateSummary();
      }

      setWarning(key, ip, location = "", latency = null, source = null) {
        this.results[key] = ip;
        renderCard(key, ip, location, status.WARN, latency, source);
        this.updateSummary();
      }
    }

    function resetUI(appState) {
      appState.reset();
      keys.forEach((key) => renderCard(key, "检测中", "", status.LOADING));
      appState.updateSummary();
    }

    function copyAllIps() {
      const entries = keys.flatMap((key) => {
        const value = cards.get(key)?.readIp();
        return value && isValidIP(value)
          ? [`${copyLabels.get(key) || key}: ${value}`]
          : [];
      });

      if (entries.length === 0) {
        feedback.showToast("暂无可复制的 IP");
        return;
      }
      void feedback.copyToClipboard(entries.join("\n"));
    }

    return {
      AppState,
      copyAllIps,
      copyToClipboard: feedback.copyToClipboard,
      el,
      hideTip: feedback.hideTip,
      isTouch: feedback.isTouch,
      moveTip: feedback.moveTip,
      resetUI,
      showTip: feedback.showTip,
      updateTimestamp: summary.updateTimestamp,
    };
  }

  globalScope.IPCheckerUI = { createUI };
})(typeof globalThis !== "undefined" ? globalThis : window);
