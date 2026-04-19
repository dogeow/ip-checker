"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  combineSignals,
  createDeferred,
  createSafeFetch,
  isRunAborted,
  withTimeout,
} = require("./browser-utils.js");

test("createDeferred resolves externally", async () => {
  const deferred = createDeferred();
  let resolved = false;
  deferred.promise.then(() => {
    resolved = true;
  });
  deferred.resolve();
  await deferred.promise;
  assert.equal(resolved, true);
});

test("isRunAborted reflects the signal state", () => {
  const controller = new AbortController();
  assert.equal(isRunAborted(controller.signal), false);
  controller.abort();
  assert.equal(isRunAborted(controller.signal), true);
  assert.equal(isRunAborted(undefined), false);
});

test("withTimeout aborts after the configured delay", async () => {
  const guard = withTimeout(5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(guard.signal.aborted, true);
  guard.clear();
});

test("withTimeout clear() prevents the abort", async () => {
  const guard = withTimeout(5);
  guard.clear();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(guard.signal.aborted, false);
});

test("combineSignals returns undefined signal when no inputs", () => {
  const { signal, release } = combineSignals([undefined, null]);
  assert.equal(signal, undefined);
  release();
});

test("combineSignals passes a single signal through", () => {
  const controller = new AbortController();
  const { signal, release } = combineSignals([controller.signal, undefined]);
  assert.equal(signal, controller.signal);
  release();
});

test("combineSignals aborts when any input aborts", () => {
  const a = new AbortController();
  const b = new AbortController();
  const { signal, release } = combineSignals([a.signal, b.signal]);
  assert.equal(signal.aborted, false);
  b.abort();
  assert.equal(signal.aborted, true);
  release();
});

test("combineSignals starts aborted if any input is already aborted", () => {
  const a = new AbortController();
  a.abort();
  const b = new AbortController();
  const { signal, release } = combineSignals([a.signal, b.signal]);
  assert.equal(signal.aborted, true);
  release();
});

test("createSafeFetch rethrows TimeoutError when the timer fires first", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  try {
    const safeFetch = createSafeFetch(5);
    await assert.rejects(
      () => safeFetch("https://example.invalid"),
      (error) => error.name === "TimeoutError",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createSafeFetch propagates external abort without rewriting the error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  try {
    const safeFetch = createSafeFetch(1000);
    const controller = new AbortController();
    const pending = safeFetch("https://example.invalid", { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error) => error.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
