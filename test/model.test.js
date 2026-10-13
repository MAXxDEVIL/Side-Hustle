import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { config } from "../src/config.js";
import { triage } from "../src/model.js";

const business = {
  name: "Test Co",
  ownerName: "Sam",
  services: ["plumbing"],
  hours: "9-5",
  serviceArea: "here",
  pricingPolicy: "on site",
};
const history = [{ role: "user", content: "my sink is leaking" }];

// Point the client at a throwaway server for one test, then put it back.
async function withStub(handler, fn) {
  const server = createServer(handler);
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

const ok = (res, body) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: { content: JSON.stringify(body) } }));
};

test("triage retries once when the first call fails", async () => {
  let calls = 0;
  await withStub(
    (req, res) => {
      calls++;
      if (calls === 1) return res.writeHead(500).end("boom");
      ok(res, { intent: "quote" });
    },
    async () => {
      const e = await triage({ business, history });
      assert.equal(e.intent, "quote");
      assert.equal(calls, 2, "expected exactly one retry");
    },
  );
});

test("triage gives up and throws after the last attempt", async () => {
  let calls = 0;
  await withStub(
    (req, res) => {
      calls++;
      res.writeHead(500).end("boom");
    },
    async () => {
      await assert.rejects(() => triage({ business, history }), /model responded 500/);
      assert.equal(calls, 2, "expected two attempts then a throw");
    },
  );
});
