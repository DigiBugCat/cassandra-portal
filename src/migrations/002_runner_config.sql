-- Runner configuration: account-level auth token + per-vault E2EE passwords
-- Applied via: wrangler d1 execute cassandra-portal --file=src/migrations/002_runner_config.sql

-- Account-level credentials (one per user — Obsidian auth token)
CREATE TABLE IF NOT EXISTS runner_config (
  email TEXT PRIMARY KEY,
  credentials_encrypted TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-vault E2EE passwords
CREATE TABLE IF NOT EXISTS runner_vaults (
  email TEXT NOT NULL,
  vault TEXT NOT NULL,
  e2ee_encrypted TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, vault)
);
