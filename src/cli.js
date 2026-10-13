#!/usr/bin/env node
// The whole front desk in the terminal. You type as the caller, the local model
// triages, and you review and approve as the owner. No server, no webhooks.
import { createInterface } from "node:readline";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { config, loadBusiness } from "./config.js";
import { openDb, makeStore } from "./db.js";
import { triage, modelUp } from "./model.js";
import { decide, ownerSummary } from "./triage.js";

const business = loadBusiness();

const HELP = `commands:
  /jobs              list every job
  /approve <id>      mark a job booked (prints the confirmation the caller would get)
  /dismiss <id>      close a job without confirming anything
  /caller <id>       switch who you are typing as (default "caller")
  /health            is the local model up?
  /help              this list
  /quit              exit
anything else is treated as a message from the caller.`;

const confirmText = () =>
  `Confirmed! ${business.ownerName} will be in touch to lock in a time. Thanks for choosing ${business.name}.`;

/** Turn one input line into an instruction. Pure. */
export function parseCommand(line) {
  const t = String(line ?? "").trim();
  if (!t.startsWith("/")) return { cmd: "say", text: t };

  const [word, ...rest] = t.slice(1).split(/\s+/);
  const cmd = word.toLowerCase();
  const arg = rest.join(" ").trim();

  if (cmd === "approve" || cmd === "dismiss") {
    const id = Number(arg);
    return Number.isInteger(id) && id > 0 ? { cmd, id } : { cmd: "bad", text: `usage: /${cmd} <job id>` };
  }
  if (cmd === "caller") return arg ? { cmd, caller: arg } : { cmd: "bad", text: "usage: /caller <id>" };
  if (cmd === "jobs" || cmd === "health" || cmd === "help") return { cmd };
  if (cmd === "quit" || cmd === "exit") return { cmd: "quit" };
  return { cmd: "bad", text: `unknown command: /${cmd} — try /help` };
}

/** Plain-text job table. Pure. */
export function jobsTable(jobs) {
  if (!jobs.length) return "No jobs yet.";
  const head = ["id", "status", "caller", "service", "name / address", "wants"];
  const rows = jobs.map((j) => [
    j.id,
    j.status,
    j.caller,
    j.service ?? "",
    [j.name, j.address].filter(Boolean).join(", "),
    j.preferred_time ?? "",
  ]);
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(width[i])).join("  ").trimEnd();
  return [line(head), width.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** One model call plus the deterministic decision. Prints the caller's reply. */
export async function handleMessage(store, caller, body, io = console) {
  const { history, turns } = store.getConversation(caller);
  history.push({ role: "user", content: body });

  let extraction;
  try {
    extraction = await triage({ business, history });
    logModel(caller, history, extraction);
  } catch (err) {
    io.log(`[triage] model unavailable: ${err.message}`);
    store.clearConversation(caller);
    const id = store.addJob({ caller, service: "(model unavailable)", status: "needs_human" });
    io.log(`<- Thanks — ${business.ownerName} will get back to you shortly.`);
    ownerNote(io, `Model was unreachable; a message from ${caller} needs you. Job #${id}`);
    return;
  }

  const decision = decide(extraction, { business, caller, turns: turns + 1, maxTurns: config.maxTurns });
  history.push({ role: "assistant", content: decision.reply });
  // Keep the thread so a follow-up is answered with context. A completed job resets
  // the turn count; the cap stops the thread growing without bound.
  store.saveConversation(caller, history.slice(-20), decision.action === "complete" ? 0 : turns + 1);

  if (decision.action === "complete") {
    // One open job per caller: a second "complete" is a follow-up, not a new lead.
    if (!store.openJobFor(caller)) {
      const id = store.addJob({ ...extraction, caller, status: "pending" });
      ownerNote(io, `${ownerSummary({ ...extraction, caller }, business)}\n\nJob #${id} — /approve ${id} to confirm.`);
    }
  } else if (decision.action === "handoff") {
    const id = store.addJob({ ...extraction, caller, status: "needs_human" });
    store.clearConversation(caller);
    ownerNote(io, `Needs you now: ${caller} (job #${id}) — /jobs to review.`);
  }

  io.log(`<- ${decision.reply}`);
}

function ownerNote(io, body) {
  io.log(`\n[owner] ${body.replace(/\n/g, "\n[owner] ")}\n`);
}

// Append-only record of every model call, for debugging and the write-up. It holds
// job details, so it stays local and is gitignored.
function logModel(caller, history, extraction) {
  const line = JSON.stringify({ at: new Date().toISOString(), caller, history, extraction }) + "\n";
  appendFile(config.logFile, line).catch((err) => console.error(`[log] ${err.message}`));
}

/** Owner actions. Returns nothing; prints what it did. */
export function approveOrDismiss(store, { cmd, id }, io = console) {
  const job = store.getJob(id);
  if (!job) return io.log(`no job #${id}`);
  if (cmd === "approve") {
    store.setJobStatus(job.id, "booked");
    store.clearConversation(job.caller);
    io.log(`job #${job.id} booked. The caller would get:\n  "${confirmText()}"`);
  } else {
    store.setJobStatus(job.id, "closed");
    store.clearConversation(job.caller);
    io.log(`job #${job.id} dismissed. Nothing is sent to the caller.`);
  }
}

async function main() {
  const store = makeStore(openDb(config.dbFile));
  let caller = "caller";
  const io = console;

  io.log(`${business.name} — terminal front desk`);
  io.log(`model: ${config.model.name} @ ${config.model.url} (${(await modelUp()) ? "up" : "DOWN — is `ollama serve` running?"})`);
  io.log(`type a message as the caller, or /help\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Only draw a prompt on a real terminal: piped input closes readline at EOF,
  // and prompting after that throws.
  const interactive = Boolean(process.stdin.isTTY);
  const prompt = () => {
    if (!interactive) return;
    rl.setPrompt(`[${caller}] `);
    rl.prompt();
  };
  prompt();

  for await (const line of rl) {
    const c = parseCommand(line);
    if (c.cmd === "quit") break;
    else if (c.cmd === "say") {
      if (c.text) await handleMessage(store, caller, c.text, io);
    } else if (c.cmd === "jobs") io.log(jobsTable(store.listJobs()));
    else if (c.cmd === "approve" || c.cmd === "dismiss") approveOrDismiss(store, c, io);
    else if (c.cmd === "caller") {
      caller = c.caller;
      io.log(`now typing as ${caller}`);
    } else if (c.cmd === "health") io.log(`model ${(await modelUp()) ? "up" : "DOWN"}`);
    else if (c.cmd === "help") io.log(HELP);
    else io.log(c.text); // "bad": usage or unknown command

    prompt();
  }
  rl.close();
}

// Only run the loop when executed, so tests can import the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
