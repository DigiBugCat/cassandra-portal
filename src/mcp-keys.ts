import { Hono } from "hono";
import type { Env } from "./env";

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

// Registry of available MCP services
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
        hint: "Run: yt-dlp --cookies-from-browser firefox --cookies /tmp/yt-cookies.txt 2>/dev/null && grep -iE '(youtube|google|googlevideo)\\.com' /tmp/yt-cookies.txt | base64",
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
        hint: "Your Discord user token (the bridge logs in as you).",
      },
    ],
  },
  {
    id: "runner",
    name: "Agent Runner",
    description: "Claude Code Sessions",
    status: "active",
    category: "tools",
    tools: ["Create and manage Claude Code sessions"],
  },
  {
    id: "market-research",
    name: "Market Research",
    description: "Financial Market Data & Research",
    status: "active",
    category: "data",
    tools: [
      "quote — Stock price with pre-market/after-hours",
      "company_overview — Company profile, price, and ratios",
      "stock_search — Search/screen stocks by criteria",
      "stock_brief — Quick stock research summary (workflow)",
      "market_context — Broad market overview (workflow)",
      "fair_value_estimate — DCF-based fair value (workflow)",
      "financial_statements — Income, balance sheet, cash flow",
    ],
  },
];

const app = new Hono<{ Bindings: Env }>();

app.get("/api/mcp-services", (c) => {
  return c.json(MCP_SERVICES);
});

export { app as mcpKeys };
