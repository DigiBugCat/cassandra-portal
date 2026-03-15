import { Hono } from "hono";
import { pushMetrics, counter } from "cassandra-observability";
import { getUserEmail } from "./auth";
import {
  encrypt,
  getDecryptedCredentials,
  getMemberRole,
  getServiceCredentialMeta,
  listProjectServiceKeys,
  randomHex,
  syncCredentialsToKV,
} from "./db";
import { MCP_SERVICES } from "./mcp-keys";

const app = new Hono<{ Bindings: Env }>();

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

  // Validate against schema
  if (service.credentialsSchema) {
    for (const field of service.credentialsSchema) {
      if (field.required && !body[field.key]?.trim()) {
        return c.json({ error: `${field.label} is required` }, 400);
      }
    }
  }

  // Only store schema-defined fields
  const sanitized: Record<string, string> = {};
  if (service.credentialsSchema) {
    for (const field of service.credentialsSchema) {
      if (body[field.key]) {
        sanitized[field.key] = body[field.key];
      }
    }
  }

  const encrypted = await encrypt(JSON.stringify(sanitized), c.env.CREDENTIALS_KEY);

  // Upsert
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

  // Sync to all KV keys for this project+service
  await syncCredentialsToKV(c.env.PORTAL_DB, c.env.MCP_KEYS, projectId, svc, sanitized);

  // Sync to ACL service per-user credentials (if configured)
  if (c.env.ACL_URL && c.env.ACL_SECRET) {
    c.executionCtx.waitUntil(
      fetch(`${c.env.ACL_URL}/credentials/${encodeURIComponent(email)}/${encodeURIComponent(svc)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ACL-Secret": c.env.ACL_SECRET,
        },
        body: JSON.stringify(sanitized),
      }).catch(() => {}),
    );
  }

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "set_credentials", service: svc }),
    ]),
  );

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

  // Remove credentials from all KV keys
  await syncCredentialsToKV(c.env.PORTAL_DB, c.env.MCP_KEYS, projectId, svc, null);

  // Remove from ACL service per-user credentials (if configured)
  if (c.env.ACL_URL && c.env.ACL_SECRET) {
    c.executionCtx.waitUntil(
      fetch(`${c.env.ACL_URL}/credentials/${encodeURIComponent(email)}/${encodeURIComponent(svc)}`, {
        method: "DELETE",
        headers: { "X-ACL-Secret": c.env.ACL_SECRET },
      }).catch(() => {}),
    );
  }

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

  // Get project credentials to merge into KV
  const credentials = await getDecryptedCredentials(
    c.env.PORTAL_DB,
    projectId,
    svc,
    c.env.CREDENTIALS_KEY,
  );

  // Write to KV (runtime auth path)
  const kvMeta: Record<string, unknown> = {
    name,
    service: svc,
    created_at: new Date().toISOString(),
    created_by: email,
    project_id: projectId,
  };
  if (credentials) {
    kvMeta.credentials = credentials;
  }
  await c.env.MCP_KEYS.put(keyId, JSON.stringify(kvMeta));

  // Write to D1 (metadata store)
  await c.env.PORTAL_DB
    .prepare("INSERT INTO mcp_keys (key_id, project_id, service_id, name, created_by) VALUES (?, ?, ?, ?, ?)")
    .bind(keyId, projectId, svc, name, email)
    .run();

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "create", service: svc }),
    ]),
  );

  return c.json({
    key: keyId,
    name,
    service: svc,
    project_id: projectId,
    created_at: kvMeta.created_at,
  }, 201);
});

app.delete("/api/projects/:projectId/services/:svc/keys/:key", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc, key } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  if (!key.startsWith("mcp_")) return c.json({ error: "invalid key" }, 400);

  // Verify key belongs to this project+service
  const keyRow = await c.env.PORTAL_DB
    .prepare("SELECT key_id FROM mcp_keys WHERE key_id = ? AND project_id = ? AND service_id = ?")
    .bind(key, projectId, svc)
    .first();

  if (!keyRow) return c.json({ error: "key not found" }, 404);

  await c.env.MCP_KEYS.delete(key);
  await c.env.PORTAL_DB.prepare("DELETE FROM mcp_keys WHERE key_id = ?").bind(key).run();

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "delete", service: svc }),
    ]),
  );

  return c.json({ ok: true });
});

export { app as credentials };
