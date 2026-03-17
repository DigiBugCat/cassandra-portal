import { Hono } from "hono";
import { pushMetrics, counter } from "cassandra-observability";
import { getUserEmail } from "./auth";
import { encrypt } from "./db";

/**
 * Runner configuration — account-level auth token + per-vault E2EE passwords.
 *
 * Auth store layout:
 *   cred:{email}:runner          → { OBSIDIAN_AUTH_TOKEN: "..." }
 *   cred:{email}:runner:{vault}  → { OBSIDIAN_E2EE_PASSWORD: "..." }
 *
 * The runner orchestrator fetches both at session spawn and merges them.
 *
 * Security:
 * - Auth: CF Access (user email from header/JWT)
 * - At rest: AES-GCM encrypted in D1 (CREDENTIALS_KEY)
 * - API never returns plaintext — only metadata
 * - ACL sync uses X-Auth-Secret service-to-service auth
 */

const OBSIDIAN_API = "https://api.obsidian.md";
const SUPPORTED_ENCRYPTION_VERSION = 3;

interface ObsidianVault {
  id: string;
  name: string;
  host: string;
  salt: string;
  password?: string;
  encryption_version: number;
}

interface ObsidianVaultListResponse {
  vaults: ObsidianVault[];
  shared: ObsidianVault[];
}

const app = new Hono<{ Bindings: Env }>();

function authSync(env: Env, email: string, service: string, body: Record<string, string> | null) {
  if (!env.AUTH_SECRET || (!env.AUTH_SERVICE && !env.AUTH_URL)) return;
  const path = `/credentials/${encodeURIComponent(email)}/${encodeURIComponent(service)}`;
  const headers: Record<string, string> = { "X-Auth-Secret": env.AUTH_SECRET };
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  const init: RequestInit = {
    method: body ? "POST" : "DELETE",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };
  if (env.AUTH_SERVICE) {
    return env.AUTH_SERVICE.fetch(new Request(`https://auth-internal${path}`, init)).catch(() => {});
  }
  return fetch(`${env.AUTH_URL}${path}`, init).catch(() => {});
}

// ── Account-level auth token ──

// GET /api/runner/config — account metadata + list of vaults
app.get("/api/runner/config", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const accountRow = await c.env.PORTAL_DB
    .prepare("SELECT updated_at, updated_by FROM runner_config WHERE email = ?")
    .bind(email)
    .first<{ updated_at: string; updated_by: string }>();

  const { results: vaultRows } = await c.env.PORTAL_DB
    .prepare("SELECT vault, updated_at FROM runner_vaults WHERE email = ? ORDER BY vault ASC")
    .bind(email)
    .all<{ vault: string; updated_at: string }>();

  return c.json({
    auth_token: {
      configured: !!accountRow,
      updated_at: accountRow?.updated_at ?? null,
    },
    vaults: (vaultRows || []).map((v) => ({
      vault: v.vault,
      updated_at: v.updated_at,
    })),
  });
});

// PUT /api/runner/config/auth — set account-level Obsidian auth token
app.put("/api/runner/config/auth", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const { token } = await c.req.json<{ token?: string }>();
  if (!token?.trim()) return c.json({ error: "token is required" }, 400);

  const encrypted = await encrypt(JSON.stringify({ OBSIDIAN_AUTH_TOKEN: token.trim() }), c.env.CREDENTIALS_KEY);

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

  c.executionCtx.waitUntil(authSync(c.env, email, "runner", { OBSIDIAN_AUTH_TOKEN: token.trim() }) ?? Promise.resolve());

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [counter("mcp_key_operations_total", 1, { operation: "set_runner_auth", service: "runner" })]),
  );

  return c.json({ ok: true });
});

// DELETE /api/runner/config/auth — remove account-level auth token
app.delete("/api/runner/config/auth", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  await c.env.PORTAL_DB
    .prepare("DELETE FROM runner_config WHERE email = ?")
    .bind(email)
    .run();

  c.executionCtx.waitUntil(authSync(c.env, email, "runner", null) ?? Promise.resolve());

  return c.json({ ok: true });
});

// ── List remote vaults (queries Obsidian API with the stored auth token) ──

