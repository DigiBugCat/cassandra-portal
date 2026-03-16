import { Hono } from "hono";
import { pushMetrics, counter } from "cassandra-observability";
import { runnerProxy } from "./runner-proxy";
import { mcpKeys } from "./mcp-keys";
import { projects } from "./projects";
import { credentials } from "./credentials";
import { aclAdmin } from "./acl-admin";

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

  if (!c.env.ACL_URL || !c.env.ACL_SECRET) {
    // No ACL configured — all tools allowed
    return c.json(Object.fromEntries(tools.map((t) => [t, { allowed: true }])));
  }

  const results: Record<string, { allowed: boolean; reason?: string }> = {};
  await Promise.all(
    tools.map(async (tool) => {
      try {
        const resp = await fetch(`${c.env.ACL_URL}/check`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-ACL-Secret": c.env.ACL_SECRET!,
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

// DEBUG: ACL connectivity diagnostic (remove after debugging)
app.get("/api/debug/acl", async (c) => {
  const { getUserEmail } = await import("./auth");
  const email = getUserEmail(c.req.raw);

  const debug: Record<string, unknown> = {
    step1_email: email || "(empty)",
    step2_acl_url: c.env.ACL_URL ? "set" : "NOT SET",
    step3_acl_secret: c.env.ACL_SECRET ? "set" : "NOT SET",
    step4_cf_headers: {
      "Cf-Access-Authenticated-User-Email": c.req.header("Cf-Access-Authenticated-User-Email") || "(missing)",
      "Cf-Access-Jwt-Assertion": c.req.header("Cf-Access-Jwt-Assertion") ? "(present)" : "(missing)",
      "Cookie_has_CF_Authorization": (c.req.header("Cookie") || "").includes("CF_Authorization"),
    },
  };

  // Try calling ACL whoami
  if (email && c.env.ACL_URL && c.env.ACL_SECRET) {
    try {
      const resp = await fetch(`${c.env.ACL_URL}/acl/whoami`, {
        headers: {
          "X-ACL-Secret": c.env.ACL_SECRET,
          "X-Admin-Email": email,
        },
      });
      debug.step5_acl_whoami_status = resp.status;
      debug.step5_acl_whoami_body = await resp.json();
    } catch (e) {
      debug.step5_acl_whoami_error = (e as Error).message;
    }
  }

  return c.json(debug);
});

// Mount API routes
app.route("/", runnerProxy);
app.route("/", mcpKeys);
app.route("/", projects);
app.route("/", credentials);
app.route("/", aclAdmin);

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
