"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { KEYS } = require("./core.js");
const {
  CARD_DEFINITIONS,
  getCardDefinitions,
} = require("./ui-components.js");

test("card definitions cover each detector exactly once", () => {
  const keys = CARD_DEFINITIONS.map((definition) => definition.key);
  assert.deepEqual(keys, KEYS);
  assert.equal(new Set(keys).size, keys.length);
});

test("getCardDefinitions preserves requested order", () => {
  const definitions = getCardDefinitions(["cf", "domestic"]);
  assert.deepEqual(
    definitions.map((definition) => definition.key),
    ["cf", "domestic"],
  );
});

test("getCardDefinitions rejects missing component metadata", () => {
  assert.throws(
    () => getCardDefinitions(["unknown"]),
    /Missing card definition: unknown/,
  );
});
