import { Hono } from "hono";
import { pushMetrics, counter } from "cassandra-observability";
import { runnerProxy } from "./runner-proxy";
import { mcpKeys } from "./mcp-keys";
import { projects } from "./projects";
import { credentials } from "./credentials";
import { authAdmin } from "./auth-admin";
import { runnerConfig } from "./runner-config";
import { discordMcpProxy } from "./discord-mcp-proxy";

const app = new Hono<{ Bindings: Env }>();

// Metrics middleware — track all requests
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const path = new URL(c.req.url).pathname;
  const isApi = path.startsWith("/api/");
  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_requests_total", 1, {
        service: "portal",
        status: String(c.res.status),
        path: isApi ? path : "/",
      }),
      counter("mcp_request_duration_ms_total", duration, {
        service: "portal",
        path: isApi ? path : "/",
      }),
    ]),
  );
});

// Public config (no secrets — just the domain for link generation)
app.get("/api/config", (c) => {
  return c.json({ domain: c.env.DOMAIN || "" });
});

// ACL tool access check — batch check which tools a user can access
app.get("/api/acl/:service/tools", async (c) => {
  const email = (await import("./auth")).getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const service = c.req.param("service");
  const toolsParam = c.req.query("tools");
  if (!toolsParam) return c.json({ error: "tools query param required" }, 400);

  const tools = toolsParam.split(",");

  if (!c.env.AUTH_SECRET || (!c.env.AUTH_SERVICE && !c.env.AUTH_URL)) {
    // No auth service configured — all tools allowed
    return c.json(Object.fromEntries(tools.map((t) => [t, { allowed: true }])));
  }

  // Use Service Binding (preferred) or fallback to AUTH_URL
  const authFetch = (path: string, init: RequestInit) => {
    if (c.env.AUTH_SERVICE) {
      return c.env.AUTH_SERVICE.fetch(new Request(`https://auth-internal${path}`, init));
    }
    return fetch(`${c.env.AUTH_URL}${path}`, init);
  };

  const results: Record<string, { allowed: boolean; reason?: string }> = {};
  await Promise.all(
    tools.map(async (tool) => {
      try {
        const resp = await authFetch("/check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Secret": c.env.AUTH_SECRET!,
          },
          body: JSON.stringify({ email, service, tool }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { allowed: boolean; reason?: string };
          results[tool] = data;
        } else {
          results[tool] = { allowed: true }; // fail open
        }
      } catch {
        results[tool] = { allowed: true }; // fail open
      }
    }),
  );

  return c.json(results);
});

// Mount API routes
app.route("/", runnerProxy);
app.route("/", mcpKeys);
app.route("/", projects);
app.route("/", credentials);
app.route("/", authAdmin);
app.route("/", runnerConfig);
app.route("/", discordMcpProxy);

// For non-API routes, static assets are served by Workers Static Assets (assets.directory in wrangler.jsonc).
// This catch-all returns index.html for SPA client-side routing.
app.all("*", async (c) => {
  // If ASSETS binding exists (Workers Static Assets), serve index.html for SPA routes
  const assets = (c.env as unknown as Record<string, unknown>).ASSETS as { fetch: (req: Request) => Promise<Response> } | undefined;
  if (assets) {
    const url = new URL(c.req.url);
    url.pathname = "/index.html";
    return assets.fetch(new Request(url.toString(), c.req.raw));
  }
  // Fallback: minimal HTML pointing to dev server
  return c.html("<!DOCTYPE html><html><body><p>Frontend not built. Run <code>cd frontend && npm run dev</code></p></body></html>");
});

export default app;
