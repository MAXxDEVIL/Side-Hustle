import { createServer } from "node:http";
import { config, loadBusiness } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { triage, modelUp } from "./model.js";
import { decide, ownerSummary } from "./triage.js";
import { validSignature, sendSms } from "./twilio.js";
import { renderAdmin } from "./admin.js";

const business = loadBusiness();
const store = makeStore(openDb(config.dbFile));

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

  const { history, turns } = store.getConversation(caller);
  history.push({ role: "user", content: params.Body ?? "" });

  let extraction;
  try {
    extraction = await triage({ business, history });
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
    send(res, 200, renderAdmin(store.listJobs(), business), "text/html; charset=utf-8");
  },
  "POST /admin/approve": async (req, res, params) => {
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
});
