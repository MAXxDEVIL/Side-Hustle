#!/usr/bin/env node
// Simulate a caller without Twilio: `node bin/mock-caller.js call` or `... sms "text"`.
import { config } from "../src/config.js";

const [, , cmd, ...rest] = process.argv;
const base = process.env.MOCK_BASE_URL ?? `http://localhost:${config.port}`;
const caller = process.env.MOCK_CALLER ?? "+15550001111";

const sid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function post(path, params) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return `${res.status} ${await res.text()}`;
}

let status;
if (cmd === "call") {
  status = await post("/voice", { From: caller, To: config.twilio.number || "+15550000000", CallSid: sid("CA") });
} else if (cmd === "sms") {
  const body = rest.join(" ");
  if (!body) {
    console.error('usage: node bin/mock-caller.js sms "my sink is leaking"');
    process.exit(1);
  }
  status = await post("/sms", { From: caller, To: config.twilio.number || "+15550000000", Body: body, MessageSid: sid("SM") });
} else {
  console.error("usage: node bin/mock-caller.js call|sms \"text\"");
  process.exit(1);
}

console.log(status);
