// Thin fetch wrappers for portal API

// ── Config (cached) ──
let _domain: string | null = null;
export async function getDomain(): Promise<string> {
  if (_domain !== null) return _domain;
  const res = await fetch("/api/config");
  const data = await res.json() as { domain: string };
  _domain = data.domain;
  return _domain;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Projects ──

export interface Project {
  id: string;
  name: string;
  kind: "personal" | "shared";
  owner_email: string;
  created_at: string;
  updated_at: string;
}

export interface Member {
  project_id: string;
  email: string;
  role: "owner" | "member";
  created_at: string;
}

export const projects = {
  list: () => request<Project[]>("/api/projects"),
  create: (name: string, kind = "shared") =>
    request<Project>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind }),
    }),
  update: (id: string, name: string) =>
    request("/api/projects/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) =>
    request("/api/projects/" + id, { method: "DELETE" }),
};

export const members = {
  list: (projectId: string) =>
    request<Member[]>(`/api/projects/${projectId}/members`),
  add: (projectId: string, email: string, role = "member") =>
    request(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    }),
  updateRole: (projectId: string, email: string, role: string) =>
    request(`/api/projects/${projectId}/members/${email}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }),
  remove: (projectId: string, email: string) =>
    request(`/api/projects/${projectId}/members/${email}`, { method: "DELETE" }),
};

// ── Services ──

export interface CredentialFieldDef {
  key: string;
  label: string;
  required: boolean;
  type?: "text" | "textarea";
  hint?: string;
}

export interface McpService {
  id: string;
  name: string;
  description: string;
  status: "active" | "planned";
  category: "media" | "notifications" | "data" | "tools";
  tools?: string[];
  credentialsSchema?: CredentialFieldDef[];
  serviceCredentialsSchema?: CredentialFieldDef[];
}

export const services = {
  list: () => request<McpService[]>("/api/mcp-services"),
};

// ── Credentials ──

export interface CredentialMeta {
  has_credentials: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export const credentials = {
  get: (projectId: string, serviceId: string) =>
    request<CredentialMeta>(`/api/projects/${projectId}/services/${serviceId}/credentials`),
  set: (projectId: string, serviceId: string, creds: Record<string, string>) =>
    request(`/api/projects/${projectId}/services/${serviceId}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    }),
  remove: (projectId: string, serviceId: string) =>
    request(`/api/projects/${projectId}/services/${serviceId}/credentials`, { method: "DELETE" }),
};

// ── Service-Level Credentials (global) ──

export const serviceCredentials = {
  get: (serviceId: string) =>
    request<{ credentials: Record<string, string> | null }>(`/api/service-credentials/${serviceId}`),
  set: (serviceId: string, creds: Record<string, string>) =>
    request(`/api/service-credentials/${serviceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    }),
  remove: (serviceId: string) =>
    request(`/api/service-credentials/${serviceId}`, { method: "DELETE" }),
};

// ── Keys ──

export interface McpKey {
  key_id: string;
  project_id: string;
  service_id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export interface CreatedKey {
  key: string;
  name: string;
  service: string;
  project_id: string;
  created_at: string;
}

export const keys = {
  list: (projectId: string, serviceId: string) =>
    request<McpKey[]>(`/api/projects/${projectId}/services/${serviceId}/keys`),
  create: (projectId: string, serviceId: string, name: string) =>
    request<CreatedKey>(`/api/projects/${projectId}/services/${serviceId}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  delete: (projectId: string, serviceId: string, keyId: string) =>
    request(`/api/projects/${projectId}/services/${serviceId}/keys/${keyId}`, { method: "DELETE" }),
  rotate: (projectId: string, serviceId: string, keyId: string) =>
    request<{ key: string; name: string }>(`/api/projects/${projectId}/services/${serviceId}/keys/${keyId}/rotate`, { method: "POST" }),
};

// ── Runner config (Obsidian auth token + per-vault E2EE) ──

export interface RunnerConfigMeta {
  auth_token: { configured: boolean; updated_at: string | null };
  vaults: { vault: string; updated_at: string }[];
}

export const runnerConfig = {
  get: () => request<RunnerConfigMeta>("/api/runner/config"),
  setAuth: (token: string) =>
    request("/api/runner/config/auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),
  removeAuth: () => request("/api/runner/config/auth", { method: "DELETE" }),
  listVaults: () => request<{ vaults: { id: string; name: string }[] }>("/api/runner/config/vaults"),
  setVault: (vault: string, password: string) =>
    request(`/api/runner/config/vaults/${encodeURIComponent(vault)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  removeVault: (vault: string) =>
    request(`/api/runner/config/vaults/${encodeURIComponent(vault)}`, { method: "DELETE" }),
  getVaultMcp: (vault: string) =>
    request<{ mcpServers: Record<string, any> }>(`/api/runner/config/vaults/${encodeURIComponent(vault)}/mcp`),
  setVaultMcp: (vault: string, mcpServers: Record<string, any>) =>
    request(`/api/runner/config/vaults/${encodeURIComponent(vault)}/mcp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcpServers }),
    }),
  removeVaultMcp: (vault: string) =>
    request(`/api/runner/config/vaults/${encodeURIComponent(vault)}/mcp`, { method: "DELETE" }),
};

