import { DatabaseSync } from "node:sqlite";

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      caller     TEXT PRIMARY KEY,
      history    TEXT NOT NULL,
      turns      INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      caller         TEXT NOT NULL,
      intent         TEXT,
      service        TEXT,
      urgency        TEXT,
      name           TEXT,
      address        TEXT,
      preferred_time TEXT,
      status         TEXT NOT NULL,
      created_at     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seen (
      sid        TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function makeStore(db) {
  const now = () => new Date().toISOString();

  return {
    // Returns true the first time a webhook id is seen, false on a Twilio retry.
    firstTime(sid) {
      if (!sid) return true;
      const hit = db.prepare("SELECT 1 FROM seen WHERE sid = ?").get(sid);
      if (hit) return false;
      // shortcut: `seen` grows without bound; on a long-lived server prune rows older than a few weeks.
      db.prepare("INSERT INTO seen (sid, created_at) VALUES (?, ?)").run(sid, now());
      return true;
    },

    getConversation(caller) {
      const row = db
        .prepare("SELECT history, turns FROM conversations WHERE caller = ?")
        .get(caller);
      return row ? { history: JSON.parse(row.history), turns: row.turns } : { history: [], turns: 0 };
    },

    saveConversation(caller, history, turns) {
      db.prepare(
        `INSERT INTO conversations (caller, history, turns, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(caller) DO UPDATE SET history = excluded.history,
           turns = excluded.turns, updated_at = excluded.updated_at`,
      ).run(caller, JSON.stringify(history), turns, now());
    },

    clearConversation(caller) {
      db.prepare("DELETE FROM conversations WHERE caller = ?").run(caller);
    },

    addJob(job) {
      const info = db
        .prepare(
          `INSERT INTO jobs (caller, intent, service, urgency, name, address, preferred_time, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          job.caller,
          job.intent ?? null,
          job.service ?? null,
          job.urgency ?? null,
          job.name ?? null,
          job.address ?? null,
          job.preferred_time ?? null,
          job.status,
          now(),
        );
      return Number(info.lastInsertRowid);
    },

    getJob(id) {
      return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    },

    // The open job for a caller, if any. Used to tell a follow-up from a new lead.
    openJobFor(caller) {
      return db
        .prepare(
          "SELECT id FROM jobs WHERE caller = ? AND status IN ('pending', 'needs_human') ORDER BY id DESC LIMIT 1",
        )
        .get(caller);
    },

    listJobs(status) {
      return status
        ? db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY id DESC").all(status)
        : db.prepare("SELECT * FROM jobs ORDER BY id DESC").all();
    },

    setJobStatus(id, status) {
      db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
    },
  };
}
