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

let foreignDeferred = createDeferred();
const geoCache = {};

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ── Geolocation ───────────────────────────────────────────────────────────────

async function lookupLocation(ip) {
  if (geoCache[ip]) return geoCache[ip];
  try {
    const res = await safeFetch(
      `https://ipinfo.io/${ip}/json`,
      {},
      FOREIGN_TIMEOUT_MS,
    );
    if (res.ok) {
      const data = JSON.parse(await res.text());
      if (data.country) {
        const location = [data.country, data.region, data.city]
          .filter(Boolean)
          .join(" ");
        geoCache[ip] = location;
        return location;
      }
    }
  } catch {
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
      signal: guard.signal,
      cache: "no-store",
    });
  } finally {
    guard.clear();
  }
}

// ── Clipboard & Toast ─────────────────────────────────────────────────────────

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
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

  set(key, ip, location = "") {
    this.results[key] = ip;
    renderCard(key, ip, location, STATUS.SUCCESS);
    this._updateSummary();
  }

  setError(key, message) {
    this.results[key] = "error";
    renderCard(key, message || "检测失败", "", STATUS.ERROR);
    this._updateSummary();
  }

  setWarn(key, ip, location = "") {
    this.results[key] = ip;
    renderCard(key, ip, location, STATUS.WARN);
    this._updateSummary();
  }

  _updateSummary() {
    const statusEl = el("summary-status");
    if (!statusEl) return;

    const finishedCount = KEYS.filter((k) => this.results[k] !== null).length;

    // While checking, show progress if at least one result is in.
    if (finishedCount > 0 && finishedCount < KEYS.length) {
      const validIps = KEYS.map((k) => this.results[k]).filter(
        (v) => v && v !== "error",
      );
      const uniqueCount = new Set(validIps).size;
      if (validIps.length > 0) {
        statusEl.innerHTML = `已检测到 ${uniqueCount} 个出口 <span class="badge badge-info">检测中…</span>`;
      } else {
        statusEl.innerHTML = "检测中…";
      }
      return;
    }

    if (finishedCount === 0) {
      statusEl.innerHTML = "检测中…";
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
      statusEl.innerHTML =
        '全部失败 <span class="badge badge-diff">不可用</span>';
      return;
    }

    if (blockedCount === 2) {
      statusEl.innerHTML =
        '谷歌 & CF 均被阻断 <span class="badge badge-diff">高度封锁</span>';
      return;
    }

    if (blockedCount === 1) {
      statusEl.innerHTML =
        '部分链路被阻断 <span class="badge badge-warn">部分封锁</span>';
      return;
    }

    if (uniqueCount === 1) {
      statusEl.innerHTML =
        '同一出口 <span class="badge badge-same">直连</span>';
      return;
    }

    statusEl.innerHTML = `检测到 ${uniqueCount} 个出口 <span class="badge badge-info">已分流</span>`;
  }
}

