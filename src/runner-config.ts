import { Hono } from "hono";
import { getUserEmail } from "./auth";
import { encrypt } from "./db";
import { authFetch } from "./env";
import type { Env } from "./env";

const OBSIDIAN_API = "https://api.obsidian.md";
const SUPPORTED_ENCRYPTION_VERSION = 3;

interface ObsidianVaultListResponse {
  vaults: Array<{ id: string; name: string }>;
  shared: Array<{ id: string; name: string }>;
}

const app = new Hono<{ Bindings: Env }>();

/** Sync credentials to auth service (fire-and-forget with logging). */
function authSync(env: Env, email: string, service: string, body: Record<string, string> | null) {
  if (!env.AUTH_SECRET || !env.AUTH_URL) return;
  const path = `/credentials/${encodeURIComponent(email)}/${encodeURIComponent(service)}`;
  authFetch(path, {
    method: body ? "POST" : "DELETE",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).catch((err) => console.warn("Auth sync failed:", err));
}

// GET /api/runner/config
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
    vaults: (vaultRows || []).map((v) => ({ vault: v.vault, updated_at: v.updated_at })),
  });
});

// PUT /api/runner/config/auth
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

  authSync(c.env, email, "runner", { OBSIDIAN_AUTH_TOKEN: token.trim() });
  return c.json({ ok: true });
});

// DELETE /api/runner/config/auth
app.delete("/api/runner/config/auth", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  await c.env.PORTAL_DB
    .prepare("DELETE FROM runner_config WHERE email = ?")
    .bind(email)
    .run();

  authSync(c.env, email, "runner", null);
  return c.json({ ok: true });
});

// GET /api/runner/config/vaults — list remote vaults from Obsidian API
app.get("/api/runner/config/vaults", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

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
      return c.json({ error: body.error || `Obsidian API returned ${res.status}` }, 502);
    }

    const data = await res.json() as ObsidianVaultListResponse;
    const vaults = [...(data.vaults || []), ...(data.shared || [])].map((v) => ({ id: v.id, name: v.name }));
    return c.json({ vaults });
  } catch (err) {
    return c.json({ error: `Failed to fetch vaults: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
});

// PUT /api/runner/config/vaults/:vault
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

  authSync(c.env, email, `runner:${vault}`, { OBSIDIAN_E2EE_PASSWORD: password.trim() });
  return c.json({ ok: true });
});

// DELETE /api/runner/config/vaults/:vault
app.delete("/api/runner/config/vaults/:vault", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();
  await c.env.PORTAL_DB
    .prepare("DELETE FROM runner_vaults WHERE email = ? AND vault = ?")
    .bind(email, vault)
    .run();

  authSync(c.env, email, `runner:${vault}`, null);
  return c.json({ ok: true });
});

// GET /api/runner/config/vaults/:vault/mcp
app.get("/api/runner/config/vaults/:vault/mcp", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();
  const row = await c.env.PORTAL_DB
    .prepare("SELECT mcp_servers_encrypted FROM runner_vaults WHERE email = ? AND vault = ?")
    .bind(email, vault)
    .first<{ mcp_servers_encrypted: string | null }>();

  if (!row || !row.mcp_servers_encrypted) return c.json({ mcpServers: {} });

  const { decrypt } = await import("./db");
  const servers = JSON.parse(await decrypt(row.mcp_servers_encrypted, c.env.CREDENTIALS_KEY));
  return c.json({ mcpServers: servers });
});

// PUT /api/runner/config/vaults/:vault/mcp
app.put("/api/runner/config/vaults/:vault/mcp", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();
  if (!vault) return c.json({ error: "vault name is required" }, 400);

  const { mcpServers } = await c.req.json<{ mcpServers?: Record<string, unknown> }>();
  if (!mcpServers || typeof mcpServers !== "object") return c.json({ error: "mcpServers object is required" }, 400);

  const encrypted = await encrypt(JSON.stringify(mcpServers), c.env.CREDENTIALS_KEY);

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

  authSync(c.env, email, `runner:${vault}:mcp`, mcpServers as Record<string, string>);
  return c.json({ ok: true, serverCount: Object.keys(mcpServers).length });
});

// DELETE /api/runner/config/vaults/:vault/mcp
app.delete("/api/runner/config/vaults/:vault/mcp", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const vault = c.req.param("vault").trim();
  await c.env.PORTAL_DB
    .prepare("UPDATE runner_vaults SET mcp_servers_encrypted = NULL, updated_at = datetime('now') WHERE email = ? AND vault = ?")
    .bind(email, vault)
    .run();

  authSync(c.env, email, `runner:${vault}:mcp`, null);
  return c.json({ ok: true });
});

export { app as runnerConfig };
