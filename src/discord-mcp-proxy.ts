/**
 * Portal proxy for Discord MCP QR login flow.
 *
 * The portal proxies login requests to the discord-mcp controller
 * so the frontend can initiate QR logins without needing a direct
 * connection to the controller (which is behind CF tunnel).
 *
 * Flow:
 * 1. POST /api/discord-mcp/login/start → starts QR login, returns session_id + qr_url
 * 2. GET  /api/discord-mcp/login/status/:session_id → poll for completion
 */

import { Hono } from "hono";
import { getUserEmail } from "./auth";

const DISCORD_MCP_URL = "https://discord-mcp.cassandrasedge.com";

const app = new Hono<{ Bindings: Env }>();

app.post("/api/discord-mcp/login/start", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  try {
    const resp = await fetch(`${DISCORD_MCP_URL}/login/start`, {
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
    const resp = await fetch(`${DISCORD_MCP_URL}/login/status/${sessionId}`, {
      headers: {
        "X-Auth-Secret": c.env.AUTH_SECRET || "",
        "X-User-Email": email,
      },
    });

    if (!resp.ok) {
      return c.json({ state: "error", error: `Controller error: ${resp.status}` });
    }

    return c.json(await resp.json());
  } catch (err) {
    return c.json({ state: "error", error: `Controller unreachable: ${(err as Error).message}` });
  }
});

export { app as discordMcpProxy };
