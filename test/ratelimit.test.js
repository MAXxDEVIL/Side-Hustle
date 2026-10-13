import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLimiter } from "../src/ratelimit.js";

test("allows up to max inside the window, then blocks", () => {
  let t = 0;
  const allow = makeLimiter({ max: 3, windowMs: 1000, now: () => t });
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
});

test("resets once the window passes", () => {
  let t = 0;
  const allow = makeLimiter({ max: 1, windowMs: 1000, now: () => t });
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  t = 1000;
  assert.equal(allow("a"), true);
});

test("keys are independent", () => {
  let t = 0;
  const allow = makeLimiter({ max: 1, windowMs: 1000, now: () => t });
  assert.equal(allow("a"), true);
  assert.equal(allow("b"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), false);
});
