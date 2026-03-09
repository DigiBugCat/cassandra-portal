import { Hono } from "hono";

interface McpKeyMeta {
  name: string;
  created_at: string;
  created_by: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/mcp-keys", async (c) => {
  const list = await c.env.MCP_KEYS.list();
  const keys: Array<{ key: string; name: string; created_at: string; created_by: string }> = [];

  for (const item of list.keys) {
    const meta = await c.env.MCP_KEYS.get<McpKeyMeta>(item.name, "json");
    if (meta) {
      keys.push({
        key: item.name,
        name: meta.name,
        created_at: meta.created_at,
        created_by: meta.created_by,
      });
    }
  }

  return c.json(keys);
});

app.post("/api/mcp-keys", async (c) => {
  const { name } = await c.req.json<{ name?: string }>();
  if (!name) return c.json({ error: "name is required" }, 400);

  const key = `mcp_${randomHex(32)}`;
  const meta: McpKeyMeta = {
    name,
    created_at: new Date().toISOString(),
    created_by: getUserEmail(c.req.raw),
  };

  await c.env.MCP_KEYS.put(key, JSON.stringify(meta));

  return c.json({ key, name: meta.name, created_at: meta.created_at });
});

app.delete("/api/mcp-keys/:key", async (c) => {
  const key = c.req.param("key");
  if (!key.startsWith("mcp_")) return c.json({ error: "invalid key" }, 400);

  const existing = await c.env.MCP_KEYS.get(key);
  if (!existing) return c.json({ error: "key not found" }, 404);

  await c.env.MCP_KEYS.delete(key);
  return c.json({ ok: true });
});

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getUserEmail(request: Request): string {
  try {
    const cookie = request.headers
      .get("Cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("CF_Authorization="));
    if (cookie) {
      const payload = JSON.parse(atob(cookie.split("=")[1].split(".")[1]));
      return payload.email || "unknown";
    }
  } catch {
    // ignore
  }
  return "unknown";
}

export { app as mcpKeys };
