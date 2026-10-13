# Side Hustle — a local-first AI front desk

Job triage for a one-person trade, running entirely in the terminal on **open-weight
models you host yourself**.

A plumber, barber or tutor misses a call while their hands are full, and the enquiry
arrives as a text, a DM or a form message. Paste it into the front desk and a **local
open-weight model** works out what the job is and collects the few details the owner
actually needs. The owner reviews every job in the same terminal and approves it.
Nothing is promised to a customer until a human says so.

> Built for the **Hacktoberfest Open-Source AI Challenge: Week 2 — Side Hustle**.

## Why open models matter here

The existing tools in this space glue a closed, per-message API (OpenAI, Retell) to the
front desk. That's a bad fit for a one-person business:

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
  C[You, as the caller] -->|types a message| A[Terminal front desk]
  A -->|prompt + schema| M[(Ollama / Gemma 3 local)]
  M -->|JSON| V{Deterministic validate}
  V -->|missing field| C
  V -->|complete + confident| DB[(SQLite jobs)]
  DB --> O[You, as the owner]
  O -->|/approve| C
  V -->|needs_human| O
```

The whole loop is one process: nothing listens on a port, nothing is sent to anyone.

## Quickstart

Zero dependencies — just Node 22.5+ and a local model.

```bash
cp .env.example .env
cp business.example.json business.json   # edit with the real business details

ollama pull gemma3:4b
ollama serve            # the front desk talks to it on :11434

npm start               # the terminal front desk
npm test                # logic tests, no network
```

Type as the caller: anything that isn't a `/command` is a message from the caller.

```
[caller] hi it's Sam at 3 Pine St, my kitchen drain is blocked, can you come Tuesday morning?

[owner] New job for Riverbend Plumbing
[owner] caller - blocked drains
[owner] Sam, 3 Pine St
[owner] Wants: Tuesday morning
[owner] Job #1 — /approve 1 to confirm.

<- Thanks, we've got your details and passed them to Sam. You'll hear back shortly to lock in a time.
```

## Commands

| Command | Does |
|---|---|
| `/jobs` | List every job |
| `/approve <id>` | Mark a job booked; prints the confirmation the caller would get |
| `/dismiss <id>` | Close a job without confirming anything |
| `/caller <id>` | Switch who you are typing as (default `caller`) |
| `/health` | Is the local model up? |
| `/help`, `/quit` | The list; exit |

Piping works too, which is how the tests and a demo script drive it:

```bash
printf '%s\n' "my drain is blocked, Sam, 3 Pine St, Tuesday morning" "/jobs" "/approve 1" | npm start
```

## Safety rules (enforced in code, not just in the prompt)

| Rule | Where |
|---|---|
| A price is never shown to a caller | `src/triage.js` — replies matching a price are replaced |
| A booking is never confirmed without owner approval | `src/triage.js` — `complete` files a `pending` job; only `/approve` confirms |
| A repeat message doesn't file a second job | `src/cli.js` — one open job per caller, freed on approve or dismiss |
| A dismissed job confirms nothing | `/dismiss` — sets `closed` and prints nothing to the caller |
| Angry / emergency / unclear goes to a human | `src/triage.js` — `needs_human` / intent routing |
| An endless thread ends itself | `src/triage.js` — the turn cap forces a handoff |
| A model blip doesn't lose a lead | `src/model.js` retries once; `src/cli.js` files a `needs_human` job as it degrades |
| Every model input/output is recorded | `src/cli.js` — `LOG_FILE`, gitignored |

## Project layout

```
src/cli.js       terminal front desk: commands, the loop, owner actions
src/config.js    env + business profile
src/db.js        SQLite: conversations, jobs
src/model.js     Ollama client + the one prompt (JSON-schema-constrained output)
src/triage.js    pure decision logic + guardrails  (the tested part)
test/cli.test.js  test/triage.test.js  test/db.test.js  test/model.test.js
```

## License

MIT.
