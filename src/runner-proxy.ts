import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/tokens", async (c) => {
  const resp = await fetch(`${c.env.RUNNER_URL}/tenants`, {
    headers: { "X-API-Key": c.env.RUNNER_ADMIN_KEY },
  });
  if (!resp.ok) return c.json({ error: `Failed to list tenants: ${resp.status}` }, 500);
  const data = (await resp.json()) as { tenants?: unknown[] };
  return c.json(data.tenants || []);
});

app.post("/api/tokens", async (c) => {
  const { name } = await c.req.json<{ name?: string }>();
  if (!name) return c.json({ error: "name is required" }, 400);

  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 32);

  const resp = await fetch(`${c.env.RUNNER_URL}/tenants`, {
    method: "POST",
    headers: {
      "X-API-Key": c.env.RUNNER_ADMIN_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, name }),
  });
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

app.delete("/api/tokens/:id", async (c) => {
  const id = c.req.param("id");
  const resp = await fetch(`${c.env.RUNNER_URL}/tenants/${id}`, {
    method: "DELETE",
    headers: { "X-API-Key": c.env.RUNNER_ADMIN_KEY },
  });
  if (!resp.ok) return c.json({ error: `Failed to delete tenant: ${resp.status}` }, 500);
  return c.json({ ok: true });
});

export { app as runnerProxy };
