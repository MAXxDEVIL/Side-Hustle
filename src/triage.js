// Deterministic decision layer. The model only extracts and classifies; this file
// decides what actually happens and what actually gets sent to a caller.

export const REQUIRED_FIELDS = ["service", "name", "address", "preferred_time"];

const ASK = {
  service: "Thanks for getting in touch. What do you need help with?",
  name: "Got it. What name should we put the job under?",
  address: "What's the address or suburb for the job?",
  preferred_time: "When would suit you? A day and rough time is fine.",
};

// A price or a firm booking must never leave the business without the owner's approval.
const PRICE = /(?:[$€£]\s?\d|\b\d+\s?(?:dollars|usd|eur|gbp|quid|bucks)\b|\bper\s?hour\b|\bfree\b)/i;
const PROMISE = /\b(you'?re booked|booking confirmed|confirmed for|we'?ll be there|see you (?:on|at)|scheduled for)\b/i;

const HANDOFF_INTENTS = new Set(["spam", "wrong_number", "human", "emergency", "unclear"]);

const text = (v) => (typeof v === "string" ? v.trim() : "");

function isSafeForCaller(reply) {
  return (
    reply.length > 0 &&
    reply.length <= 320 &&
    !PRICE.test(reply) &&
    !PROMISE.test(reply)
  );
}

export function ownerHandoff(business) {
  return `Thanks for the message. ${business.ownerName} will get back to you shortly.`;
}

export function jobConfirmed(business) {
  return `Thanks, we've got your details and passed them to ${business.ownerName}. You'll hear back shortly to lock in a time.`;
}

/**
 * Turn a model extraction into the next action. Pure: same input, same output.
 * @param {object} extraction parsed model output
 * @param {object} ctx { business, caller, turns, maxTurns }
 */
export function decide(extraction = {}, ctx) {
  const { business, maxTurns = 8, turns = 0 } = ctx;
  const intent = text(extraction.intent).toLowerCase();
  const modelReply = text(extraction.reply_text);

  const needsHuman =
    extraction.needs_human === true || HANDOFF_INTENTS.has(intent) || turns >= maxTurns;

  if (needsHuman) {
    return { action: "handoff", field: null, reply: ownerHandoff(business) };
  }

  const missing = REQUIRED_FIELDS.filter((f) => !text(extraction[f]));
  if (missing.length > 0) {
    const field = missing[0];
    return {
      action: "ask",
      field,
      reply: isSafeForCaller(modelReply) ? modelReply : ASK[field],
    };
  }

  return { action: "complete", field: null, reply: jobConfirmed(business) };
}

/** What the owner is told, in one message. */
export function ownerSummary(job, business) {
  const parts = [
    `New job for ${business.name}`,
    `${job.caller} - ${job.service ?? "unspecified"}`,
    [job.name, job.address].filter(Boolean).join(", "),
    job.preferred_time ? `Wants: ${job.preferred_time}` : "No time given",
  ];
  return parts.filter(Boolean).join("\n");
}
