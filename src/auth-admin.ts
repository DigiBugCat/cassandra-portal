import { Hono } from "hono";
import { getUserEmail } from "./auth";
import { authFetch } from "./env";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

/** Proxy a request to the auth service. */
async function proxyToAuth(
  c: { env: Env; req: { raw: Request } },
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  if (!c.env.AUTH_SECRET || !c.env.AUTH_URL) {
    return Response.json({ error: "Auth service not configured" }, { status: 501 });
  }

  const email = getUserEmail(c.req.raw);
  if (!email) {
    return Response.json({ error: "authenticated user email required" }, { status: 401 });
  }

  const headers: Record<string, string> = { "X-Admin-Email": email };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await authFetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json();
  return Response.json(data, { status: resp.status });
}

app.get("/api/acl/admin/whoami", async (c) => {
  await proxyToAuth(c, "POST", "/acl/register");
  return proxyToAuth(c, "GET", "/acl/whoami");
});

app.get("/api/acl/admin/users", async (c) => proxyToAuth(c, "GET", "/acl/users"));
app.put("/api/acl/admin/users/:email", async (c) => proxyToAuth(c, "PUT", `/acl/users/${encodeURIComponent(c.req.param("email"))}`, await c.req.json()));
app.delete("/api/acl/admin/users/:email", async (c) => proxyToAuth(c, "DELETE", `/acl/users/${encodeURIComponent(c.req.param("email"))}`));

app.get("/api/acl/admin/groups", async (c) => proxyToAuth(c, "GET", "/acl/groups"));
app.put("/api/acl/admin/groups/:name", async (c) => proxyToAuth(c, "PUT", `/acl/groups/${encodeURIComponent(c.req.param("name"))}`, await c.req.json()));
app.delete("/api/acl/admin/groups/:name", async (c) => proxyToAuth(c, "DELETE", `/acl/groups/${encodeURIComponent(c.req.param("name"))}`));

app.get("/api/acl/admin/domains", async (c) => proxyToAuth(c, "GET", "/acl/domains"));
app.put("/api/acl/admin/domains/:domain", async (c) => proxyToAuth(c, "PUT", `/acl/domains/${encodeURIComponent(c.req.param("domain"))}`, await c.req.json()));
app.delete("/api/acl/admin/domains/:domain", async (c) => proxyToAuth(c, "DELETE", `/acl/domains/${encodeURIComponent(c.req.param("domain"))}`));

app.post("/api/acl/admin/test", async (c) => proxyToAuth(c, "POST", "/acl/test", await c.req.json()));
app.get("/api/acl/admin/policy", async (c) => proxyToAuth(c, "GET", "/acl/policy"));
app.put("/api/acl/admin/policy", async (c) => proxyToAuth(c, "PUT", "/acl/policy", await c.req.json()));

export { app as authAdmin };
