import { config } from "./config.js";

const SCHEMA_HINT = `Reply with ONE JSON object, no prose, with exactly these keys:
{
  "intent": one of "quote" | "booking" | "question" | "emergency" | "spam" | "wrong_number" | "human",
  "service": what the caller needs, or "",
  "urgency": one of "now" | "today" | "this_week" | "flexible" | "",
  "name": caller's name, or "",
  "address": job address or suburb, or "",
  "preferred_time": when they want it, verbatim if given, or "",
  "missing_fields": array of which of name/address/preferred_time/service are still unknown,
  "needs_human": true if a person must take over (angry, emergency, unclear, anything unusual),
  "reply_text": a short friendly SMS that asks ONLY for the single next missing detail. No prices. No confirmations.
}`;

// Hand Ollama the shape so it always fills every key. Without this, Gemma sometimes
// answers a finished conversation with a bare `{}` and the caller gets a nonsense prompt.
const SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["quote", "booking", "question", "emergency", "spam", "wrong_number", "human"],
    },
    service: { type: "string" },
    urgency: { type: "string", enum: ["now", "today", "this_week", "flexible", ""] },
    name: { type: "string" },
    address: { type: "string" },
    preferred_time: { type: "string" },
    missing_fields: { type: "array", items: { type: "string" } },
    needs_human: { type: "boolean" },
    reply_text: { type: "string" },
  },
  required: [
    "intent",
    "service",
    "urgency",
    "name",
    "address",
    "preferred_time",
    "missing_fields",
    "needs_human",
    "reply_text",
  ],
};

function systemPrompt(business) {
  return `You are the text-message front desk for ${business.name}, a small "${business.services.join(", ")}" business run by ${business.ownerName}.

Facts you may use:
- Services: ${business.services.join(", ")}
- Hours: ${business.hours}
- Service area: ${business.serviceArea}
- Pricing: ${business.pricingPolicy}

Hard rules:
- NEVER state, estimate, or imply a price. Say ${business.ownerName} will quote on site.
- NEVER confirm a booking or say a time is locked in.
- Ask for at most ONE missing detail per reply.
- If the caller is angry, in an emergency, or you are unsure, set needs_human to true.
- Keep reply_text under 200 characters.

${SCHEMA_HINT}`;
}

/** One model call. Throws on any unusable response so the caller can retry. */
async function oneAttempt(messages, timeoutMs) {
  const res = await fetch(`${config.model.url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model.name,
      messages,
      stream: false,
      format: SCHEMA,
      options: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`model responded ${res.status}`);
  const data = await res.json();
  const content = data?.message?.content;
  if (!content) throw new Error("model returned no content");

  const parsed = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null) throw new Error("model output not an object");
  return parsed;
}

/**
 * Ask the local open-weight model to classify and extract. Returns a plain object.
 * Retries once on a transient failure so a blip doesn't page the owner. Throws after
 * the last attempt, so the caller's server can degrade gracefully.
 */
export async function triage({ business, history, timeoutMs = 30000, attempts = 2 }) {
  const messages = [{ role: "system", content: systemPrompt(business) }, ...history];

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await oneAttempt(messages, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Is the local model reachable right now? Used by the health endpoint. */
export async function modelUp(timeoutMs = 2000) {
  try {
    const res = await fetch(`${config.model.url}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
