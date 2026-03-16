import { Hono } from "hono";
import { pushMetrics, counter } from "cassandra-observability";
import { getUserEmail } from "./auth";
import { encrypt } from "./db";

/**
 * Runner configuration — dedicated credential management for the Agent Runner.
 * Credentials are encrypted at rest in D1 and synced to the ACL credential store
 * under cred:{email}:runner for the orchestrator to fetch at session spawn.
 *
 * Security:
 * - Auth: CF Access (user email from header/JWT)
 * - At rest: AES-GCM encrypted in D1 (CREDENTIALS_KEY)
 * - In transit: HTTPS (CF edge) + X-ACL-Secret for service-to-service
 * - API never returns plaintext credentials — only metadata (has_credentials, updated_at)
 * - Only allowlisted fields are stored (OBSIDIAN_AUTH_TOKEN, OBSIDIAN_E2EE_PASSWORD)
 */

const RUNNER_CREDENTIAL_FIELDS = [
  { key: "OBSIDIAN_AUTH_TOKEN", label: "Obsidian Auth Token" },
  { key: "OBSIDIAN_E2EE_PASSWORD", label: "Obsidian E2EE Password" },
] as const;

const ALLOWED_KEYS = new Set<string>(RUNNER_CREDENTIAL_FIELDS.map((f) => f.key));

const app = new Hono<{ Bindings: Env }>();

// GET /api/runner/config — metadata only, never returns plaintext credentials
app.get("/api/runner/config", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const row = await c.env.PORTAL_DB
    .prepare("SELECT updated_at, updated_by FROM runner_config WHERE email = ?")
    .bind(email)
    .first<{ updated_at: string; updated_by: string }>();

  return c.json({
    has_credentials: !!row,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
    fields: RUNNER_CREDENTIAL_FIELDS,
  });
});

// PUT /api/runner/config — save encrypted credentials, sync to ACL
app.put("/api/runner/config", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const body = await c.req.json<Record<string, string>>();

  // Only store allowlisted fields — reject unknown keys
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_KEYS.has(key) && typeof value === "string" && value.trim()) {
      sanitized[key] = value.trim();
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return c.json({ error: "at least one credential field is required" }, 400);
  }

  const encrypted = await encrypt(JSON.stringify(sanitized), c.env.CREDENTIALS_KEY);

  // Upsert in D1
  await c.env.PORTAL_DB
    .prepare(
      `INSERT INTO runner_config (email, credentials_encrypted, updated_by)
       VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         credentials_encrypted = excluded.credentials_encrypted,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    )
    .bind(email, encrypted, email)
    .run();

  // Sync to ACL credential store (fire-and-forget)
  if (c.env.ACL_URL && c.env.ACL_SECRET) {
    c.executionCtx.waitUntil(
      fetch(`${c.env.ACL_URL}/credentials/${encodeURIComponent(email)}/runner`, {
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
      counter("mcp_key_operations_total", 1, { operation: "set_runner_config", service: "runner" }),
    ]),
  );

  return c.json({ ok: true });
});

// DELETE /api/runner/config — remove credentials from D1 and ACL
app.delete("/api/runner/config", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  await c.env.PORTAL_DB
    .prepare("DELETE FROM runner_config WHERE email = ?")
    .bind(email)
    .run();

  // Remove from ACL credential store (fire-and-forget)
  if (c.env.ACL_URL && c.env.ACL_SECRET) {
    c.executionCtx.waitUntil(
      fetch(`${c.env.ACL_URL}/credentials/${encodeURIComponent(email)}/runner`, {
        method: "DELETE",
        headers: { "X-ACL-Secret": c.env.ACL_SECRET },
      }).catch(() => {}),
    );
  }

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "delete_runner_config", service: "runner" }),
    ]),
  );

  return c.json({ ok: true });
});

export { app as runnerConfig };
