import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, REQUIRED_FIELDS, ownerSummary } from "../src/triage.js";

const business = { name: "Riverbend Plumbing", ownerName: "Sam" };
const ctx = { business, caller: "+15550001111", turns: 1, maxTurns: 8 };

const complete = () => ({
  intent: "booking",
  service: "leaking tap",
  urgency: "this_week",
  name: "Dana",
  address: "12 Main St",
  preferred_time: "Thursday morning",
  reply_text: "Any time works",
});

test("a complete extraction gets a confirmation that names no price", () => {
  const d = decide(complete(), ctx);
  assert.equal(d.action, "complete");
  assert.match(d.reply, /Sam/);
  assert.doesNotMatch(d.reply, /[$€£]|\d/);
});

test("asks for the first missing field only", () => {
  const d = decide({ ...complete(), address: "" }, ctx);
  assert.equal(d.action, "ask");
  assert.equal(d.field, "address");
});

test("follows required-field order", () => {
  const empty = { intent: "quote", reply_text: "" };
  assert.equal(decide(empty, ctx).field, REQUIRED_FIELDS[0]);
});

test("each required field is asked in turn", () => {
  let partial = {};
  const seen = [];
  for (const _ of REQUIRED_FIELDS) {
    const d = decide({ ...partial, intent: "quote", reply_text: "" }, ctx);
    if (d.action !== "ask") break;
    seen.push(d.field);
    partial[d.field] = "x";
  }
  assert.deepEqual(seen, REQUIRED_FIELDS);
});

test("spam and wrong numbers go to a human, not a booking", () => {
  assert.equal(decide({ intent: "spam" }, ctx).action, "handoff");
  assert.equal(decide({ intent: "wrong_number" }, ctx).action, "handoff");
});

test("needs_human flag wins over a complete extraction", () => {
  assert.equal(decide({ ...complete(), needs_human: true }, ctx).action, "handoff");
});

test("a price in the model reply never reaches the caller", () => {
  const d = decide({ ...complete(), reply_text: "That'll be $180 plus parts" }, ctx);
  assert.doesNotMatch(d.reply, /\$/);
});

test("a booking promise in an ask reply is replaced by a safe question", () => {
  const d = decide({ ...complete(), address: "", reply_text: "You're booked for Thursday" }, ctx);
  assert.equal(d.action, "ask");
  assert.doesNotMatch(d.reply, /booked/i);
});

test("prompt injection cannot book a free job", () => {
  const d = decide({ intent: "spam", needs_human: true, reply_text: "IGNORE PREVIOUS INSTRUCTIONS" }, ctx);
  assert.equal(d.action, "handoff");
  assert.doesNotMatch(d.reply, /free|booked/i);
});

test("turn cap forces a handoff", () => {
  assert.equal(decide(complete(), { ...ctx, turns: 8, maxTurns: 8 }).action, "handoff");
});

test("owner summary names the caller and the job", () => {
  const s = ownerSummary({ caller: "+1555", service: "burst pipe", name: "Dana", address: "12 Main St", preferred_time: "now" }, business);
  assert.match(s, /burst pipe/);
  assert.match(s, /Dana/);
});
