import { Hono } from "hono";
import { loadEnv, authFetch } from "./env";
import type { Env } from "./env";
import { getUserEmail } from "./auth";
import { mcpKeys } from "./mcp-keys";
import { projects } from "./projects";
import { credentials } from "./credentials";
import { authAdmin } from "./auth-admin";
import { runnerConfig } from "./runner-config";
import { discordMcpProxy } from "./discord-mcp-proxy";

const app = new Hono<{ Bindings: Env }>();

// Inject env + log + prevent CF from caching API responses
app.use("*", async (c, next) => {
  console.log(`[${c.req.method}] ${c.req.path} ${c.req.url}`);
  const env = loadEnv();
  (c as any).env = env;
  await next();
  // Prevent Cloudflare from caching API responses
  if (c.req.path.startsWith("/api/")) {
    c.header("Cache-Control", "no-store");
  }
});

// Public config
app.get("/api/config", (c) => {
  return c.json({ domain: c.env.DOMAIN || "" });
});

// Debug (temporary)
app.get("/api/whoami", (c) => {
  const email = getUserEmail(c.req.raw);
  return c.json({ email, fallback: process.env.DEFAULT_USER_EMAIL || "(not set)" });
});


// ACL tool access check
app.get("/api/acl/:service/tools", async (c) => {
  const { getUserEmail } = await import("./auth");
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const service = c.req.param("service");
  const toolsParam = c.req.query("tools");
  if (!toolsParam) return c.json({ error: "tools query param required" }, 400);

  const tools = toolsParam.split(",");

  if (!c.env.AUTH_SECRET || !c.env.AUTH_URL) {
    return c.json(Object.fromEntries(tools.map((t) => [t, { allowed: true }])));
  }

  const results: Record<string, { allowed: boolean; reason?: string }> = {};
  await Promise.all(
    tools.map(async (tool) => {
      try {
        const resp = await authFetch("/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, service, tool }),
        });
        if (resp.ok) {
          results[tool] = (await resp.json()) as { allowed: boolean; reason?: string };
        } else {
          results[tool] = { allowed: true };
        }
      } catch {
        results[tool] = { allowed: true };
      }
    }),
  );

  return c.json(results);
});

// Mount API routes
app.route("/", mcpKeys);
app.route("/", projects);
app.route("/", credentials);
app.route("/", authAdmin);
app.route("/", runnerConfig);
app.route("/", discordMcpProxy);

export default app;
