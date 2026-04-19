"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDetectors } = require("./detectors.js");
const { combineSignals } = require("./browser-utils.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    type: "basic",
    text: async () => JSON.stringify(body),
  };
}

function textResponse(text) {
  return {
    ok: true,
    status: 200,
    type: "basic",
    text: async () => text,
  };
}

function opaqueResponse() {
  return { ok: false, status: 0, type: "opaque", text: async () => "" };
}

function createRecorder() {
  const calls = [];
  return {
    calls,
    results: {},
    setResultForRun(_runId, key, ip, location, latency, source) {
      calls.push(["ok", key, ip, location, latency, source]);
      this.results[key] = ip;
    },
    setErrorForRun(_runId, key, message) {
      calls.push(["error", key, message ?? null]);
      this.results[key] = "error";
    },
    setWarningForRun(_runId, key, ip, location, latency, source) {
      calls.push(["warn", key, ip, location, latency, source]);
      this.results[key] = ip;
    },
  };
}

function createRun() {
  const controller = new AbortController();
  let resolveForeign;
  const foreignPromise = new Promise((resolve) => {
    resolveForeign = resolve;
  });
  return {
    id: 1,
    signal: controller.signal,
    foreignDeferred: {
      promise: foreignPromise,
      resolve: () => resolveForeign(),
    },
    controller,
  };
}

function buildDetectors(overrides = {}) {
  const recorder = createRecorder();
  const detectors = createDetectors({
    combineSignals,
    isCurrentRun: () => true,
    isRunAborted: (signal) => Boolean(signal?.aborted),
    isValidIP: (value) => /^\d+\.\d+\.\d+\.\d+$/.test(String(value || "").trim()),
    lookupLocation: async () => "US San Francisco",
    parseCloudflareTrace: (text) => {
      const ipMatch = text.match(/^ip=(.+)$/m);
      if (!ipMatch) return null;
      const locMatch = text.match(/^loc=(.+)$/m);
      return { ip: ipMatch[1].trim(), countryCode: locMatch ? locMatch[1].trim() : null };
    },
    safeFetch: async () => { throw new Error("safeFetch not configured"); },
    state: recorder,
    timeouts: { domestic: 100, foreign: 100 },
    ...overrides,
  });
  return { detectors, recorder };
}

test("checkDomestic resolves from the first successful endpoint", async () => {
  const { detectors, recorder } = buildDetectors({
    safeFetch: async (url) => {
      if (url.includes("ipip.net")) throw new Error("offline");
      if (url.includes("useragentinfo")) {
        return jsonResponse({ ip: "1.2.3.4", country: "中国", province: "北京", city: "北京", isp: "Telecom" });
      }
      return jsonResponse({ ip: "9.9.9.9", addr: "ignored" });
    },
  });
  const run = createRun();
  await detectors.checkAllDetectors(run);

  const domesticCall = recorder.calls.find((c) => c[1] === "domestic");
  assert.equal(domesticCall[0], "ok");
  // Race picks the fastest — may be useragentinfo OR pconline.
  assert.ok(["1.2.3.4", "9.9.9.9"].includes(domesticCall[2]));
});

test("checkDomestic records an error when every endpoint fails", async () => {
  const { detectors, recorder } = buildDetectors({
    safeFetch: async () => { throw new Error("offline"); },
  });
  const run = createRun();
  await detectors.checkAllDetectors(run);

  const domesticCall = recorder.calls.find((c) => c[1] === "domestic");
  assert.equal(domesticCall[0], "error");
});

test("checkForeign augments result with geo lookup", async () => {
  const { detectors, recorder } = buildDetectors({
    safeFetch: async (url) => {
      if (url.includes("ipify")) return jsonResponse({ ip: "203.0.113.7" });
      throw new Error("offline");
    },
    lookupLocation: async () => "US California",
  });
  const run = createRun();
  await detectors.checkAllDetectors(run);

  const foreignCall = recorder.calls.find((c) => c[1] === "foreign");
  assert.equal(foreignCall[0], "ok");
  assert.equal(foreignCall[2], "203.0.113.7");
  assert.equal(foreignCall[3], "US California");
});

test("checkGoogle rejects opaque responses below the latency floor", async () => {
  const { detectors, recorder } = buildDetectors({
    safeFetch: async (url, options) => {
      if (url.includes("generate_204")) {
        // Resolve synchronously — latency rounds to 0ms, below the 5ms floor.
        return opaqueResponse();
      }
      if (url.includes("ipify")) return jsonResponse({ ip: "203.0.113.7" });
      if (url.includes("cdn-cgi/trace")) return textResponse("ip=1.1.1.1\nloc=US");
      throw new Error("offline");
    },
  });
  const run = createRun();
  await detectors.checkAllDetectors(run);

  const googleCall = recorder.calls.find((c) => c[1] === "google");
  assert.equal(googleCall[0], "error");
});

test("checkGoogle accepts opaque responses once latency exceeds the floor", async () => {
  const { detectors, recorder } = buildDetectors({
    safeFetch: async (url) => {
      if (url.includes("generate_204")) {
        await sleep(15);
        return opaqueResponse();
      }
      if (url.includes("ipify")) return jsonResponse({ ip: "203.0.113.7" });
      if (url.includes("cdn-cgi/trace")) return textResponse("ip=1.1.1.1\nloc=US");
      throw new Error("offline");
    },
  });
  const run = createRun();
  await detectors.checkAllDetectors(run);

  const googleCall = recorder.calls.find((c) => c[1] === "google");
  assert.equal(googleCall[0], "warn");
  assert.equal(googleCall[2], "203.0.113.7");
});

test("checkCloudflare parses the trace endpoint and writes a success", async () => {
  const { detectors, recorder } = buildDetectors({
    safeFetch: async (url) => {
      if (url.includes("cdn-cgi/trace")) return textResponse("fl=xx\nip=1.1.1.1\nloc=US\nts=1");
      throw new Error("offline");
    },
    lookupLocation: async () => "US",
  });
  const run = createRun();
  await detectors.checkAllDetectors(run);

  const cfCall = recorder.calls.find((c) => c[1] === "cf");
  assert.equal(cfCall[0], "ok");
  assert.equal(cfCall[2], "1.1.1.1");
});
