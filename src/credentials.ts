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

  // Sync to Auth service per-user credentials
  if (c.env.AUTH_SECRET && (c.env.AUTH_SERVICE || c.env.AUTH_URL)) {
    const credPath = `/credentials/${encodeURIComponent(email)}/${encodeURIComponent(svc)}`;
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Secret": c.env.AUTH_SECRET },
      body: JSON.stringify(sanitized),
    };
    c.executionCtx.waitUntil(
      (c.env.AUTH_SERVICE
        ? c.env.AUTH_SERVICE.fetch(new Request(`https://auth-internal${credPath}`, init))
        : fetch(`${c.env.AUTH_URL}${credPath}`, init)
      ).catch(() => {}),
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

  // Remove from Auth service per-user credentials
  if (c.env.AUTH_SECRET && (c.env.AUTH_SERVICE || c.env.AUTH_URL)) {
    const credPath = `/credentials/${encodeURIComponent(email)}/${encodeURIComponent(svc)}`;
    const init: RequestInit = {
      method: "DELETE",
      headers: { "X-Auth-Secret": c.env.AUTH_SECRET },
    };
    c.executionCtx.waitUntil(
      (c.env.AUTH_SERVICE
        ? c.env.AUTH_SERVICE.fetch(new Request(`https://auth-internal${credPath}`, init))
        : fetch(`${c.env.AUTH_URL}${credPath}`, init)
      ).catch(() => {}),
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

// ── Rotate MCP Key ──

app.post("/api/projects/:projectId/services/:svc/keys/:key/rotate", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { projectId, svc, key: oldKey } = c.req.param();
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  if (!oldKey.startsWith("mcp_")) return c.json({ error: "invalid key" }, 400);

  // Verify key belongs to this project+service
  const keyRow = await c.env.PORTAL_DB
    .prepare("SELECT name FROM mcp_keys WHERE key_id = ? AND project_id = ? AND service_id = ?")
    .bind(oldKey, projectId, svc)
    .first<{ name: string }>();

  if (!keyRow) return c.json({ error: "key not found" }, 404);

  // Read old KV metadata (has credentials, etc.)
  const oldMeta = await c.env.MCP_KEYS.get(oldKey, "json") as Record<string, unknown> | null;

  // Generate new key
  const newKey = `mcp_${randomHex(32)}`;
  const now = new Date().toISOString();

  // Write new KV entry with same metadata
  const newMeta = {
    ...oldMeta,
    name: keyRow.name,
    service: svc,
    created_at: now,
    created_by: email,
    project_id: projectId,
  };
  await c.env.MCP_KEYS.put(newKey, JSON.stringify(newMeta));

  // Delete old KV entry
  await c.env.MCP_KEYS.delete(oldKey);

  // Update D1
  await c.env.PORTAL_DB
    .prepare("UPDATE mcp_keys SET key_id = ?, created_by = ?, created_at = datetime('now') WHERE key_id = ?")
    .bind(newKey, email, oldKey)
    .run();

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "rotate", service: svc }),
    ]),
  );

  return c.json({ key: newKey, name: keyRow.name });
});

// ── Service-Level Credentials (global, admin-managed) ──

async function authFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Auth-Secret", env.AUTH_SECRET || "");
  if (env.AUTH_SERVICE) {
    return env.AUTH_SERVICE.fetch(new Request(`https://auth-internal${path}`, { ...init, headers }));
  }
  return fetch(`${env.AUTH_URL}${path}`, { ...init, headers });
}

app.get("/api/service-credentials/:svc", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const svc = c.req.param("svc");
  const resp = await authFetch(c.env, `/service-credentials/${encodeURIComponent(svc)}`);
  return c.json(await resp.json());
});

app.put("/api/service-credentials/:svc", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const svc = c.req.param("svc");
  const service = MCP_SERVICES.find((s) => s.id === svc);
  if (!service?.serviceCredentialsSchema) return c.json({ error: "service has no service credentials schema" }, 400);

  const body = await c.req.json<Record<string, string>>();

  // Only store schema-defined fields
  const sanitized: Record<string, string> = {};
  for (const field of service.serviceCredentialsSchema) {
    if (body[field.key]) {
      sanitized[field.key] = body[field.key];
    }
  }

  const resp = await authFetch(c.env, `/service-credentials/${encodeURIComponent(svc)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitized),
  });

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "set_service_credentials", service: svc }),
    ]),
  );

  return c.json(await resp.json());
});

app.delete("/api/service-credentials/:svc", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const svc = c.req.param("svc");
  const resp = await authFetch(c.env, `/service-credentials/${encodeURIComponent(svc)}`, {
    method: "DELETE",
  });

  return c.json(await resp.json());
});

export { app as credentials };
