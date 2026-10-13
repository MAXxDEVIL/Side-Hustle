import { createServer } from "node:http";
import { appendFile } from "node:fs/promises";
import { config, loadBusiness } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { triage, modelUp } from "./model.js";
import { decide, ownerSummary } from "./triage.js";
import { validSignature, sendSms } from "./twilio.js";
import { makeLimiter } from "./ratelimit.js";
import { renderAdmin } from "./admin.js";

const business = loadBusiness();
const store = makeStore(openDb(config.dbFile));
const allow = makeLimiter({ max: config.rateLimit.max, windowMs: config.rateLimit.windowMs });

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });

const form = (raw) => Object.fromEntries(new URLSearchParams(raw));

function verified(req, params) {
  if (config.mock) return true; // no Twilio credentials: local/mock traffic only
  const url = config.publicUrl + req.url;
  return validSignature(url, params, req.headers["x-twilio-signature"]);
}

const send = (res, code, body, type = "text/plain; charset=utf-8") => {
  res.writeHead(code, { "Content-Type": type });
  res.end(body);
};

const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

// The review page holds caller names and addresses, so it must not be open on a
// live server. In mock mode it's localhost-only, so leave it free for dev.
function adminOk(req, params = {}) {
  if (config.mock) return true;
  const token =
    params.token ??
    req.headers["x-admin-token"] ??
    new URL(req.url, "http://x").searchParams.get("token");
  return !!config.adminToken && token === config.adminToken;
}

/** Missed call: don't take it, text the caller back immediately. */
async function onVoice(req, res, params) {
  if (!store.firstTime(params.CallSid)) return send(res, 200, twiml(""));

  const caller = params.From;
  if (caller) {
    await sendSms(caller, `Sorry we missed your call. Text us what you need and we'll reply. — ${business.name}`);
  }
  send(res, 200, twiml("<Hangup/>"), "application/xml");
}

/** Caller's reply: model extracts, deterministic code decides, we reply. */
async function onSms(req, res, params) {
  const caller = params.From;
  const sid = params.MessageSid;

  if (!caller) return send(res, 200, twiml(""));
  if (!store.firstTime(sid)) return send(res, 200, twiml("")); // Twilio retry

  if (!allow(caller)) {
    console.warn(`[rate] dropping burst from ${caller}`);
    return send(res, 200, twiml(""));
  }

  const { history, turns } = store.getConversation(caller);
  history.push({ role: "user", content: params.Body ?? "" });

  let extraction;
  try {
    extraction = await triage({ business, history });
    logModel(caller, history, extraction);
  } catch (err) {
    console.error(`[triage] model unavailable: ${err.message}`);
    store.clearConversation(caller);
    const id = store.addJob({ caller, service: "(model unavailable)", status: "needs_human" });
    await replyToCaller(caller, `Thanks — ${business.ownerName} will get back to you shortly.`);
    await notifyOwner(`Model was unreachable; a message from ${caller} needs you. Job #${id}`);
    return send(res, 200, twiml(""));
  }

  const decision = decide(extraction, { business, caller, turns: turns + 1, maxTurns: config.maxTurns });
  history.push({ role: "assistant", content: decision.reply });
  store.saveConversation(caller, history, turns + 1);

  // Record the lead before trying to text back: a Twilio blip must not lose a job.
  if (decision.action === "complete") {
    const id = store.addJob({ ...extraction, caller, status: "pending" });
    store.clearConversation(caller);
    await notifyOwner(`${ownerSummary({ ...extraction, caller }, business)}\n\nJob #${id} — approve: ${config.publicUrl}/admin`);
  } else if (decision.action === "handoff") {
    const id = store.addJob({ ...extraction, caller, status: "needs_human" });
    store.clearConversation(caller);
    await notifyOwner(`Needs you now: ${caller} (job #${id}) — ${config.publicUrl}/admin`);
  }

  await replyToCaller(caller, decision.reply);

  send(res, 200, twiml(""));
}

// A failed send must never take down the webhook: Twilio would retry and the
// caller would hear nothing.
async function replyToCaller(caller, body) {
  try {
    await sendSms(caller, body);
  } catch (err) {
    console.error(`[sms] reply to ${caller} failed: ${err.message}`);
  }
}

// Append-only record of every model call, for debugging and the write-up. It holds
// caller PII, so it stays local and is gitignored.
function logModel(caller, history, extraction) {
  const line = JSON.stringify({ at: new Date().toISOString(), caller, history, extraction }) + "\n";
  appendFile(config.logFile, line).catch((err) => console.error(`[log] ${err.message}`));
}

async function notifyOwner(body) {
  if (!config.ownerPhone) {
    console.log(`[owner] ${body.replace(/\n/g, " | ")}`);
    return;
  }
  try {
    await sendSms(config.ownerPhone, body);
  } catch (err) {
    console.error(`[owner] notify failed: ${err.message}`);
  }
}

const routes = {
  "GET /health": async (req, res) => {
    send(res, 200, JSON.stringify({ ok: true, model: await modelUp(), mock: config.mock }), "application/json");
  },
  "GET /admin": async (req, res) => {
    if (!adminOk(req)) return send(res, 401, "unauthorized");
    send(res, 200, renderAdmin(store.listJobs(), business, config.adminToken), "text/html; charset=utf-8");
  },
  "POST /admin/approve": async (req, res, params) => {
    if (!adminOk(req, params)) return send(res, 401, "unauthorized");
    const job = store.getJob(Number(params.id));
    if (!job) return send(res, 404, "no such job");
    store.setJobStatus(job.id, "booked");
    await replyToCaller(job.caller, `Confirmed! ${business.ownerName} will be in touch to lock in a time. Thanks for choosing ${business.name}.`);
    res.writeHead(303, { Location: "/admin" });
    res.end();
  },
  "POST /voice": async (req, res, params) => {
    if (!verified(req, params)) return send(res, 403, "bad signature");
    await onVoice(req, res, params);
  },
  "POST /sms": async (req, res, params) => {
    if (!verified(req, params)) return send(res, 403, "bad signature");
    await onSms(req, res, params);
  },
};

const server = createServer(async (req, res) => {
  const key = `${req.method} ${req.url.split("?")[0]}`;
  const handler = routes[key];
  try {
    if (!handler) return send(res, 404, "not found");
    const params = req.method === "POST" ? form(await readBody(req)) : {};
    await handler(req, res, params);
  } catch (err) {
    console.error(`[server] ${key}:`, err);
    send(res, 500, "error");
  }
});

server.listen(config.port, () => {
  console.log(`${business.name} front desk on ${config.publicUrl} (${config.mock ? "MOCK" : "Twilio live"})`);
  console.log(`model: ${config.model.name} @ ${config.model.url}`);
  if (config.mock) console.log("Tip: node bin/mock-caller.js sms \"my sink is leaking at 12 Main St\"");
  if (!config.mock && !config.adminToken) console.warn("WARNING: ADMIN_TOKEN is unset; /admin is locked and cannot be opened.");
});
