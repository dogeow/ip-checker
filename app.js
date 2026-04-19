// ═══════════════════════════════════════════════════════════════════════════════
// IP Checker — 浏览器端多源 IP 出口检测
// ═══════════════════════════════════════════════════════════════════════════════

"use strict";

const core = globalThis.IPCheckerCore;
const browserUtils = globalThis.IPCheckerBrowserUtils;
const uiModule = globalThis.IPCheckerUI;
const detectorModule = globalThis.IPCheckerDetectors;

if (!core || !browserUtils || !uiModule || !detectorModule) {
  throw new Error("IP Checker dependencies are missing");
}

const STATUS = {
  SUCCESS: "success",
  ERROR: "error",
  WARN: "warn",
  LOADING: "",
};

const API_TIMEOUT_MS = 8000;
const DOMESTIC_TIMEOUT_MS = 6000;
const FOREIGN_TIMEOUT_MS = 7000;
const TOAST_DURATION_MS = 1800;
const REFRESH_DEBOUNCE_MS = 1200;

const {
  combineSignals,
  createDeferred,
  createGeoLookup,
  createSafeFetch,
  isRunAborted,
} = browserUtils;

const ui = uiModule.createUI({
  keys: core.KEYS,
  status: STATUS,
  isValidIP: core.isValidIP,
  summarizeResults: core.summarizeResults,
  getLatencyTier: core.getLatencyTier,
  toastDurationMs: TOAST_DURATION_MS,
});

const safeFetch = createSafeFetch(API_TIMEOUT_MS);
const lookupLocation = createGeoLookup({
  safeFetch,
  timeoutMs: FOREIGN_TIMEOUT_MS,
});

let currentRun = null;
const state = new ui.AppState();

/**
 * Check whether an async callback still belongs to the active run.
 * @param {number} runId
 * @returns {boolean}
 */
function isCurrentRun(runId) {
  return currentRun?.id === runId;
}

const guardedState = {
  /**
   * Expose raw results for detectors that depend on another probe's output.
   * @returns {Record<string, string | null>}
   */
  get results() {
    return state.results;
  },
  /**
   * Commit a successful detector result only if it belongs to the active run.
   * @param {number} runId
   * @param {string} key
   * @param {string} ip
   * @param {string} [location]
   * @param {number | null} [latency]
   * @param {string | null} [source]
   */
  setResultForRun(runId, key, ip, location = "", latency = null, source = null) {
    if (!isCurrentRun(runId)) return;
    state.setResult(key, ip, location, latency, source);
  },
  /**
   * Commit an error state only if it belongs to the active run.
   * @param {number} runId
   * @param {string} key
   * @param {string} [message]
   */
  setErrorForRun(runId, key, message) {
    if (!isCurrentRun(runId)) return;
    state.setError(key, message);
  },
  /**
   * Commit a warning state only if it belongs to the active run.
   * @param {number} runId
   * @param {string} key
   * @param {string} ip
   * @param {string} [location]
   * @param {number | null} [latency]
   * @param {string | null} [source]
   */
  setWarningForRun(runId, key, ip, location = "", latency = null, source = null) {
    if (!isCurrentRun(runId)) return;
    state.setWarning(key, ip, location, latency, source);
  },
};

const detectors = detectorModule.createDetectors({
  combineSignals,
  isCurrentRun,
  isRunAborted,
  isValidIP: core.isValidIP,
  lookupLocation,
  parseCloudflareTrace: core.parseCloudflareTrace,
  safeFetch,
  state: guardedState,
  timeouts: {
    domestic: DOMESTIC_TIMEOUT_MS,
    foreign: FOREIGN_TIMEOUT_MS,
  },
});

/**
 * Create a new detection run and cancel any older run still in flight.
 * @returns {{ id: number, controller: AbortController, signal: AbortSignal, foreignDeferred: { promise: Promise<void>, resolve: () => void } }}
 */
function createRunContext() {
  const nextId = (currentRun?.id || 0) + 1;

  if (currentRun) {
    currentRun.foreignDeferred.resolve();
    currentRun.controller.abort();
  }

  const controller = new AbortController();
  const run = {
    id: nextId,
    controller,
    signal: controller.signal,
    foreignDeferred: createDeferred(),
  };

  currentRun = run;
  return run;
}

/**
 * Start a full detection round and update the refresh button state.
 */
function checkAll() {
  const refreshButton = ui.el("refresh-btn");
  if (state._checkTimer) return;

  const run = createRunContext();

  const releaseTimer = setTimeout(() => {
    if (!isCurrentRun(run.id) || state._checkTimer !== releaseTimer) return;
    state._checkTimer = null;
    refreshButton?.classList.remove("spinning");
    refreshButton?.removeAttribute("disabled");
  }, REFRESH_DEBOUNCE_MS);

  state._checkTimer = releaseTimer;

  refreshButton?.classList.add("spinning");
  refreshButton?.setAttribute("disabled", "true");

  ui.resetUI(state);
  void detectors.checkAllDetectors(run);
}

/**
 * Wire DOM events for refresh, copy, and desktop tooltip behavior.
 */
function bindEvents() {
  const cardGrid = document.querySelector(".card-grid");
  ui.el("refresh-btn")?.addEventListener("click", checkAll);

  cardGrid?.addEventListener("click", (event) => {
    const button = event.target.closest(".copy-btn");
    if (!button) return;

    const targetId = button.dataset.copyTarget;
    const ipText = ui.el(targetId)?.textContent?.trim();
    if (!ipText || !core.isValidIP(ipText)) return;

    ui.copyToClipboard(ipText);
  });

  cardGrid?.addEventListener("mouseover", (event) => {
    const button = event.target.closest(".copy-btn");
    if (!button || ui.isTouch) return;
    ui.showTip("点击复制", event.clientX, event.clientY);
  });

  cardGrid?.addEventListener("mousemove", (event) => {
    const button = event.target.closest(".copy-btn");
    if (!button || ui.isTouch) return;
    ui.moveTip(event.clientX, event.clientY);
  });

  cardGrid?.addEventListener("mouseout", (event) => {
    if (!event.target.closest(".copy-btn")) return;
    ui.hideTip();
  });

  cardGrid?.addEventListener("click", (event) => {
    const ipDisplay = event.target.closest(".ip-display");
    if (!ipDisplay || event.target.closest(".copy-btn")) return;

    const ipText = ipDisplay.textContent?.trim();
    if (!ipText || !core.isValidIP(ipText)) return;

    ui.copyToClipboard(ipText);
  });
}

bindEvents();
checkAll();