// ── Runner tokens (tenant keys) ──

export interface RunnerToken {
  id: string;
  name: string;
  namespace: string;
  max_sessions: number;
  email?: string;
  created_at: string;
  api_key?: string;
}

export const runnerTokens = {
  list: () => request<RunnerToken[]>("/api/tokens"),
  create: (name: string) =>
    request<RunnerToken>("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  rotateKey: (id: string) =>
    request<{ api_key: string }>(`/api/tokens/${id}/rotate-key`, { method: "POST" }),
  delete: (id: string) => request("/api/tokens/" + id, { method: "DELETE" }),
};

// ── ACL ──

export interface ToolAccess {
  [tool: string]: { allowed: boolean; reason?: string };
}

export const acl = {
  checkTools: (serviceId: string, tools: string[]) =>
    request<ToolAccess>(`/api/acl/${serviceId}/tools?tools=${tools.join(",")}`),
};

// ── ACL Admin ──

const jsonHeaders = { "Content-Type": "application/json" };

export interface AclWhoami {
  email: string;
  role: string;
  groups: string[];
  isAdmin: boolean;
}

export interface AclUserEntry {
  role?: "admin" | "user";
  services?: "*" | string[];
  groups?: string[];
}

export interface AclServiceConfig {
  access?: "allow" | "deny";
  tools?: { allow?: string[]; deny?: string[] };
}

export interface AclGroupEntry {
  services: Record<string, AclServiceConfig>;
}

export interface AclDomainEntry {
  role?: "admin" | "user";
  groups?: string[];
}

export const aclAdmin = {
  whoami: () => request<AclWhoami>("/api/acl/admin/whoami"),
  users: {
    list: () => request<Record<string, AclUserEntry>>("/api/acl/admin/users"),
    upsert: (email: string, user: AclUserEntry) =>
      request(`/api/acl/admin/users/${encodeURIComponent(email)}`, {
        method: "PUT", headers: jsonHeaders, body: JSON.stringify(user),
      }),
    remove: (email: string) =>
      request(`/api/acl/admin/users/${encodeURIComponent(email)}`, { method: "DELETE" }),
  },
  groups: {
    list: () => request<Record<string, AclGroupEntry>>("/api/acl/admin/groups"),
    upsert: (name: string, group: AclGroupEntry) =>
      request(`/api/acl/admin/groups/${encodeURIComponent(name)}`, {
        method: "PUT", headers: jsonHeaders, body: JSON.stringify(group),
      }),
    remove: (name: string) =>
      request(`/api/acl/admin/groups/${encodeURIComponent(name)}`, { method: "DELETE" }),
  },
  domains: {
    list: () => request<Record<string, AclDomainEntry>>("/api/acl/admin/domains"),
    upsert: (domain: string, def: AclDomainEntry) =>
      request(`/api/acl/admin/domains/${encodeURIComponent(domain)}`, {
        method: "PUT", headers: jsonHeaders, body: JSON.stringify(def),
      }),
    remove: (domain: string) =>
      request(`/api/acl/admin/domains/${encodeURIComponent(domain)}`, { method: "DELETE" }),
  },
  test: (email: string, service: string, tool: string) =>
    request<{ allowed: boolean; reason: string }>("/api/acl/admin/test", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ email, service, tool }),
    }),
};

// ── Discord MCP Guilds ──

export interface DiscordGuild {
  guild_id: string;
  name: string;
  icon_url: string | null;
  enabled: boolean;
}

export const discordGuilds = {
  list: () => request<{ guilds: DiscordGuild[]; enabled: string[] }>("/api/discord-mcp/guilds"),
  enable: (guildId: string) =>
    request<{ ok: boolean; enabled: string[] }>(`/api/discord-mcp/guilds/${encodeURIComponent(guildId)}/enable`, { method: "POST" }),
  disable: (guildId: string) =>
    request<{ ok: boolean; enabled: string[] }>(`/api/discord-mcp/guilds/${encodeURIComponent(guildId)}/disable`, { method: "POST" }),
};

// ── User info from CF Access JWT cookie ──

export function getUserEmailFromCookie(): string {
  try {
    const jwt = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("CF_Authorization="));
    if (jwt) {
      const payload = JSON.parse(atob(jwt.split("=")[1].split(".")[1]));
      return payload.email || "unknown";
    }
  } catch {
    // ignore
  }
  return "authenticated";
}