app.get("/api/runner/config/vaults", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  // Get the stored auth token (decrypt it)
  const row = await c.env.PORTAL_DB
    .prepare("SELECT credentials_encrypted FROM runner_config WHERE email = ?")
    .bind(email)
    .first<{ credentials_encrypted: string }>();

  if (!row) return c.json({ error: "auth token not configured — set it first" }, 400);

  const { decrypt } = await import("./db");
  const creds = JSON.parse(await decrypt(row.credentials_encrypted, c.env.CREDENTIALS_KEY)) as Record<string, string>;
  const token = creds.OBSIDIAN_AUTH_TOKEN;
  if (!token) return c.json({ error: "auth token not found in stored credentials" }, 400);

  try {
    const res = await fetch(`${OBSIDIAN_API}/vault/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, supported_encryption_version: SUPPORTED_ENCRYPTION_VERSION }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return c.json({ error: (body as { error?: string }).error || `Obsidian API returned ${res.status}` }, 502);
    }

    const data = await res.json() as ObsidianVaultListResponse;
    const vaults = [...(data.vaults || []), ...(data.shared || [])].map((v) => ({
      id: v.id,
      name: v.name,
    }));

    return c.json({ vaults });
  } catch (err) {
    return c.json({ error: `Failed to fetch vaults: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
});

// ── Per-vault E2EE passwords ──

// PUT /api/runner/config/vaults/:vault — set E2EE password for a vault
app.put("/api/runner/config/vaults/:vault", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();
  if (!vault) return c.json({ error: "vault name is required" }, 400);

  const { password } = await c.req.json<{ password?: string }>();
  if (!password?.trim()) return c.json({ error: "password is required" }, 400);

  const encrypted = await encrypt(JSON.stringify({ OBSIDIAN_E2EE_PASSWORD: password.trim() }), c.env.CREDENTIALS_KEY);

  await c.env.PORTAL_DB
    .prepare(
      `INSERT INTO runner_vaults (email, vault, e2ee_encrypted, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email, vault) DO UPDATE SET
         e2ee_encrypted = excluded.e2ee_encrypted,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    )
    .bind(email, vault, encrypted, email)
    .run();

  c.executionCtx.waitUntil(
    authSync(c.env, email, `runner:${vault}`, { OBSIDIAN_E2EE_PASSWORD: password.trim() }) ?? Promise.resolve(),
  );

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [counter("mcp_key_operations_total", 1, { operation: "set_runner_vault", service: "runner" })]),
  );

  return c.json({ ok: true });
});

// DELETE /api/runner/config/vaults/:vault — remove a vault's E2EE password
app.delete("/api/runner/config/vaults/:vault", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();

  await c.env.PORTAL_DB
    .prepare("DELETE FROM runner_vaults WHERE email = ? AND vault = ?")
    .bind(email, vault)
    .run();

  c.executionCtx.waitUntil(authSync(c.env, email, `runner:${vault}`, null) ?? Promise.resolve());

  return c.json({ ok: true });
});

// ── Per-vault MCP servers ──

// GET /api/runner/config/vaults/:vault/mcp — get MCP server config for a vault
app.get("/api/runner/config/vaults/:vault/mcp", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();
  const row = await c.env.PORTAL_DB
    .prepare("SELECT mcp_servers_encrypted FROM runner_vaults WHERE email = ? AND vault = ?")
    .bind(email, vault)
    .first<{ mcp_servers_encrypted: string | null }>();

  if (!row || !row.mcp_servers_encrypted) {
    return c.json({ mcpServers: {} });
  }

  const { decrypt } = await import("./db");
  const servers = JSON.parse(await decrypt(row.mcp_servers_encrypted, c.env.CREDENTIALS_KEY));
  return c.json({ mcpServers: servers });
});

// PUT /api/runner/config/vaults/:vault/mcp — set MCP servers for a vault
app.put("/api/runner/config/vaults/:vault/mcp", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();
  if (!vault) return c.json({ error: "vault name is required" }, 400);

  const { mcpServers } = await c.req.json<{ mcpServers?: Record<string, any> }>();
  if (!mcpServers || typeof mcpServers !== "object") {
    return c.json({ error: "mcpServers object is required" }, 400);
  }

  const encrypted = await encrypt(JSON.stringify(mcpServers), c.env.CREDENTIALS_KEY);

  // Ensure vault row exists (may not have E2EE password)
  await c.env.PORTAL_DB
    .prepare(
      `INSERT INTO runner_vaults (email, vault, e2ee_encrypted, mcp_servers_encrypted, updated_by)
       VALUES (?, ?, '', ?, ?)
       ON CONFLICT(email, vault) DO UPDATE SET
         mcp_servers_encrypted = excluded.mcp_servers_encrypted,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    )
    .bind(email, vault, encrypted, email)
    .run();

  // Sync to auth store so orchestrator can fetch at session creation
  c.executionCtx.waitUntil(
    authSync(c.env, email, `runner:${vault}:mcp`, mcpServers) ?? Promise.resolve(),
  );

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [counter("mcp_key_operations_total", 1, { operation: "set_vault_mcp", service: "runner" })]),
  );

  return c.json({ ok: true, serverCount: Object.keys(mcpServers).length });
});

// DELETE /api/runner/config/vaults/:vault/mcp — remove MCP config for a vault
app.delete("/api/runner/config/vaults/:vault/mcp", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();

  await c.env.PORTAL_DB
    .prepare("UPDATE runner_vaults SET mcp_servers_encrypted = NULL, updated_at = datetime('now') WHERE email = ? AND vault = ?")
    .bind(email, vault)
    .run();

  c.executionCtx.waitUntil(authSync(c.env, email, `runner:${vault}:mcp`, null) ?? Promise.resolve());

  return c.json({ ok: true });
});

export { app as runnerConfig };
