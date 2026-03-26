/**
 * Portal proxy for Discord MCP — login flow + guild management.
 */

import { Hono } from "hono";
import { getUserEmail } from "./auth";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

function discordUrl(c: { env: Env }): string {
  return c.env.DISCORD_MCP_URL || "https://discord-mcp.cassandrasedge.com";
}

app.post("/api/discord-mcp/login/start", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  try {
    const resp = await fetch(`${discordUrl(c)}/login/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Secret": c.env.AUTH_SECRET || "",
        "X-User-Email": email,
      },
      body: JSON.stringify({ email }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      return c.json({ error: `Controller error: ${resp.status} ${body}` }, 502);
    }

    return c.json(await resp.json());
  } catch (err) {
    return c.json({ error: `Failed to reach discord-mcp controller: ${(err as Error).message}` }, 502);
  }
});

app.get("/api/discord-mcp/login/status/:sessionId", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const sessionId = c.req.param("sessionId");

  try {
    const resp = await fetch(`${discordUrl(c)}/login/status/${sessionId}`, {
      headers: {
        "X-Auth-Secret": c.env.AUTH_SECRET || "",
        "X-User-Email": email,
      },
    });

    if (!resp.ok) return c.json({ state: "error", error: `Controller error: ${resp.status}` });
    return c.json(await resp.json());
  } catch (err) {
    return c.json({ state: "error", error: `Controller unreachable: ${(err as Error).message}` });
  }
});

app.get("/api/discord-mcp/guilds", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  try {
    const resp = await fetch(`${discordUrl(c)}/guilds/${encodeURIComponent(email)}`, {
      headers: { "X-Auth-Secret": c.env.AUTH_SECRET || "" },
    });
    if (!resp.ok) return c.json({ guilds: [], enabled: [] });
    return c.json(await resp.json());
  } catch {
    return c.json({ guilds: [], enabled: [] });
  }
});

app.post("/api/discord-mcp/guilds/:guildId/enable", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const guildId = c.req.param("guildId");
  try {
    const resp = await fetch(
      `${discordUrl(c)}/guilds/${encodeURIComponent(email)}/${encodeURIComponent(guildId)}/enable`,
      { method: "POST", headers: { "X-Auth-Secret": c.env.AUTH_SECRET || "" } },
    );
    return c.json(await resp.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.post("/api/discord-mcp/guilds/:guildId/disable", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const guildId = c.req.param("guildId");
  try {
    const resp = await fetch(
      `${discordUrl(c)}/guilds/${encodeURIComponent(email)}/${encodeURIComponent(guildId)}/disable`,
      { method: "POST", headers: { "X-Auth-Secret": c.env.AUTH_SECRET || "" } },
    );
    return c.json(await resp.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

export { app as discordMcpProxy };
