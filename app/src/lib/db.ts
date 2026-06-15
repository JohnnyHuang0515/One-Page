import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as fs from "fs";
import * as schema from "./schema";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "app.db");

declare global {
  var __sqlite: Database.Database | undefined;
}

function createDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return sqlite;
}

// POC: idempotent create-table migration on startup (no drizzle-kit dance)
function migrate(sqlite: Database.Database) {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledgers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'TWD', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL, user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS memberships_ledger_user_unique ON memberships(ledger_id, user_id);
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL, code TEXT NOT NULL,
    created_by TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS invitations_code_unique ON invitations(code);
  CREATE TABLE IF NOT EXISTS billing_periods (
    id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL, year_month TEXT NOT NULL,
    status TEXT NOT NULL, settled_at INTEGER, settled_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS periods_ledger_month_unique ON billing_periods(ledger_id, year_month);
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL, billing_period_id TEXT NOT NULL,
    payer_id TEXT NOT NULL, description TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    spent_at TEXT NOT NULL, split_method TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS expense_shares (
    id TEXT PRIMARY KEY, expense_id TEXT NOT NULL, member_id TEXT NOT NULL,
    share_amount INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settlement_transactions (
    id TEXT PRIMARY KEY, billing_period_id TEXT NOT NULL,
    from_member_id TEXT NOT NULL, to_member_id TEXT NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL,
    paid_at INTEGER, paid_by TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL, actor_name TEXT NOT NULL,
    type TEXT NOT NULL, summary TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_ledger_time ON events(ledger_id, created_at);
  `);

  // D-0006: 既有 DB 補欄位（SQLite 無 ADD COLUMN IF NOT EXISTS，靠 table_info 判斷）
  addColumn(sqlite, "ledgers", "status", "TEXT NOT NULL DEFAULT 'ACTIVE'");
  addColumn(sqlite, "ledgers", "deleted_at", "INTEGER");
  addColumn(sqlite, "memberships", "status", "TEXT NOT NULL DEFAULT 'ACTIVE'");
  addColumn(sqlite, "memberships", "removed_at", "INTEGER");
  // #2 動態
  addColumn(sqlite, "memberships", "activity_seen_at", "INTEGER");
}

function addColumn(sqlite: Database.Database, table: string, column: string, decl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

export const sqlite = globalThis.__sqlite ?? (globalThis.__sqlite = createDb());
export const db = drizzle(sqlite, { schema });
export { schema };
