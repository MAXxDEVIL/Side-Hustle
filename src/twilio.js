import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

/**
 * Twilio signs the full request URL plus every POSTed param. Reject anything that
 * doesn't match, so nobody can forge a caller into the triage pipeline.
 */
export function validSignature(url, params, signature) {
  if (!config.twilio.token) return false;
  if (!signature || typeof signature !== "string") return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", config.twilio.token).update(Buffer.from(data, "utf8")).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Send one SMS. In mock mode this only logs, so the whole flow runs offline. */
export async function sendSms(to, body) {
  if (config.mock) {
    console.log(`[mock sms] -> ${to}\n${body}\n`);
    return { mock: true };
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: config.twilio.number, Body: body }),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!res.ok) throw new Error(`twilio send failed ${res.status}: ${await res.text()}`);
  return res.json();
}
