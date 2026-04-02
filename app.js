// ── State ─────────────────────────────────────────────────────────────────────

const results = {
  domestic: null,
  foreign: null,
  google: null,
  cf: null,
};

const SUMMARY_IDS = {
  domestic: "summary-domestic",
  foreign: "summary-foreign",
  google: "summary-google",
  cf: "summary-cf",
};

// ── Network helpers ───────────────────────────────────────────────────────────

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Fetch with timeout and explicit redirect control.
 * Passes through any `redirect` option from options so callers
 * can control it without being overridden by defaults.
 */
async function safeFetch(url, options = {}, timeoutMs = 8000) {
  const guard = withTimeout(timeoutMs);
  try {
    const merged = {
      ...options,
      signal: guard.signal,
      cache: "no-store",
    };
    // Keep the caller's redirect intent (including "manual").
    if ("redirect" in options) merged.redirect = options.redirect;
    return await fetch(url, merged);
  } finally {
    guard.clear();
  }
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(id) {
  return document.getElementById(id);
}

function setResult(key, ip, location, source) {
  results[key] = ip;
  const ipEl = el(`${key}-ip`);
  const locEl = el(`${key}-location`);
  const srcEl = el(`${key}-source`);

  if (!ipEl || !locEl) return;

  ipEl.textContent = ip;
  ipEl.style.cursor = "pointer";
  ipEl.onclick = (e) => {
    copyToClipboard(ip);
    showCopiedTip(e);
  };
  ipEl.onmouseenter = (e) => showCopyTip(e);
  ipEl.onmouseleave = hideCopyTip;
  ipEl.onmousemove = (e) => moveCopyTip(e);

  locEl.textContent = location || "";
  if (srcEl) srcEl.textContent = source ? `via ${source}` : "";

  updateSummary();
}

function setError(key, message) {
  results[key] = "error";
  const ipEl = el(`${key}-ip`);
  if (ipEl) {
    ipEl.innerHTML = `<span class="error">${message || "检测失败"}</span>`;
    ipEl.style.cursor = "default";
    ipEl.onclick = null;
    ipEl.onmouseenter = null;
    ipEl.onmouseleave = null;
    ipEl.onmousemove = null;
  }
  updateSummary();
}

function updateSummary() {
  const done = Object.values(results).every((v) => v !== null);
  if (!done) return;

  el("summary").hidden = false;

  Object.entries(SUMMARY_IDS).forEach(([key, id]) => {
    const dom = el(id);
    if (dom) dom.textContent = results[key] || "-";
  });

  const validIps = Object.values(results).filter((v) => v && v !== "error");
  const uniqueCount = new Set(validIps).size;
  const statusEl = el("summary-status");
  if (!statusEl) return;

  const blockedGoogle = results.google === "error" || !results.google;
  const blockedCF = results.cf === "error" || !results.cf;
  const blockedCount = (blockedGoogle ? 1 : 0) + (blockedCF ? 1 : 0);

  if (validIps.length === 0) {
    statusEl.textContent = "全部失败";
    return;
  }

  if (blockedCount === 2) {
    statusEl.innerHTML =
      '谷歌&amp;CF 均被阻断 <span class="badge badge-diff">高度封锁</span>';
    return;
  }

  if (blockedCount === 1) {
    statusEl.innerHTML =
      '部分链路被阻断 <span class="badge badge-diff">部分封锁</span>';
    return;
  }

  if (uniqueCount === 1) {
    statusEl.innerHTML = '同一出口 <span class="badge badge-same">直连</span>';
    return;
  }

  statusEl.innerHTML = `检测到 ${uniqueCount} 个出口 <span class="badge badge-diff">已分流</span>`;
}

function resetUI() {
  Object.keys(results).forEach((key) => {
    results[key] = null;
    const ipEl = el(`${key}-ip`);
    const locEl = el(`${key}-location`);
    const srcEl = el(`${key}-source`);

    if (ipEl) {
      ipEl.innerHTML = '<span class="loading">检测中</span>';
      ipEl.style.cursor = "default";
      ipEl.onclick = null;
      ipEl.onmouseenter = null;
      ipEl.onmouseleave = null;
      ipEl.onmousemove = null;
    }
    if (locEl) locEl.textContent = "";
    if (srcEl) srcEl.textContent = "";
  });

  const summary = el("summary");
  if (summary) summary.hidden = true;
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API blocked — silently skip.
    return;
  }
  showToast("已复制: " + text);
}

function showToast(msg) {
  const existing = el("toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast";
  toast.textContent = msg;
  toast.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "left:50%",
    "transform:translateX(-50%)",
    "background:#3a3a3a",
    "color:#e8e8e8",
    "padding:8px 16px",
    "border-radius:8px",
    "font-size:0.8rem",
    "z-index:9999",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 0.2s",
  ].join(";");
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 200);
    }, 1500);
  });
}

// ── Copy tooltip ─────────────────────────────────────────────────────────────

let copyTip = null;
const isTouchDevice = !window.matchMedia("(hover: hover)").matches;

function getCopyTip() {
  if (!copyTip) {
    copyTip = document.createElement("div");
    copyTip.id = "copy-tip";
    copyTip.style.cssText = [
      "position:fixed",
      "background:#2a2a2a",
      "border:1px solid #4c4c4c",
      "color:#9f9f9f",
      "font-size:0.65rem",
      'font-family:"SF Pro Text",sans-serif',
      "padding:3px 8px",
      "border-radius:5px",
      "pointer-events:none",
      "z-index:9999",
      "opacity:0",
      "transition:opacity 0.12s",
      "white-space:nowrap",
    ].join(";");
    document.body.appendChild(copyTip);
  }
  return copyTip;
}

