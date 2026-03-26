import { Hono } from "hono";
import { getUserEmail } from "./auth";
import {
  encrypt,
  getDecryptedCredentials,
  getMemberRole,
  getServiceCredentialMeta,
  listProjectServiceKeys,
  randomHex,
} from "./db";
import { authFetch } from "./env";
import type { Env } from "./env";
import { MCP_SERVICES } from "./mcp-keys";

const app = new Hono<{ Bindings: Env }>();

/** Sync credentials to all MCP keys for a project+service via auth PATCH. */
async function syncCredentialsToAuth(
  db: Env["PORTAL_DB"],
  projectId: string,
  serviceId: string,
  credentials: Record<string, string> | null,
): Promise<void> {
  const keys = await listProjectServiceKeys(db, projectId, serviceId);
  for (const key of keys) {
    try {
      await authFetch(`/keys/${key.key_id}/credentials`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });
    } catch (err) {
      console.warn("Failed to sync credentials to auth for key", key.key_id, err);
    }
  }
}

// ── Service Credentials (project-scoped) ──

app.get("/api/projects/:projectId/services/:svc/credentials", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  const meta = await getServiceCredentialMeta(c.env.PORTAL_DB, projectId, svc);
  return c.json(meta);
});

app.put("/api/projects/:projectId/services/:svc/credentials", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  const service = MCP_SERVICES.find((s) => s.id === svc);
  if (!service) return c.json({ error: "unknown service" }, 400);

  const body = await c.req.json<Record<string, string>>();

  if (service.credentialsSchema) {
    for (const field of service.credentialsSchema) {
      if (field.required && !body[field.key]?.trim()) {
        return c.json({ error: `${field.label} is required` }, 400);
      }
    }
  }

  const sanitized: Record<string, string> = {};
  if (service.credentialsSchema) {
    for (const field of service.credentialsSchema) {
      if (body[field.key]) sanitized[field.key] = body[field.key];
    }
  }

  const encrypted = await encrypt(JSON.stringify(sanitized), c.env.CREDENTIALS_KEY);

  await c.env.PORTAL_DB
    .prepare(
      `INSERT INTO service_credentials (project_id, service_id, credentials_encrypted, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, service_id) DO UPDATE SET
         credentials_encrypted = excluded.credentials_encrypted,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    )
    .bind(projectId, svc, encrypted, email, email)
    .run();

  // Sync to all MCP keys for this project+service
  await syncCredentialsToAuth(c.env.PORTAL_DB, projectId, svc, sanitized);

  // Sync to auth per-user credentials
  authFetch(`/credentials/${encodeURIComponent(email)}/${encodeURIComponent(svc)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitized),
  }).catch((err) => console.warn("Auth per-user sync failed:", err));

  return c.json({ ok: true });
});

app.delete("/api/projects/:projectId/services/:svc/credentials", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  await c.env.PORTAL_DB
    .prepare("DELETE FROM service_credentials WHERE project_id = ? AND service_id = ?")
    .bind(projectId, svc)
    .run();

  await syncCredentialsToAuth(c.env.PORTAL_DB, projectId, svc, null);

  authFetch(`/credentials/${encodeURIComponent(email)}/${encodeURIComponent(svc)}`, {
    method: "DELETE",
  }).catch((err) => console.warn("Auth per-user delete failed:", err));

  return c.json({ ok: true });
});

// ── MCP Keys (project-scoped) ──

app.get("/api/projects/:projectId/services/:svc/keys", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  const keys = await listProjectServiceKeys(c.env.PORTAL_DB, projectId, svc);
  return c.json(keys);
});

