import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDb, makeStore } from "../src/db.js";
import { config } from "../src/config.js";

// Keep the model i/o log out of the repo during tests.
process.env.LOG_FILE = "/dev/null";

const { parseCommand, jobsTable, approveOrDismiss, handleMessage } = await import("../src/cli.js");

const store = () => makeStore(openDb(":memory:"));
const capture = () => {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)) };
};

// Point the client at a throwaway server that always returns this extraction.
async function withModel(extraction, fn) {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: { content: JSON.stringify(extraction) } }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const original = config.model.url;
  config.model.url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn();
  } finally {
    config.model.url = original;
    await new Promise((r) => server.close(r));
  }
}

const complete = {
  intent: "quote",
  service: "blocked drain",
  name: "Sam",
  address: "3 Pine St",
  preferred_time: "Tuesday morning",
  needs_human: false,
  reply_text: "Thanks, we'll be in touch.",
};

test("parseCommand reads slash commands", () => {
  assert.deepEqual(parseCommand("my sink leaks"), { cmd: "say", text: "my sink leaks" });
  assert.deepEqual(parseCommand("  /jobs  "), { cmd: "jobs" });
  assert.deepEqual(parseCommand("/approve 12"), { cmd: "approve", id: 12 });
  assert.deepEqual(parseCommand("/dismiss 3"), { cmd: "dismiss", id: 3 });
  assert.deepEqual(parseCommand("/caller +15551234"), { cmd: "caller", caller: "+15551234" });
  assert.deepEqual(parseCommand("/quit"), { cmd: "quit" });
  assert.equal(parseCommand("/approve").cmd, "bad", "a missing id is a usage error, not a crash");
  assert.equal(parseCommand("/approve zero").cmd, "bad");
  assert.equal(parseCommand("/nope").cmd, "bad");
});

test("jobsTable renders rows and an empty state", () => {
  assert.equal(jobsTable([]), "No jobs yet.");
  const table = jobsTable([
    { id: 1, status: "pending", caller: "+1", service: "tap", name: "Ada", address: "1 A St", preferred_time: "Mon" },
  ]);
  assert.match(table, /^id\s+status\s+caller/);
  assert.match(table, /Ada, 1 A St/);
});

test("approve books the job, clears the thread and prints the confirmation", () => {
  const s = store();
  const id = s.addJob({ caller: "+1", service: "tap", status: "pending" });
  s.saveConversation("+1", [{ role: "user", content: "hi" }], 1);

  const io = capture();
  approveOrDismiss(s, { cmd: "approve", id }, io);

  assert.equal(s.getJob(id).status, "booked");
  assert.deepEqual(s.getConversation("+1"), { history: [], turns: 0 }, "the thread is freed");
  assert.match(io.lines.join("\n"), /Confirmed!/);
});

test("dismiss closes the job and sends the caller nothing", () => {
  const s = store();
  const id = s.addJob({ caller: "+2", service: "spam", status: "needs_human" });
  s.saveConversation("+2", [{ role: "user", content: "x" }], 1);

  const io = capture();
  approveOrDismiss(s, { cmd: "dismiss", id }, io);

  assert.equal(s.getJob(id).status, "closed");
  assert.deepEqual(s.getConversation("+2"), { history: [], turns: 0 });
  assert.doesNotMatch(io.lines.join("\n"), /Confirmed!/);
});

test("a complete message files one pending job", async () => {
  const s = store();
  const io = capture();
  await withModel(complete, () => handleMessage(s, "+1", "drain blocked at 3 Pine St", io));

  const jobs = s.listJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "pending");
  assert.match(io.lines.join("\n"), /Job #1 — \/approve 1/);
});

test("a follow-up after a complete message does not file a second job", async () => {
  const s = store();
  await withModel(complete, async () => {
    await handleMessage(s, "+1", "drain blocked at 3 Pine St", capture());
    await handleMessage(s, "+1", "thanks!", capture());
  });
  assert.equal(s.listJobs().length, 1, "one open job per caller");
});

test("needs_human hands off instead of booking", async () => {
  const s = store();
  const io = capture();
  await withModel({ ...complete, intent: "emergency", needs_human: true }, () =>
    handleMessage(s, "+9", "water is flooding everywhere", io),
  );

  const jobs = s.listJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "needs_human");
  assert.match(io.lines.join("\n"), /Needs you now/);
  assert.equal(
    s.listJobs().filter((j) => j.status === "pending").length,
    0,
    "an escalation is never booked as a job",
  );
});
