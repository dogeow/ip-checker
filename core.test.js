"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KEYS,
  getLatencyTier,
  isValidIP,
  parseCloudflareTrace,
  summarizeResults,
} = require("./core.js");

test("isValidIP accepts valid IPv4 and IPv6", () => {
  assert.equal(isValidIP("1.1.1.1"), true);
  assert.equal(isValidIP("2001:db8::1"), true);
  assert.equal(isValidIP("[2606:4700:4700::1111]"), true);
});

test("isValidIP rejects malformed values", () => {
  assert.equal(isValidIP("999.1.1.1"), false);
  assert.equal(isValidIP("reachable via proxy"), false);
  assert.equal(isValidIP(""), false);
});

test("summarizeResults reports in-progress and split states", () => {
  assert.deepEqual(
    summarizeResults({
      domestic: "1.1.1.1",
      foreign: null,
      google: null,
      cf: null,
    }, KEYS),
    {
      text: "已检测到 1 个出口",
      badgeText: "检测中…",
      badgeClass: "badge-info",
    },
  );

  assert.deepEqual(
    summarizeResults({
      domestic: "1.1.1.1",
      foreign: "8.8.8.8",
      google: "8.8.8.8",
      cf: "8.8.8.8",
    }, KEYS),
    {
      text: "检测到 2 个出口",
      badgeText: "已分流",
      badgeClass: "badge-info",
    },
  );
});

test("summarizeResults reports blocked and direct states", () => {
  assert.deepEqual(
    summarizeResults({
      domestic: "1.1.1.1",
      foreign: "1.1.1.1",
      google: "error",
      cf: "error",
    }, KEYS),
    {
      text: "谷歌 & CF 均被阻断",
      badgeText: "高度封锁",
      badgeClass: "badge-diff",
    },
  );

  assert.deepEqual(
    summarizeResults({
      domestic: "1.1.1.1",
      foreign: "1.1.1.1",
      google: "1.1.1.1",
      cf: "1.1.1.1",
    }, KEYS),
    {
      text: "同一出口",
      badgeText: "直连",
      badgeClass: "badge-same",
    },
  );
});

test("getLatencyTier classifies latency bands", () => {
  assert.equal(getLatencyTier(120), "good");
  assert.equal(getLatencyTier(500), "mid");
  assert.equal(getLatencyTier(900), "slow");
});

test("parseCloudflareTrace extracts ip and country", () => {
  assert.deepEqual(
    parseCloudflareTrace("fl=xx\nip=1.1.1.1\nloc=US\nts=1"),
    { ip: "1.1.1.1", countryCode: "US" },
  );
  assert.equal(parseCloudflareTrace("fl=xx\nloc=US"), null);
});
