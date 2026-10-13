import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, makeStore } from "../src/db.js";

// A follow-up after a completed job must not file a second lead, so openJobFor has
// to see the caller's open job and nothing else.
test("openJobFor finds only this caller's open job", () => {
  const store = makeStore(openDb(":memory:"));

  assert.equal(store.openJobFor("+1"), undefined);

  const id = store.addJob({ caller: "+1", status: "pending" });
  assert.equal(store.openJobFor("+1").id, id);
  assert.equal(store.openJobFor("+2"), undefined, "another caller's job must not match");

  store.setJobStatus(id, "booked");
  assert.equal(store.openJobFor("+1"), undefined, "a booked job is closed");

  store.setJobStatus(id, "closed");
  assert.equal(store.openJobFor("+1"), undefined, "a dismissed job is closed");

  store.addJob({ caller: "+1", status: "needs_human" });
  assert.ok(store.openJobFor("+1"), "an escalation still counts as open");
});
