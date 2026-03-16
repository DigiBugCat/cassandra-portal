-- Runner configuration: per-user encrypted Obsidian credentials
-- Applied via: wrangler d1 execute cassandra-portal --file=src/migrations/002_runner_config.sql

CREATE TABLE IF NOT EXISTS runner_config (
  email TEXT PRIMARY KEY,
  credentials_encrypted TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
