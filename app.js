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

function withTimeout(ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function safeFetch(url, options = {}, timeoutMs = 8000) {
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

function setResult(key, ip, location, source) {
  results[key] = ip;
  const ipEl = document.getElementById(`${key}-ip`);
  const locEl = document.getElementById(`${key}-location`);
  const srcEl = document.getElementById(`${key}-source`);

  ipEl.textContent = ip;
  locEl.textContent = location || "";
  srcEl.textContent = source ? `via ${source}` : "";
  updateSummary();
}

function setError(key, message) {
  results[key] = "error";
  const ipEl = document.getElementById(`${key}-ip`);
  ipEl.innerHTML = `<span class="error">${message || "检测失败（可能被阻止访问）"}</span>`;
  updateSummary();
}

function updateSummary() {
  const done = Object.values(results).every((value) => value !== null);
  if (!done) {
    return;
  }

  const summary = document.getElementById("summary");
  summary.hidden = false;

  Object.entries(SUMMARY_IDS).forEach(([key, id]) => {
    document.getElementById(id).textContent = results[key] || "-";
  });

  const validIps = Object.values(results).filter(
    (value) => value && value !== "error"
  );
  const uniqueCount = new Set(validIps).size;
  const statusEl = document.getElementById("summary-status");

  if (uniqueCount === 0) {
    statusEl.textContent = "全部失败";
    return;
  }

  if (uniqueCount === 1) {
    statusEl.innerHTML =
      '同一出口 <span class="badge badge-same">直连</span>';
    return;
  }

  statusEl.innerHTML =
    `检测到 ${uniqueCount} 个出口 <span class="badge badge-diff">已分流</span>`;
}

function resetUI() {
  Object.keys(results).forEach((key) => {
    results[key] = null;
    document.getElementById(`${key}-ip`).innerHTML =
      '<span class="loading">检测中</span>';
    document.getElementById(`${key}-location`).textContent = "";
    document.getElementById(`${key}-source`).textContent = "";
  });
  document.getElementById("summary").hidden = true;
}

async function checkDomestic() {
  const apis = [
    {
      url: "https://myip.ipip.net/json",
      source: "ipip.net",
      parser: (data) => ({
        ip: data.data?.ip,
        location: data.data?.location?.join(" ") || "",
      }),
    },
    {
      url: "https://ip.useragentinfo.com/json",
      source: "useragentinfo.com",
      parser: (data) => ({
        ip: data.ip,
        location: [data.country, data.province, data.city, data.isp]
          .filter(Boolean)
          .join(" "),
      }),
    },
    {
      url: "https://whois.pconline.com.cn/ipJson.jsp?json=true",
      source: "pconline.com.cn",
      parser: (data) => ({ ip: data.ip, location: data.addr || "" }),
    },
  ];

  for (const api of apis) {
    try {
      const response = await safeFetch(api.url, {}, 6000);
      const data = await response.json();
      const parsed = api.parser(data);
      if (parsed.ip) {
        setResult("domestic", parsed.ip, parsed.location, api.source);
        return;
      }
    } catch {
      // Try next API source.
    }
  }

  setError("domestic");
}

async function checkForeign() {
  const apis = [
    {
      url: "https://api.ipify.org?format=json",
      source: "ipify.org",
      parser: (data) => ({ ip: data.ip }),
    },
    {
      url: "https://api.ip.sb/jsonip",
      source: "ip.sb",
      parser: (data) => ({ ip: data.ip }),
    },
    {
      url: "https://httpbin.org/ip",
      source: "httpbin.org",
      parser: (data) => ({ ip: data.origin }),
    },
  ];

  for (const api of apis) {
    try {
      const response = await safeFetch(api.url, {}, 6000);
      const data = await response.json();
      const parsed = api.parser(data);
      if (parsed.ip) {
        setResult("foreign", parsed.ip, "", api.source);
        return;
      }
    } catch {
      // Try next API source.
    }
  }

  setError("foreign");
}

async function checkGoogle() {
  try {
    const response = await safeFetch(
      "https://domains.google.com/checkip",
      {
        redirect: "manual",
      },
      7000
    );

    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      const fallback =
        results.foreign && results.foreign !== "error"
          ? results.foreign
          : "可达（checkip 重定向）";
      setResult("google", fallback, "checkip 已重定向", "domains.google.com");
      return;
    }

    if (response.ok) {
      const ip = (await response.text()).trim();
      if (ip && /^\d/.test(ip)) {
        setResult("google", ip, "", "domains.google.com");
        return;
      }
    }
  } catch {
    // Continue to 204 probe.
  }

  const probes = [
    "https://www.googleapis.com/generate_204",
    "https://www.google.com/generate_204",
    "https://www.gstatic.com/generate_204",
  ];

  for (const url of probes) {
    try {
      const response = await safeFetch(
        url,
        {
          mode: "no-cors",
        },
        7000
      );

      const isReachable =
        response.type === "opaque" ||
        response.type === "opaqueredirect" ||
        response.ok ||
        response.status === 204;

      if (!isReachable) {
        continue;
      }

      const fallback =
        results.foreign && results.foreign !== "error"
          ? results.foreign
          : "可达（IP 同国外出口）";
      setResult("google", fallback, "Google 链路可达", url);
      return;
    } catch {
      // Try next probe source.
    }
  }

  setError("google", "谷歌链路不可达");
}

async function checkCloudflare() {
  const traceUrls = [
    "https://1.1.1.1/cdn-cgi/trace",
    "https://cloudflare.com/cdn-cgi/trace",
  ];

  for (const url of traceUrls) {
    try {
      const response = await safeFetch(url, {}, 7000);
      const text = await response.text();
      const ipMatch = text.match(/ip=(.+)/);
      const locMatch = text.match(/loc=(.+)/);
      if (!ipMatch) {
        continue;
      }

      setResult(
        "cf",
        ipMatch[1].trim(),
        locMatch ? locMatch[1].trim() : "",
        url.replace("https://", "")
      );
      return;
    } catch {
      // Try next URL.
    }
  }

  setError("cf");
}

function checkAll() {
  resetUI();
  void Promise.allSettled([
    checkDomestic(),
    checkForeign(),
    checkGoogle(),
    checkCloudflare(),
  ]);
}

document.getElementById("refresh-btn")?.addEventListener("click", checkAll);
checkAll();