app.post("/api/projects/:projectId/services/:svc/keys", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  const service = MCP_SERVICES.find((s) => s.id === svc);
  if (!service) return c.json({ error: "unknown service" }, 400);
  if (service.status !== "active") return c.json({ error: "service is not active" }, 400);

  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  const keyId = `mcp_${randomHex(32)}`;
  const now = new Date().toISOString();

  // Get project credentials
  const credentials = await getDecryptedCredentials(c.env.PORTAL_DB, projectId, svc, c.env.CREDENTIALS_KEY);

  // Write to auth service (replaces KV)
  try {
    await authFetch(`/keys/${keyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, service: svc, created_by: email,
        project_id: projectId, credentials,
      }),
    });
  } catch (err) {
    console.warn("Failed to write key to auth service:", err);
  }

  // Write to local DB (metadata)
  await c.env.PORTAL_DB
    .prepare("INSERT INTO mcp_keys (key_id, project_id, service_id, name, created_by) VALUES (?, ?, ?, ?, ?)")
    .bind(keyId, projectId, svc, name, email)
    .run();

  return c.json({ key: keyId, name, service: svc, project_id: projectId, created_at: now }, 201);
});

app.delete("/api/projects/:projectId/services/:svc/keys/:key", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc, key } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  if (!key.startsWith("mcp_")) return c.json({ error: "invalid key" }, 400);

  const keyRow = await c.env.PORTAL_DB
    .prepare("SELECT key_id FROM mcp_keys WHERE key_id = ? AND project_id = ? AND service_id = ?")
    .bind(key, projectId, svc)
    .first();

  if (!keyRow) return c.json({ error: "key not found" }, 404);

  try { await authFetch(`/keys/${key}`, { method: "DELETE" }); }
  catch (err) { console.warn("Failed to delete key from auth:", err); }

  await c.env.PORTAL_DB.prepare("DELETE FROM mcp_keys WHERE key_id = ?").bind(key).run();
  return c.json({ ok: true });
});

// ── Rotate MCP Key ──

app.post("/api/projects/:projectId/services/:svc/keys/:key/rotate", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc, key: oldKey } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  if (!oldKey.startsWith("mcp_")) return c.json({ error: "invalid key" }, 400);

  const keyRow = await c.env.PORTAL_DB
    .prepare("SELECT name FROM mcp_keys WHERE key_id = ? AND project_id = ? AND service_id = ?")
    .bind(oldKey, projectId, svc)
    .first<{ name: string }>();

  if (!keyRow) return c.json({ error: "key not found" }, 404);

  const newKey = `mcp_${randomHex(32)}`;
  const credentials = await getDecryptedCredentials(c.env.PORTAL_DB, projectId, svc, c.env.CREDENTIALS_KEY);

  // Write new key to auth, delete old
  try {
    await authFetch(`/keys/${newKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: keyRow.name, service: svc, created_by: email,
        project_id: projectId, credentials,
      }),
    });
    await authFetch(`/keys/${oldKey}`, { method: "DELETE" });
  } catch (err) {
    console.warn("Failed to rotate key in auth:", err);
  }

  await c.env.PORTAL_DB
    .prepare("UPDATE mcp_keys SET key_id = ?, created_by = ?, created_at = datetime('now') WHERE key_id = ?")
    .bind(newKey, email, oldKey)
    .run();

  return c.json({ key: newKey, name: keyRow.name });
});

// ── Service-Level Credentials (global, admin-managed) ──

app.get("/api/service-credentials/:svc", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const svc = c.req.param("svc");
  const resp = await authFetch(`/service-credentials/${encodeURIComponent(svc)}`);
  return c.json(await resp.json());
});

app.put("/api/service-credentials/:svc", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const svc = c.req.param("svc");
  const service = MCP_SERVICES.find((s) => s.id === svc);
  if (!service?.serviceCredentialsSchema) return c.json({ error: "service has no service credentials schema" }, 400);

  const body = await c.req.json<Record<string, string>>();
  const sanitized: Record<string, string> = {};
  for (const field of service.serviceCredentialsSchema) {
    if (body[field.key]) sanitized[field.key] = body[field.key];
  }

  const resp = await authFetch(`/service-credentials/${encodeURIComponent(svc)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitized),
  });

  return c.json(await resp.json());
});

app.delete("/api/service-credentials/:svc", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const svc = c.req.param("svc");
  const resp = await authFetch(`/service-credentials/${encodeURIComponent(svc)}`, { method: "DELETE" });
  return c.json(await resp.json());
});

export { app as credentials };
