import { test } from "node:test";
import assert from "node:assert/strict";

// A tunnel can publish a mock server, so the guard must hold with no Twilio
// credentials. Start on a random port with an in-memory db.
process.env.PORT = "0";
process.env.DB_FILE = ":memory:";

const { config } = await import("../src/config.js");
const { server } = await import("../src/server.js");

const base = await new Promise((resolve) => {
  if (server.listening) return resolve(`http://127.0.0.1:${server.address().port}`);
  server.once("listening", () => resolve(`http://127.0.0.1:${server.address().port}`));
});

test("the review page needs the token even in mock mode", async () => {
  assert.equal(config.mock, true, "expected mock mode in tests");
  assert.ok(config.adminToken, "config should have minted a token");

  assert.equal((await fetch(`${base}/admin`)).status, 401);
  assert.equal((await fetch(`${base}/admin?token=${config.adminToken}`)).status, 200);
});

test("a wrong token is rejected", async () => {
  assert.equal((await fetch(`${base}/admin?token=nope`)).status, 401);
  assert.equal((await fetch(`${base}/admin`, { headers: { "x-admin-token": "nope" } })).status, 401);
});

test.after(() => server.close());
