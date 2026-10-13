import { readFileSync } from "node:fs";

function loadEnv(file = ".env") {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env file, fine
  }
}

loadEnv();

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8787}`,
  dbFile: env.DB_FILE ?? "second-ring.db",
  maxTurns: Number(env.MAX_TURNS ?? 8),
  ownerPhone: env.OWNER_PHONE ?? "",
  adminToken: env.ADMIN_TOKEN ?? "",
  logFile: env.LOG_FILE ?? "triage.log",
  rateLimit: {
    max: Number(env.RATE_LIMIT_MAX ?? 8),
    windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 60000),
  },
  twilio: {
    sid: env.TWILIO_ACCOUNT_SID ?? "",
    token: env.TWILIO_AUTH_TOKEN ?? "",
    number: env.TWILIO_NUMBER ?? "",
  },
  model: {
    url: env.OLLAMA_URL ?? "http://localhost:11434",
    name: env.MODEL ?? "gemma3:4b",
  },
};

// Mock mode: no Twilio credentials, so outbound SMS is logged instead of sent.
config.mock = !config.twilio.sid || !config.twilio.token;

export function loadBusiness(file = env.BUSINESS_FILE ?? "business.json") {
  for (const f of [file, "business.example.json"]) {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      // try next
    }
  }
  throw new Error("No business profile found (business.json or business.example.json)");
}
