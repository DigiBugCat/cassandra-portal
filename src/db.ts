/**
 * DB helpers and AES-GCM credential encryption.
 * Uses D1Database interface from env.ts (backed by better-sqlite3).
 */

import { randomBytes, webcrypto } from "crypto";
import type { D1Database } from "./env";

const subtle = webcrypto.subtle;

// ── ID generation ──

export function generateId(): string {
  return randomBytes(8).toString("hex");
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// ── AES-GCM credential encryption ──

async function deriveKey(secret: string) {
  const raw = new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return Buffer.from(combined).toString("base64");
}

export async function decrypt(encoded: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const combined = Buffer.from(encoded, "base64");
  const iv = combined.subarray(0, 12);
  const ciphertext = combined.subarray(12);
  const plaintext = await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ── Row types ──

export interface ProjectRow {
  id: string;
  name: string;
  kind: "personal" | "shared";
  owner_email: string;
  created_at: string;
  updated_at: string;
}

export interface MemberRow {
  project_id: string;
  email: string;
  role: "owner" | "member";
  created_at: string;
}

export interface McpKeyRow {
  key_id: string;
  project_id: string;
  service_id: string;
  name: string;
  created_by: string;
  created_at: string;
}

// ── Query helpers ──

export function ensurePersonalProject(db: D1Database, email: string): ProjectRow {
  const existing = db
    .prepare("SELECT * FROM projects WHERE owner_email = ? AND kind = 'personal'")
    .bind(email)
    .first<ProjectRow>();

  if (existing) return existing;

  const id = generateId();
  db.prepare("INSERT INTO projects (id, name, kind, owner_email) VALUES (?, 'Personal', 'personal', ?)")
    .bind(id, email)
    .run();

  db.prepare("INSERT INTO project_members (project_id, email, role) VALUES (?, ?, 'owner')")
    .bind(id, email)
    .run();

  return {
    id,
    name: "Personal",
    kind: "personal",
    owner_email: email,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function listUserProjects(db: D1Database, email: string): ProjectRow[] {
  const { results } = db
    .prepare(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON p.id = pm.project_id
       WHERE pm.email = ?
       ORDER BY p.kind ASC, p.name ASC`,
    )
    .bind(email)
    .all<ProjectRow>();

  return results;
}

export function getMemberRole(
  db: D1Database,
  projectId: string,
  email: string,
): "owner" | "member" | null {
  const row = db
    .prepare("SELECT role FROM project_members WHERE project_id = ? AND email = ?")
    .bind(projectId, email)
    .first<{ role: string }>();

  return (row?.role as "owner" | "member") ?? null;
}

export function getProject(db: D1Database, projectId: string): ProjectRow | null {
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<ProjectRow>();
}

export function listMembers(db: D1Database, projectId: string): MemberRow[] {
  const { results } = db
    .prepare("SELECT * FROM project_members WHERE project_id = ? ORDER BY role ASC, email ASC")
    .bind(projectId)
    .all<MemberRow>();

  return results;
}

export function listProjectServiceKeys(
  db: D1Database,
  projectId: string,
  serviceId: string,
): McpKeyRow[] {
  const { results } = db
    .prepare("SELECT * FROM mcp_keys WHERE project_id = ? AND service_id = ? ORDER BY created_at DESC")
    .bind(projectId, serviceId)
    .all<McpKeyRow>();

  return results;
}

export function getServiceCredentialMeta(
  db: D1Database,
  projectId: string,
  serviceId: string,
): { has_credentials: boolean; updated_at: string | null; updated_by: string | null } {
  const row = db
    .prepare("SELECT updated_at, updated_by FROM service_credentials WHERE project_id = ? AND service_id = ?")
    .bind(projectId, serviceId)
    .first<{ updated_at: string; updated_by: string }>();

  return {
    has_credentials: !!row,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

export async function getDecryptedCredentials(
  db: D1Database,
  projectId: string,
  serviceId: string,
  credentialsKey: string,
): Promise<Record<string, string> | null> {
  const row = db
    .prepare("SELECT credentials_encrypted FROM service_credentials WHERE project_id = ? AND service_id = ?")
    .bind(projectId, serviceId)
    .first<{ credentials_encrypted: string }>();

  if (!row) return null;

  const json = await decrypt(row.credentials_encrypted, credentialsKey);
  return JSON.parse(json) as Record<string, string>;
}
