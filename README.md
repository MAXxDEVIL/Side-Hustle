# Side Hustle — a local-first AI front desk

Missed-call text-back and job triage for a one-person trade, running on **open-weight
models you host yourself**.

A plumber, barber or tutor misses a call while their hands are full. The caller doesn't
leave a voicemail — they ring the next listing. This answers the lost call in seconds
with a text, then a **local open-weight model** reads the reply, works out what the job
is, and collects the few details the owner actually needs. The owner gets one summary
and approves it. Nothing is promised to a customer until a human says so.

> Built for the **Hacktoberfest Open-Source AI Challenge: Week 2 — Side Hustle**.

## Why open models matter here

The existing tools in this space glue a closed, per-message API (OpenAI, Retell) to a
phone number. That's a bad fit for a one-person business:

- **Cost.** A busy trade can send hundreds of messages a month. Metered API calls make
  the margin disappear. A local model costs $0 per message.
- **Privacy.** Job details include names, addresses and what's wrong with someone's
  house. Running inference locally means that data never leaves the owner's machine.
- **Control.** No vendor can reprice or retire the model under you, and you can swap
  weights (Gemma, Qwen, Llama) without touching the product.

## Architecture

The model **only classifies and extracts**. Deterministic code decides what happens and
what a customer is allowed to be told.

```
flowchart LR
  C[Caller] -->|missed call| T[Twilio]
  T -->|voice webhook| A[Node app]
  A -->|"text back"| C
  C -->|SMS reply| A
  A -->|prompt + schema| M[(Ollama / Gemma 3 local)]
  M -->|JSON| V{Deterministic validate}
  V -->|missing field| C
  V -->|complete + confident| DB[(SQLite jobs)]
  DB --> O[Owner review page]
  O -->|approve| C
  V -->|needs_human| O
```

## Quickstart (no Twilio, no Ollama required)

Zero dependencies — just Node 22.5+.

```bash
cp .env.example .env
cp business.example.json business.json   # edit with the real business details

npm start            # starts in MOCK mode when no Twilio creds are set
npm test             # pure decision-logic tests, no network

# in another shell:
npm run call                                     # simulate a missed call
npm run sms -- "my sink is leaking, need help"   # simulate a caller's reply
```

Open <http://localhost:8787/admin> for the owner's review page. Outbound texts are
printed to the server log. With the model unreachable, the app degrades to "a human
will get back to you" and queues the message for the owner — it never drops a lead.

To run the real model locally:

```bash
ollama pull gemma3:4b
ollama serve          # the app talks to it on :11434
```

## Going live with Twilio

1. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`, `OWNER_PHONE` and a
   public `PUBLIC_URL` in `.env`.
2. Point the number's **Voice** webhook at `POST {PUBLIC_URL}/voice` and its
   **Messaging** webhook at `POST {PUBLIC_URL}/sms`.
3. Complete **A2P 10DLC** registration for US numbers — it takes days, so start it early.

Both webhooks verify `X-Twilio-Signature`. Without valid credentials the server refuses
to verify and stays in mock mode rather than trusting unauthenticated input.

## Safety rules (enforced in code, not just in the prompt)

| Rule | Where |
|---|---|
| A price is never sent to a caller | `src/triage.js` — replies matching a price are replaced |
| A booking is never confirmed without owner approval | `src/triage.js` + `/admin/approve` |
| Angry / emergency / unclear goes to a human | `src/triage.js` — `needs_human` / intent routing |
| Webhooks are authenticated | `src/twilio.js` — HMAC-SHA1 signature check |
| The review page is not public | `src/server.js` — needs `ADMIN_TOKEN` once Twilio is live |
| Twilio retries don't double-book | `src/db.js` — `seen` table keyed by message id |
| A failed text never loses a lead | `src/server.js` — the job is saved before the send |
| One number can't run up model calls | `src/ratelimit.js` — fixed window per caller |

## Project layout

```
src/config.js    env + business profile
src/db.js        SQLite: conversations, jobs, seen ids
src/ratelimit.js fixed-window per-caller limiter
src/model.js     Ollama client + the one prompt
src/triage.js    pure decision logic + guardrails  (the tested part)
src/twilio.js    signature verification + send SMS
src/admin.js     owner review page
src/server.js    routes and wiring
bin/mock-caller.js   drive the app without Twilio
test/triage.test.js
```

## License

MIT.
