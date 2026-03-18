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
  serviceCredentialsSchema?: CredentialField[];
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
        hint: "Run: yt-dlp --cookies-from-browser firefox --cookies /tmp/yt-cookies.txt 2>/dev/null && grep -E '\\.(youtube|google|googlevideo)\\.com' /tmp/yt-cookies.txt | base64\n(use chrome instead of firefox on Windows)",
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
  {
    id: "discord-mcp",
    name: "discord-mcp",
    description: "Discord (via Beeper Bridge)",
    status: "active",
    category: "data",
    tools: [
      "discord_search — Search messages across all enabled servers and DMs",
      "discord_read — Read channel, thread, or DM messages with pagination",
    ],
    credentialsSchema: [
      {
        key: "discord_token",
        label: "Discord Token",
        required: true,
        type: "textarea",
        hint: "Your Discord user token (the bridge logs in as you to see DMs + guilds).\nTo extract from browser:\n1. Open https://discord.com/app in Chrome/Firefox\n2. Open DevTools (F12) → Network tab\n3. Filter by \"api\" and click any request to discord.com\n4. Find the \"Authorization\" header → copy the token value\n\nOr via the Discord desktop app console:\n1. Ctrl+Shift+I → Console tab\n2. Run: (webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()",
      },
    ],
  },
  {
    id: "fmp",
    name: "fmp",
    description: "Financial Market Data",
    status: "active",
    category: "data",
    tools: [
      "quote — Stock price with pre-market/after-hours",
      "company_overview — Company profile, price, and ratios",
      "stock_search — Search/screen stocks by criteria",
      "stock_brief — Quick stock research summary (workflow)",
      "market_context — Broad market overview (workflow)",
      "fair_value_estimate — DCF-based fair value (workflow)",
      "earnings_setup — Pre-earnings analysis (workflow)",
      "earnings_preview — Upcoming earnings preview (workflow)",
      "earnings_postmortem — Post-earnings analysis (workflow)",
      "ownership_deep_dive — Institutional + insider ownership (workflow)",
      "industry_analysis — Industry comparison (workflow)",
      "financial_statements — Income, balance sheet, cash flow",
      "financial_health — Altman Z-score, Piotroski F-score",
      "valuation_history — Historical valuation multiples",
      "analyst_consensus — Price targets and ratings",
      "discounted_cash_flow — DCF valuation",
      "peer_comparison — Compare vs peers on key metrics",
      "estimate_revisions — Analyst estimate changes",
      "price_history — Historical EOD prices",
      "intraday_prices — Intraday price data",
      "technical_indicators — SMA, EMA, RSI, MACD, etc.",
      "institutional_ownership — 13F filings",
      "insider_activity — Insider buys/sells",
      "short_interest — Short interest data",
      "ownership_structure — Shares float breakdown",
      "market_news — General and stock-specific news",
      "earnings_transcript — Earnings call transcripts",
      "earnings_calendar — Upcoming earnings dates",
      "sec_filings — SEC filing history",
      "sec_filings_search — Search EDGAR filings + NPORT-P fund holdings",
      "filing_sections — LLM-filtered SEC filing content",
      "treasury_rates — Current Treasury yield curve",
      "treasury_auctions — Recent auction results",
      "auction_analysis — Auction demand analysis",
      "options_chain — Options chain data (requires Polygon)",
      "economy_indicators — Economic data (requires Polygon)",
      "sector_performance — S&P sector performance",
      "industry_performance — Industry-level performance",
      "index_constituents — S&P 500, Nasdaq, Dow components",
      "market_overview — Indices, sectors, and movers",
    ],
    serviceCredentialsSchema: [
      { key: "FMP_API_KEY", label: "FMP API Key", required: true },
      { key: "POLYGON_API_KEY", label: "Polygon API Key", required: false },
      { key: "FRED_API_KEY", label: "FRED API Key", required: false },
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
