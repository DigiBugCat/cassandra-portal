import { Hono } from "hono";
import type { Context } from "hono";
import { getUserEmail } from "./auth";

const app = new Hono<{ Bindings: Env }>();

async function fetchRunner(
  c: Context<{ Bindings: Env }>,
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(`${c.env.RUNNER_URL}${path}`, init);
  } catch {
    return null;
  }
}

function normalizeTenantName(name?: string): string {
  return name?.trim() || "";
}

function buildTenantId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
}

app.get("/api/tokens", async (c) => {
  const resp = await fetchRunner(c, "/tenants", {
    headers: { "X-API-Key": c.env.RUNNER_ADMIN_KEY },
  });
  if (!resp) return c.json({ error: "Runner unavailable" }, 502);
  if (!resp.ok) return c.json({ error: `Failed to list tenants: ${resp.status}` }, 500);
  const data = (await resp.json()) as { tenants?: unknown[] };
  return c.json(data.tenants || []);
});

app.post("/api/tokens", async (c) => {
  const email = getUserEmail(c.req.raw);
  const { name: rawName } = await c.req.json<{ name?: string }>();
  const name = normalizeTenantName(rawName);
  if (!name) return c.json({ error: "name is required" }, 400);

  const id = buildTenantId(name);
  if (!id) return c.json({ error: "name must contain letters or numbers" }, 400);

  const resp = await fetchRunner(c, "/tenants", {
    method: "POST",
    headers: {
      "X-API-Key": c.env.RUNNER_ADMIN_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, name, email }),
  });
  if (!resp) return c.json({ error: "Runner unavailable" }, 502);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}) as Record<string, string>);
    return c.json({ error: (err as Record<string, string>).error || `Failed: ${resp.status}` }, 500);
  }

  const data = (await resp.json()) as { id: string; name: string; api_key: string };
  return c.json({
    id: data.id,
    name: data.name,
    api_key: data.api_key,
    created_at: new Date().toISOString(),
  });
});

app.post("/api/tokens/:id/rotate-key", async (c) => {
  const id = c.req.param("id");
  const resp = await fetchRunner(c, `/tenants/${id}/rotate-key`, {
    method: "POST",
    headers: { "X-API-Key": c.env.RUNNER_ADMIN_KEY },
  });
  if (!resp) return c.json({ error: "Runner unavailable" }, 502);
  if (!resp.ok) return c.json({ error: `Failed to rotate key: ${resp.status}` }, 500);
  const data = (await resp.json()) as { api_key: string };
  return c.json({ api_key: data.api_key });
});

app.delete("/api/tokens/:id", async (c) => {
  const id = c.req.param("id");
  const resp = await fetchRunner(c, `/tenants/${id}`, {
    method: "DELETE",
    headers: { "X-API-Key": c.env.RUNNER_ADMIN_KEY },
  });
  if (!resp) return c.json({ error: "Runner unavailable" }, 502);
  if (!resp.ok) return c.json({ error: `Failed to delete tenant: ${resp.status}` }, 500);
  return c.json({ ok: true });
});

export { app as runnerProxy };