const state = new AppState();

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderCard(key, ip, location, status) {
  const ipEl = el(`${key}-ip`);
  const locEl = el(`${key}-location`);
  const card = document.querySelector(`.card[data-key="${key}"]`);
  const statusDot = card?.querySelector(".card-status");
  const copyBtn = card?.querySelector(".copy-btn");

  if (copyBtn) {
    copyBtn.hidden = status === STATUS.LOADING || status === STATUS.ERROR;
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

  statusDot.className =
    "card-status " +
    (status === STATUS.SUCCESS
      ? STATUS.SUCCESS
      : status === STATUS.ERROR
        ? STATUS.ERROR
        : STATUS.WARN);
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

async function checkDomestic() {
  for (const api of DOMESTIC_APIS) {
    try {
      const res = await safeFetch(api.url, {}, DOMESTIC_TIMEOUT_MS);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;
      const data = api.parse(JSON.parse(text));
      if (data.ip) {
        state.set("domestic", data.ip, data.location);
        return;
      }
    } catch {
      // try next
    }
  }
  state.setError("domestic");
}

async function checkForeign() {
  for (const api of FOREIGN_APIS) {
    try {
      const res = await safeFetch(api.url, {}, FOREIGN_TIMEOUT_MS);
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (!text) continue;

      let ip;
      if (api.parseText) {
        ip = text.split("\n")[0].trim();
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
      } else {
        const parsed = api.parse(JSON.parse(text));
        ip = parsed.ip;
        if (!ip) continue;
      }

      const location = await lookupLocation(ip);
      state.set("foreign", ip, location || "");
      foreignDeferred.resolve();
      return;
    } catch {
      // try next
    }
  }
  state.setError("foreign");
  foreignDeferred.resolve();
}

async function checkGoogle() {
  // 1) Try plain-text IP endpoint first.
  try {
    const res = await safeFetch(
      "https://domains.google.com/checkip",
      { redirect: "manual" },
      FOREIGN_TIMEOUT_MS,
    );
    const isRedirect =
      res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);

    if (isRedirect) {
      await foreignDeferred.promise;
      const foreignIp = state.results.foreign;
      if (foreignIp && foreignIp !== "error") {
        const location = await lookupLocation(foreignIp);
        state.setWarn("google", foreignIp, location || "checkip 已重定向");
      } else {
        state.setWarn("google", "重定向（可能被拦截）", "");
      }
      return;
    }

    if (res.ok) {
      const ip = (await res.text()).trim();
      if (ip && /^[\d\[]/.test(ip)) {
        state.set("google", ip, "");
        return;
      }
    }
  } catch {
    // fall through to 204 probes
  }

  // 2) 204 probes
  for (const url of GOOGLE_PROBES) {
    try {
      const res = await safeFetch(url, { mode: "no-cors" }, FOREIGN_TIMEOUT_MS);
      const reachable =
        res.type === "opaque" ||
        res.type === "opaqueredirect" ||
        res.ok ||
        res.status === 204;
      if (reachable) {
        await foreignDeferred.promise;
        const foreignIp = state.results.foreign;
        if (foreignIp && foreignIp !== "error") {
          const location = await lookupLocation(foreignIp);
          state.setWarn("google", foreignIp, location || "谷歌链路可达");
        } else {
          state.setWarn("google", "可达（IP 同国外出口）", "");
        }
        return;
      }
    } catch {
      // try next
    }
  }

  state.setError("google", "谷歌链路不可达（疑似被拦截）");
}

async function checkCloudflare() {
  let cfIp = null;
  let countryCode = null;

  // 1) CF trace for IP and country
  for (const url of CF_TRACES) {
    try {
      const res = await safeFetch(url, {}, FOREIGN_TIMEOUT_MS);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;

      const ipMatch = text.match(/^ip=(.+)$/m);
      const locMatch = text.match(/^loc=(.+)$/m);
      if (ipMatch) {
        cfIp = ipMatch[1].trim();
        countryCode = locMatch ? locMatch[1].trim() : null;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!cfIp) {
    state.setError("cf", "Cloudflare 链路不可达");
    return;
  }

  // 2) City-level geolocation lookup
  const location = await lookupLocation(cfIp);
  if (location) {
    state.set("cf", cfIp, location);
    return;
  }

  // 3) Fallback: country code only
  state.set("cf", cfIp, countryCode || "");
}

// ── Orchestration ─────────────────────────────────────────────────────────────

function checkAll() {
  const btn = el("refresh-btn");
  if (state._checkTimer) return;

  state._checkTimer = setTimeout(() => {
    state._checkTimer = null;
    btn?.classList.remove("spinning");
    btn?.removeAttribute("disabled");
  }, REFRESH_DEBOUNCE_MS);

  btn?.classList.add("spinning");
  btn?.setAttribute("disabled", "true");

  foreignDeferred = createDeferred();
  resetUI();
  void Promise.allSettled([
    checkDomestic(),
    checkForeign(),
    checkGoogle(),
    checkCloudflare(),
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
  if (!text || text.includes("检测中") || text.includes("失败")) return;

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
  if (!text || text.includes("检测中") || text.includes("失败")) return;
  copyToClipboard(text);
});

// ── Init ──────────────────────────────────────────────────────────────────────

checkAll();
