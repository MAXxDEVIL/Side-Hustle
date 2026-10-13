import { readFileSync } from "node:fs";

// Node's own .env parser (20.12+). A missing file is fine, and a variable already
// in the environment wins — the behaviour the hand-rolled parser used to have.
try {
  process.loadEnvFile();
} catch {
  // no .env file, fine
}

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
