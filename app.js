// ═══════════════════════════════════════════════════════════════════════════════
// IP Checker — 浏览器端多源 IP 出口检测
// ═══════════════════════════════════════════════════════════════════════════════

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────

const KEYS = ["domestic", "foreign", "google", "cf"];

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

const CARD_GRID = document.querySelector(".card-grid");
const isTouch = !window.matchMedia("(hover: hover)").matches;
const tipEl = document.getElementById("copy-tip");

const DOMESTIC_APIS = [
  {
    url: "https://myip.ipip.net/json",
    parse: (d) => ({
      ip: d.data?.ip,
      location: (d.data?.location || []).join(" "),
    }),
  },
  {
    url: "https://ip.useragentinfo.com/json",
    parse: (d) => ({
      ip: d.ip,
      location: [d.country, d.province, d.city, d.isp]
        .filter(Boolean)
        .join(" "),
    }),
  },
  {
    url: "https://whois.pconline.com.cn/ipJson.jsp?json=true",
    parse: (d) => ({ ip: d.ip, location: d.addr || "" }),
  },
];

const FOREIGN_APIS = [
  { url: "https://api.ipify.org?format=json", parse: (d) => ({ ip: d.ip }) },
  { url: "https://api64.ipify.org?format=json", parse: (d) => ({ ip: d.ip }) },
  { url: "https://api.ip.sb/jsonip", parse: (d) => ({ ip: d.ip }) },
  { url: "https://httpbin.org/ip", parse: (d) => ({ ip: d.origin }) },
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

let currentRun = null;
const geoCache = new Map();

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

function isCurrentRun(runId) {
  return currentRun?.id === runId;
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

// ── IP Validation ────────────────────────────────────────────────────────────

function isValidIP(str) {
  const value = str.trim();

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

// ── Geolocation ───────────────────────────────────────────────────────────────

async function lookupLocation(ip, signal) {
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const res = await safeFetch(
      `https://ipinfo.io/${ip}/json`,
      { signal },
      FOREIGN_TIMEOUT_MS,
    );
    if (res.ok) {
      const data = JSON.parse(await res.text());
      if (data.country) {
        const location = [data.country, data.region, data.city]
          .filter(Boolean)
          .join(" ");
        geoCache.set(ip, location);
        return location;
      }
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    // ignore
  }
  return null;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

/** @param {string} id */
const el = (id) => document.getElementById(id);

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

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
 * Fetch with timeout. Caller redirect option is preserved.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 */
async function safeFetch(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const guard = withTimeout(timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: combineSignals([guard.signal, options.signal]),
      cache: "no-store",
    });
  } finally {
    guard.clear();
  }
}

// ── Clipboard & Toast ─────────────────────────────────────────────────────────

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

function showToast(msg) {
  const toast = el("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(
    () => toast.classList.remove("show"),
    TOAST_DURATION_MS,
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function moveTip(x, y) {
  if (!tipEl) return;
  tipEl.style.left = `${x + 14}px`;
  tipEl.style.top = `${y - 28}px`;
}

function showTip(text, x, y) {
  if (!tipEl || isTouch) return;
  tipEl.textContent = text;
  tipEl.style.opacity = "1";
  moveTip(x, y);
}

function hideTip() {
  if (tipEl) tipEl.style.opacity = "0";
}

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

// ── State ─────────────────────────────────────────────────────────────────────

class AppState {
  constructor() {
    this.results = Object.fromEntries(KEYS.map((k) => [k, null]));
    this._checkTimer = null;
  }

  reset() {
    KEYS.forEach((k) => {
      this.results[k] = null;
    });
  }

  set(key, ip, location = "", latency = null, source = null, runId = currentRun?.id) {
    if (!isCurrentRun(runId)) return;
    this.results[key] = ip;
    renderCard(key, ip, location, STATUS.SUCCESS, latency, source);
    this._updateSummary();
  }

  setError(key, message, runId = currentRun?.id) {
    if (!isCurrentRun(runId)) return;
    this.results[key] = "error";
    renderCard(key, message || "检测失败", "", STATUS.ERROR);
    this._updateSummary();
  }

  setWarn(
    key,
    ip,
    location = "",
    latency = null,
    source = null,
    runId = currentRun?.id,
  ) {
    if (!isCurrentRun(runId)) return;
    this.results[key] = ip;
    renderCard(key, ip, location, STATUS.WARN, latency, source);
    this._updateSummary();
  }

  _updateSummary() {
    const finishedCount = KEYS.filter((k) => this.results[k] !== null).length;

    // While checking, show progress if at least one result is in.
    if (finishedCount > 0 && finishedCount < KEYS.length) {
      const validIps = KEYS.map((k) => this.results[k]).filter(
        (v) => v && v !== "error",
      );
      const uniqueCount = new Set(validIps).size;
      if (validIps.length > 0) {
        setSummaryStatus(`已检测到 ${uniqueCount} 个出口`, "检测中…", "badge-info");
      } else {
        setSummaryStatus("检测中…");
      }
      return;
    }

    if (finishedCount === 0) {
      setSummaryStatus("检测中…");
      return;
    }

    // All done — final evaluation.
    const validIps = KEYS.map((k) => this.results[k]).filter(
      (v) => v && v !== "error",
    );
    const uniqueCount = new Set(validIps).size;

    const blockedGoogle =
      this.results.google === "error" || !this.results.google;
    const blockedCF = this.results.cf === "error" || !this.results.cf;
    const blockedCount = (blockedGoogle ? 1 : 0) + (blockedCF ? 1 : 0);

    if (validIps.length === 0) {
      setSummaryStatus("全部失败", "不可用", "badge-diff");
      return;
    }

    if (blockedCount === 2) {
      setSummaryStatus("谷歌 & CF 均被阻断", "高度封锁", "badge-diff");
      return;
    }

    if (blockedCount === 1) {
      setSummaryStatus("部分链路被阻断", "部分封锁", "badge-warn");
      return;
    }

    if (uniqueCount === 1) {
      setSummaryStatus("同一出口", "直连", "badge-same");
      return;
    }

    setSummaryStatus(`检测到 ${uniqueCount} 个出口`, "已分流", "badge-info");
  }
}

const state = new AppState();

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderCard(key, ip, location, status, latency = null, source = null) {
  const ipEl = el(`${key}-ip`);
  const locEl = el(`${key}-location`);
  const card = document.querySelector(`.card[data-key="${key}"]`);
  const statusDot = card?.querySelector(".card-status");
  const copyBtn = card?.querySelector(".copy-btn");

  if (copyBtn) {
    copyBtn.hidden =
      status === STATUS.LOADING ||
      status === STATUS.ERROR ||
      !isValidIP(ip);
  }

  if (ipEl) {
    if (status === STATUS.ERROR) {
      ipEl.innerHTML = `<span class="error">${escapeHtml(ip)}</span>`;
    } else if (status === STATUS.LOADING) {
      ipEl.innerHTML = ip;
    } else {
      ipEl.textContent = ip;
    }
  }

  if (locEl) locEl.textContent = location || "";

  // Latency & source meta row
  let metaEl = card?.querySelector(".card-meta");
  if (!metaEl && card) {
    metaEl = document.createElement("div");
    metaEl.className = "card-meta";
    card.appendChild(metaEl);
  }
  if (metaEl) {
    if (latency !== null && status !== STATUS.LOADING && status !== STATUS.ERROR) {
      const tier = latency < 300 ? "good" : latency < 800 ? "mid" : "slow";
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
      (status === STATUS.SUCCESS
        ? STATUS.SUCCESS
        : status === STATUS.ERROR
          ? STATUS.ERROR
          : STATUS.WARN);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function resetUI() {
  state.reset();
  KEYS.forEach((k) => {
    renderCard(k, '<span class="loading">检测中</span>', "", STATUS.LOADING);
    const card = document.querySelector(`.card[data-key="${k}"]`);
    const dot = card?.querySelector(".card-status");
    if (dot) dot.className = "card-status";
  });
  state._updateSummary();
}

// ── API Checks ────────────────────────────────────────────────────────────────

async function checkDomestic(run) {
  for (const api of DOMESTIC_APIS) {
    try {
      const t0 = performance.now();
      const res = await safeFetch(
        api.url,
        { signal: run.signal },
        DOMESTIC_TIMEOUT_MS,
      );
      if (!res.ok) continue;
      const text = await res.text();
      const latency = Math.round(performance.now() - t0);
      if (!text.trim()) continue;
      const data = api.parse(JSON.parse(text));
      if (data.ip && isValidIP(data.ip)) {
        const source = new URL(api.url).hostname;
        state.set("domestic", data.ip, data.location, latency, source, run.id);
        return;
      }
    } catch (error) {
      if (isAbortError(error)) return;
      // try next
    }
  }
  state.setError("domestic", null, run.id);
}

async function checkForeign(run) {
  try {
    for (const api of FOREIGN_APIS) {
      try {
        const t0 = performance.now();
        const res = await safeFetch(
          api.url,
          { signal: run.signal },
          FOREIGN_TIMEOUT_MS,
        );
        if (!res.ok) continue;
        const text = (await res.text()).trim();
        const latency = Math.round(performance.now() - t0);
        if (!text) continue;

        let ip;
        if (api.parseText) {
          ip = text.split("\n")[0].trim();
        } else {
          const parsed = api.parse(JSON.parse(text));
          ip = parsed.ip?.trim();
        }

        if (!ip || !isValidIP(ip)) continue;

        const source = new URL(api.url).hostname;
        const location = await lookupLocation(ip, run.signal);
        state.set("foreign", ip, location || "", latency, source, run.id);
        return;
      } catch (error) {
        if (isAbortError(error)) return;
        // try next
      }
    }

    state.setError("foreign", null, run.id);
  } finally {
    run.foreignDeferred.resolve();
  }
}

async function checkGoogle(run) {
  for (const url of GOOGLE_PROBES) {
    try {
      const t0 = performance.now();
      const res = await safeFetch(
        url,
        { mode: "no-cors", signal: run.signal },
        FOREIGN_TIMEOUT_MS,
      );
      const latency = Math.round(performance.now() - t0);
      const reachable =
        res.type === "opaque" ||
        res.type === "opaqueredirect" ||
        res.ok ||
        res.status === 204;
      if (reachable) {
        await run.foreignDeferred.promise;
        if (!isCurrentRun(run.id)) return;
        const source = new URL(url).hostname;
        const foreignIp = state.results.foreign;
        if (foreignIp && foreignIp !== "error") {
          const location = await lookupLocation(foreignIp, run.signal);
          state.setWarn(
            "google",
            foreignIp,
            location || "谷歌链路可达",
            latency,
            source,
            run.id,
          );
        } else {
          state.setWarn(
            "google",
            "可达（IP 推断自国外出口）",
            "",
            latency,
            source,
            run.id,
          );
        }
        return;
      }
    } catch (error) {
      if (isAbortError(error)) return;
      // try next
    }
  }

  state.setError("google", "谷歌链路不可达（疑似被拦截）", run.id);
}

async function checkCloudflare(run) {
  let cfIp = null;
  let countryCode = null;
  let latency = null;
  let source = null;

  // 1) CF trace for IP and country
  for (const url of CF_TRACES) {
    try {
      const t0 = performance.now();
      const res = await safeFetch(
        url,
        { signal: run.signal },
        FOREIGN_TIMEOUT_MS,
      );
      latency = Math.round(performance.now() - t0);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;

      const ipMatch = text.match(/^ip=(.+)$/m);
      const locMatch = text.match(/^loc=(.+)$/m);
      if (ipMatch) {
        cfIp = ipMatch[1].trim();
        countryCode = locMatch ? locMatch[1].trim() : null;
        source = new URL(url).hostname;
        break;
      }
    } catch (error) {
      if (isAbortError(error)) return;
      // try next
    }
  }

  if (!cfIp) {
    state.setError("cf", "Cloudflare 链路不可达", run.id);
    return;
  }

  // 2) City-level geolocation lookup
  const location = await lookupLocation(cfIp, run.signal);
  if (location) {
    state.set("cf", cfIp, location, latency, source, run.id);
    return;
  }

  // 3) Fallback: country code only
  state.set("cf", cfIp, countryCode || "", latency, source, run.id);
}

// ── Orchestration ─────────────────────────────────────────────────────────────

function checkAll() {
  const btn = el("refresh-btn");
  if (state._checkTimer) return;

  const run = createRunContext();

  const releaseTimer = setTimeout(() => {
    if (!isCurrentRun(run.id) || state._checkTimer !== releaseTimer) return;
    state._checkTimer = null;
    btn?.classList.remove("spinning");
    btn?.removeAttribute("disabled");
  }, REFRESH_DEBOUNCE_MS);

  state._checkTimer = releaseTimer;

  btn?.classList.add("spinning");
  btn?.setAttribute("disabled", "true");

  resetUI();
  void Promise.allSettled([
    checkDomestic(run),
    checkForeign(run),
    checkGoogle(run),
    checkCloudflare(run),
  ]);
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

el("refresh-btn")?.addEventListener("click", checkAll);

// Delegated copy buttons
document.querySelector(".card-grid")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  const targetId = btn.dataset.copyTarget;
  const ipEl = el(targetId);
  if (!ipEl) return;

  // Extract plain text (strip tags / type badge)
  const text = ipEl.textContent?.trim();
  if (!text || !isValidIP(text)) return;

  copyToClipboard(text);
});

// Tooltip for copy buttons (desktop hover)
document.querySelector(".card-grid")?.addEventListener("mouseover", (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn || isTouch) return;
  showTip("点击复制", e.clientX, e.clientY);
});

document.querySelector(".card-grid")?.addEventListener("mousemove", (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn || isTouch) return;
  moveTip(e.clientX, e.clientY);
});

document.querySelector(".card-grid")?.addEventListener("mouseout", (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  hideTip();
});

// Also allow clicking the IP text itself to copy (legacy UX)
document.querySelector(".card-grid")?.addEventListener("click", (e) => {
  const ipEl = e.target.closest(".ip-display");
  if (!ipEl) return;
  // Don't intercept if we clicked the copy button (already handled)
  if (e.target.closest(".copy-btn")) return;

  const text = ipEl.textContent?.trim();
  if (!text || !isValidIP(text)) return;
  copyToClipboard(text);
});

// ── Init ──────────────────────────────────────────────────────────────────────

checkAll();
