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
  dbFile: env.DB_FILE ?? "second-ring.db",
  maxTurns: Number(env.MAX_TURNS ?? 8),
  logFile: env.LOG_FILE ?? "triage.log",
  model: {
    url: env.OLLAMA_URL ?? "http://localhost:11434",
    name: env.MODEL ?? "gemma3:4b",
  },
};

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
