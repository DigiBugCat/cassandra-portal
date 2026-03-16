import { Hono } from "hono";
import { pushMetrics, counter } from "cassandra-observability";
import { getUserEmail } from "./auth";
import { randomHex } from "./db";

interface McpKeyMeta {
  name: string;
  service: string;
  created_at: string;
  created_by: string;
  project_id?: string;
  credentials?: Record<string, string>;
}

export interface CredentialField {
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
  credentialsSchema?: CredentialField[];
}

// Registry of available MCP services (add new services here)
export const MCP_SERVICES: McpService[] = [
  {
    id: "yt-mcp",
    name: "yt-mcp",
    description: "Video & Audio Transcription",
    status: "active",
    category: "media",
    tools: [
      "transcribe — Transcribe a YouTube video or audio file",
      "search — Search YouTube videos",
      "get_metadata — Get video metadata (title, duration, channel)",
      "list_transcripts — List available transcripts for a video",
      "read_transcript — Read a transcript by ID",
      "get_comments — Get video comments",
    ],
    credentialsSchema: [
      {
        key: "youtube_cookies",
        label: "YouTube Cookies (base64)",
        required: false,
        type: "textarea",
        hint: "Run: yt-dlp --cookies-from-browser firefox --cookies - | base64\n(use chrome instead of firefox on Windows)",
      },
    ],
  },
  {
    id: "pushover",
    name: "pushover",
    description: "Push Notifications",
    status: "active",
    category: "notifications",
    tools: [
      "send_notification — Send a push notification to your devices",
      "send_emergency — Send an emergency notification that repeats until acknowledged",
    ],
    credentialsSchema: [
      { key: "pushover_user_key", label: "Pushover User Key", required: true },
      { key: "pushover_api_token", label: "Pushover API Token", required: true },
    ],
  },
];

const app = new Hono<{ Bindings: Env }>();

// ── Service registry ──

app.get("/api/mcp-services", (c) => {
  return c.json(MCP_SERVICES);
});

// ── Legacy key routes (backward compat) ──

app.get("/api/mcp-keys", async (c) => {
  const userEmail = getUserEmail(c.req.raw);
  if (!userEmail) return c.json({ error: "authenticated user email is required" }, 401);

  const service = c.req.query("service");
  const list = await c.env.MCP_KEYS.list();
  const keys: Array<{
    key: string;
    name: string;
    service: string;
    created_at: string;
    created_by: string;
    has_credentials: boolean;
  }> = [];

  for (const item of list.keys) {
    const meta = await c.env.MCP_KEYS.get<McpKeyMeta>(item.name, "json");
    if (meta) {
      if (meta.created_by !== userEmail) continue;
      if (service && meta.service !== service) continue;
      keys.push({
        key: item.name,
        name: meta.name,
        service: meta.service,
        created_at: meta.created_at,
        created_by: meta.created_by,
        has_credentials: !!meta.credentials && Object.keys(meta.credentials).length > 0,
      });
    }
  }

  return c.json(keys);
});

app.post("/api/mcp-keys", async (c) => {
  const userEmail = getUserEmail(c.req.raw);
  if (!userEmail) return c.json({ error: "authenticated user email is required" }, 401);

  const body = await c.req.json<{ name?: string; service?: string; credentials?: Record<string, string> }>();
  const name = body.name?.trim();
  const service = body.service?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  if (!service) return c.json({ error: "service is required" }, 400);

  const validService = MCP_SERVICES.find((s) => s.id === service);
  if (!validService) return c.json({ error: "unknown service" }, 400);

  // Validate credentials against schema if the service requires them
  if (validService.credentialsSchema) {
    const creds = body.credentials || {};
    for (const field of validService.credentialsSchema) {
      if (field.required && !creds[field.key]?.trim()) {
        return c.json({ error: `${field.label} is required` }, 400);
      }
    }
  }

  const key = `mcp_${randomHex(32)}`;
  const meta: McpKeyMeta = {
    name,
    service,
    created_at: new Date().toISOString(),
    created_by: userEmail,
  };

  // Store credentials if provided and service has a schema
  if (validService.credentialsSchema && body.credentials) {
    const sanitized: Record<string, string> = {};
    for (const field of validService.credentialsSchema) {
      if (body.credentials[field.key]) {
        sanitized[field.key] = body.credentials[field.key];
      }
    }
    if (Object.keys(sanitized).length > 0) {
      meta.credentials = sanitized;
    }
  }

  await c.env.MCP_KEYS.put(key, JSON.stringify(meta));

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "create", service: meta.service }),
    ]),
  );

  return c.json({
    key,
    name: meta.name,
    service: meta.service,
    created_at: meta.created_at,
  });
});

app.delete("/api/mcp-keys/:key", async (c) => {
  const userEmail = getUserEmail(c.req.raw);
  if (!userEmail) return c.json({ error: "authenticated user email is required" }, 401);

  const key = c.req.param("key");
  if (!key.startsWith("mcp_")) return c.json({ error: "invalid key" }, 400);

  const existing = await c.env.MCP_KEYS.get(key);
  if (!existing) return c.json({ error: "key not found" }, 404);

  const meta = JSON.parse(existing) as McpKeyMeta;
  if (meta.created_by !== userEmail) {
    return c.json({ error: "forbidden" }, 403);
  }

  await c.env.MCP_KEYS.delete(key);

  // Also clean up D1 if the key was tracked there
  try {
    await c.env.PORTAL_DB.prepare("DELETE FROM mcp_keys WHERE key_id = ?").bind(key).run();
  } catch {
    // D1 might not have this key (legacy key)
  }

  c.executionCtx.waitUntil(
    pushMetrics(c.env, [
      counter("mcp_key_operations_total", 1, { operation: "delete", service: meta.service }),
    ]),
  );

  return c.json({ ok: true });
});

export { app as mcpKeys };
