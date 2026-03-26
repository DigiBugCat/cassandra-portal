/**
 * Environment — replaces CF Worker bindings with Node.js equivalents.
 * All config is required. Missing config crashes at startup, not at request time.
 */

import Database from "better-sqlite3";

// ── Required env helper ──

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// ── SQLite (replaces D1) ──

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = requireEnv("DB_PATH");
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma("busy_timeout = 5000");
  }
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

// ── D1-compatible query wrapper ──

export interface D1Result<T> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): T | null;
  all<T = Record<string, unknown>>(): D1Result<T>;
  run(): { changes: number };
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

export function createD1Compat(db: Database.Database): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      let boundValues: unknown[] = [];
      const stmt = db.prepare(sql);

      const self: D1PreparedStatement = {
        bind(...values: unknown[]) {
          boundValues = values;
          return self;
        },
        first<T>(): T | null {
          return (stmt.get(...boundValues) as T) ?? null;
        },
        all<T>(): D1Result<T> {
          return { results: stmt.all(...boundValues) as T[] };
        },
        run() {
          const info = stmt.run(...boundValues);
          return { changes: info.changes };
        },
      };

      return self;
    },
  };
}

// ── Auth service client ──

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const authUrl = requireEnv("AUTH_URL");
  const authSecret = requireEnv("AUTH_SECRET");
  const headers = new Headers(init?.headers);
  headers.set("X-Auth-Secret", authSecret);
  return fetch(`${authUrl}${path}`, { ...init, headers });
}

// ── Env type ──

export interface Env {
  PORTAL_DB: D1Database;
  AUTH_URL: string;
  AUTH_SECRET: string;
  CREDENTIALS_KEY: string;
  DOMAIN: string;
  DISCORD_MCP_URL: string;
}

/** Load env — crashes on missing required vars. Call at startup. */
export function loadEnv(): Env {
  const db = getDb();
  return {
    PORTAL_DB: createD1Compat(db),
    AUTH_URL: requireEnv("AUTH_URL"),
    AUTH_SECRET: requireEnv("AUTH_SECRET"),
    CREDENTIALS_KEY: requireEnv("CREDENTIALS_KEY"),
    DOMAIN: requireEnv("DOMAIN"),
    DISCORD_MCP_URL: requireEnv("DISCORD_MCP_URL"),
  };
}