function showCopyTip(e) {
  if (isTouchDevice) return;
  const tip = getCopyTip();
  tip.textContent = "点击复制";
  tip.style.opacity = "1";
  moveCopyTip(e);
}

function moveCopyTip(e) {
  if (isTouchDevice) return;
  const tip = getCopyTip();
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY - 28}px`;
}

function hideCopyTip() {
  if (copyTip) copyTip.style.opacity = "0";
}

function showCopiedTip(e) {
  const tip = getCopyTip();
  tip.textContent = "已复制";
  tip.style.opacity = "1";
  const x = e ? e.clientX : window.innerWidth / 2;
  const y = e ? e.clientY : window.innerHeight / 2;
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y - 28}px`;
  setTimeout(hideCopyTip, 1800);
}

// ── API checks ──────────────────────────────────────────────────────────────

async function checkDomestic() {
  const apis = [
    {
      url: "https://myip.ipip.net/json",
      source: "ipip.net",
      parse: (d) => ({
        ip: d.data?.ip,
        location: (d.data?.location || []).join(" "),
      }),
    },
    {
      url: "https://ip.useragentinfo.com/json",
      source: "useragentinfo.com",
      parse: (d) => ({
        ip: d.ip,
        location: [d.country, d.province, d.city, d.isp]
          .filter(Boolean)
          .join(" "),
      }),
    },
    {
      url: "https://whois.pconline.com.cn/ipJson.jsp?json=true",
      source: "pconline.com.cn",
      parse: (d) => ({ ip: d.ip, location: d.addr || "" }),
    },
  ];

  for (const api of apis) {
    try {
      const res = await safeFetch(api.url, {}, 6000);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;
      const data = api.parse(JSON.parse(text));
      if (data.ip) {
        setResult("domestic", data.ip, data.location, api.source);
        return;
      }
    } catch {
      // try next
    }
  }

  setError("domestic");
}

async function checkForeign() {
  const apis = [
    {
      url: "https://api.ipify.org?format=json",
      source: "ipify.org",
      parse: (d) => ({ ip: d.ip }),
    },
    {
      url: "https://api.ip.sb/jsonip",
      source: "ip.sb",
      parse: (d) => ({ ip: d.ip }),
    },
    {
      url: "https://httpbin.org/ip",
      source: "httpbin.org",
      parse: (d) => ({ ip: d.origin }),
    },
  ];

  for (const api of apis) {
    try {
      const res = await safeFetch(api.url, {}, 6000);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;
      const data = api.parse(JSON.parse(text));
      if (data.ip) {
        setResult("foreign", data.ip, "", api.source);
        return;
      }
    } catch {
      // try next
    }
  }

  setError("foreign");
}

async function checkGoogle() {
  // First try checkip — it returns a plain-text IP.
  try {
    const res = await safeFetch(
      "https://domains.google.com/checkip",
      { redirect: "manual" },
      7000,
    );
    const isRedirect =
      res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);

    if (isRedirect) {
      const ip =
        results.foreign && results.foreign !== "error"
          ? results.foreign
          : "重定向（可能被拦截）";
      setResult("google", ip, "checkip 已重定向", "domains.google.com");
      return;
    }

    if (res.ok) {
      const ip = (await res.text()).trim();
      if (ip && /^\d/.test(ip)) {
        setResult("google", ip, "", "domains.google.com");
        return;
      }
    }
  } catch {
    // fall through to 204 probes
  }

  // 204 probes — no-cors means we only know reachability.
  const probes = [
    "https://www.googleapis.com/generate_204",
    "https://www.google.com/generate_204",
    "https://www.gstatic.com/generate_204",
  ];

  for (const url of probes) {
    try {
      const res = await safeFetch(url, { mode: "no-cors" }, 7000);
      const reachable =
        res.type === "opaque" ||
        res.type === "opaqueredirect" ||
        res.ok ||
        res.status === 204;

      if (reachable) {
        const ip =
          results.foreign && results.foreign !== "error"
            ? results.foreign
            : "可达（IP 同国外出口）";
        setResult("google", ip, "谷歌链路可达", url.replace("https://", ""));
        return;
      }
    } catch {
      // try next
    }
  }

  // None reachable — likely blocked.
  setError("google", "谷歌链路不可达（疑似被拦截）");
}

async function checkCloudflare() {
  const traceUrls = [
    "https://1.1.1.1/cdn-cgi/trace",
    "https://cloudflare.com/cdn-cgi/trace",
  ];

  for (const url of traceUrls) {
    try {
      const res = await safeFetch(url, {}, 7000);
      const text = await res.text();
      if (!text.trim()) continue;

      const ipMatch = text.match(/^ip=(.+)$/m);
      const locMatch = text.match(/^loc=(.+)$/m);
      if (!ipMatch) continue;

      const srcHost = url.replace("https://", "");
      setResult(
        "cf",
        ipMatch[1].trim(),
        locMatch ? locMatch[1].trim() : "",
        srcHost,
      );
      return;
    } catch {
      // try next
    }
  }

  setError("cf", "Cloudflare 链路不可达");
}

// ── Orchestration ────────────────────────────────────────────────────────────

let checkTimer = null;

function checkAll() {
  if (checkTimer) return; // debounce rapid clicks
  checkTimer = setTimeout(() => {
    checkTimer = null;
  }, 1200);

  resetUI();
  void Promise.allSettled([
    checkDomestic(),
    checkForeign(),
    checkGoogle(),
    checkCloudflare(),
  ]);
}

el("refresh-btn")?.addEventListener("click", checkAll);
checkAll();
