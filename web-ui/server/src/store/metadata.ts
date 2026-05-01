/**
 * Tiny SQLite-backed metadata store. Everything else (actual conversation
 * history) lives in Claude Code's own ~/.claude/projects JSONL files.
 */

import Database from "better-sqlite3";
import { config } from "../config.js";
import type { PermissionMode, SessionListEntry } from "@ccweb/shared";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    cwd            TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_last_opened ON sessions(last_opened_at DESC);
`);

const insertStmt = db.prepare<
  [string, string, string, string, number, number],
  unknown
>(
  `INSERT OR REPLACE INTO sessions
     (id, title, cwd, permission_mode, created_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?, ?)`
);

const updateOpenedStmt = db.prepare<[number, string], unknown>(
  `UPDATE sessions SET last_opened_at = ? WHERE id = ?`
);

const updateTitleStmt = db.prepare<[string, string], unknown>(
  `UPDATE sessions SET title = ? WHERE id = ?`
);

const listStmt = db.prepare<[], SessionRow>(
  `SELECT id, title, cwd, permission_mode, created_at, last_opened_at
     FROM sessions
     ORDER BY last_opened_at DESC`
);

const getStmt = db.prepare<[string], SessionRow>(
  `SELECT id, title, cwd, permission_mode, created_at, last_opened_at
     FROM sessions
     WHERE id = ?`
);

const deleteStmt = db.prepare<[string], unknown>(
  `DELETE FROM sessions WHERE id = ?`
);

interface SessionRow {
  id: string;
  title: string;
  cwd: string;
  permission_mode: string;
  created_at: number;
  last_opened_at: number;
}

function rowToEntry(row: SessionRow): SessionListEntry {
  return {
    id: row.id,
    title: row.title,
    cwd: row.cwd,
    permissionMode: row.permission_mode as PermissionMode,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  };
}

export const metadataStore = {
  upsert(entry: {
    id: string;
    title: string;
    cwd: string;
    permissionMode: PermissionMode;
  }): void {
    const now = Date.now();
    const existing = getStmt.get(entry.id);
    const createdAt = existing?.created_at ?? now;
    insertStmt.run(entry.id, entry.title, entry.cwd, entry.permissionMode, createdAt, now);
  },

  touch(id: string): void {
    updateOpenedStmt.run(Date.now(), id);
  },

  rename(id: string, title: string): void {
    updateTitleStmt.run(title, id);
  },

  remove(id: string): void {
    deleteStmt.run(id);
  },

  list(): SessionListEntry[] {
    return listStmt.all().map(rowToEntry);
  },

  get(id: string): SessionListEntry | null {
    const row = getStmt.get(id);
    return row ? rowToEntry(row) : null;
  },
};
