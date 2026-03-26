import { Hono } from "hono";
import {
  ensurePersonalProject,
  generateId,
  getProject,
  getMemberRole,
  listMembers,
  listUserProjects,
} from "./db";
import { getUserEmail } from "./auth";
import { authFetch } from "./env";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/projects", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  await ensurePersonalProject(c.env.PORTAL_DB, email);
  const projects = await listUserProjects(c.env.PORTAL_DB, email);
  return c.json(projects);
});

app.post("/api/projects", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const body = await c.req.json<{ name?: string; kind?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  const kind = body.kind === "personal" ? "personal" : "shared";

  if (kind === "personal") {
    const existing = await c.env.PORTAL_DB
      .prepare("SELECT id FROM projects WHERE owner_email = ? AND kind = 'personal'")
      .bind(email)
      .first();
    if (existing) return c.json({ error: "personal project already exists" }, 409);
  }

  const id = generateId();
  await c.env.PORTAL_DB
    .prepare("INSERT INTO projects (id, name, kind, owner_email) VALUES (?, ?, ?, ?)")
    .bind(id, name, kind, email)
    .run();

  await c.env.PORTAL_DB
    .prepare("INSERT INTO project_members (project_id, email, role) VALUES (?, ?, 'owner')")
    .bind(id, email)
    .run();

  return c.json({ id, name, kind, owner_email: email }, 201);
});

app.patch("/api/projects/:id", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const projectId = c.req.param("id");
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);
  if (role !== "owner") return c.json({ error: "only the owner can rename a project" }, 403);

  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  await c.env.PORTAL_DB
    .prepare("UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(name, projectId)
    .run();

  return c.json({ ok: true });
});

app.delete("/api/projects/:id", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const projectId = c.req.param("id");
  const project = await getProject(c.env.PORTAL_DB, projectId);
  if (!project) return c.json({ error: "not found" }, 404);

  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (role !== "owner") return c.json({ error: "only the owner can delete a project" }, 403);
  if (project.kind === "personal") return c.json({ error: "cannot delete personal project" }, 400);

  // Delete MCP keys from auth service
  const { results: keys } = await c.env.PORTAL_DB
    .prepare("SELECT key_id FROM mcp_keys WHERE project_id = ?")
    .bind(projectId)
    .all<{ key_id: string }>();

  for (const key of keys) {
    try { await authFetch(`/keys/${key.key_id}`, { method: "DELETE" }); } catch { /* logged by authFetch */ }
  }

  await c.env.PORTAL_DB.prepare("DELETE FROM projects WHERE id = ?").bind(projectId).run();
  return c.json({ ok: true });
});

// ── Members ──

app.get("/api/projects/:id/members", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const projectId = c.req.param("id");
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);

  const members = await listMembers(c.env.PORTAL_DB, projectId);
  return c.json(members);
});

app.post("/api/projects/:id/members", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const projectId = c.req.param("id");
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);
  if (role !== "owner") return c.json({ error: "only the owner can add members" }, 403);

  const project = await getProject(c.env.PORTAL_DB, projectId);
  if (project?.kind === "personal") return c.json({ error: "cannot add members to personal project" }, 400);

  const body = await c.req.json<{ email?: string; role?: string }>();
  const memberEmail = body.email?.trim().toLowerCase();
  if (!memberEmail) return c.json({ error: "email is required" }, 400);

  const existing = await getMemberRole(c.env.PORTAL_DB, projectId, memberEmail);
  if (existing) return c.json({ error: "user is already a member" }, 409);

  const memberRole = body.role === "owner" ? "owner" : "member";
  await c.env.PORTAL_DB
    .prepare("INSERT INTO project_members (project_id, email, role) VALUES (?, ?, ?)")
    .bind(projectId, memberEmail, memberRole)
    .run();

  return c.json({ project_id: projectId, email: memberEmail, role: memberRole }, 201);
});

app.patch("/api/projects/:id/members/:email", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const projectId = c.req.param("id");
  const targetEmail = c.req.param("email");
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);
  if (role !== "owner") return c.json({ error: "only the owner can change roles" }, 403);

  const body = await c.req.json<{ role?: string }>();
  const newRole = body.role === "owner" ? "owner" : "member";
  await c.env.PORTAL_DB
    .prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND email = ?")
    .bind(newRole, projectId, targetEmail)
    .run();

  return c.json({ ok: true });
});

app.delete("/api/projects/:id/members/:email", async (c) => {
  const email = getUserEmail(c.req.raw);
  if (!email) return c.json({ error: "authenticated user email is required" }, 401);

  const projectId = c.req.param("id");
  const targetEmail = c.req.param("email");
  const role = await getMemberRole(c.env.PORTAL_DB, projectId, email);
  if (!role) return c.json({ error: "not found" }, 404);
  if (role !== "owner") return c.json({ error: "only the owner can remove members" }, 403);
  if (targetEmail === email) return c.json({ error: "cannot remove yourself" }, 400);

  await c.env.PORTAL_DB
    .prepare("DELETE FROM project_members WHERE project_id = ? AND email = ?")
    .bind(projectId, targetEmail)
    .run();

  return c.json({ ok: true });
});

export { app as projects };
