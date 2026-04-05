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
  /** Override the subdomain used for the MCP endpoint URL (defaults to id). */
  subdomain?: string;
}

// Registry of available MCP services
export const MCP_SERVICES: McpService[] = [
  {
    id: "yt-mcp",
    name: "YouTube",
    description: "Video & Audio Transcription",
    status: "active",
    category: "media",
    subdomain: "youtube",
    tools: [
      "transcribe — Transcribe a YouTube video or audio file",
      "job_status — Check transcription job status",
      "search — Search transcripts by content",
      "list_transcripts — List available transcripts",
      "read_transcript — Read a transcript by ID",
      "yt_search — Search YouTube for videos",
      "list_channel_videos — List videos from a YouTube channel",
      "get_comments — Get video comments",
      "watch_later_sync — Sync Watch Later playlist",
      "watch_later_status — Check Watch Later sync status",
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
    id: "twitter-mcp",
    name: "Twitter MCP",
    description: "Twitter/X Research & Personal Account",
    status: "active",
    category: "data",
    tools: [
      "search_news — Curated news articles with headlines and summaries",
      "search — Grok AI-powered opinion synthesis and sentiment analysis",
      "get_post_counts — Volume analytics for a topic or ticker",
      "get_user_tweets — Get recent tweets from a specific account",
      "get_tweet — Get a single tweet by ID",
      "get_thread — Get a full tweet thread",
      "get_replies — Get replies to a tweet",
      "my_feed — Your personal Twitter timeline",
      "my_bookmarks — Your saved/bookmarked tweets",
      "my_profile — Your Twitter profile info",
      "get_article — Read a Twitter Article (long-form)",
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
  {
    id: "reddit-mcp",
    name: "Reddit",
    description: "Reddit Browsing & Research",
    status: "active",
    category: "data",
    subdomain: "reddit",
    tools: [
      "search — Search Reddit posts across all subreddits or within one",
      "get_subreddit — Browse a subreddit's posts (hot/new/top/rising)",
      "get_post — Read a post with its full comment thread",
      "get_comment_thread — Drill into a specific comment chain",
    ],
  },
  {
    id: "claudeai-mcp",
    name: "claude.ai",
    description: "Claude.ai Conversations & Projects",
    status: "active",
    category: "tools",
    subdomain: "claude-ai",
    tools: [
      "list_conversations — List recent claude.ai conversations",
      "get_conversation — Get a conversation with all messages",
      "search_conversations — Search conversations by name or summary",
      "send_message — Send a message to an existing conversation",
      "create_conversation — Create a new conversation",
      "list_projects — List all projects",
      "get_project — Get project details and system prompt",
      "list_project_docs — List knowledge docs in a project",
      "get_project_doc — Get full doc content",
      "create_project_doc — Create a new knowledge doc",
    ],
  },
];

// In-cluster health check URLs for each service
const SERVICE_HEALTH_URLS: Record<string, string> = {
  "yt-mcp": "http://media-mcp.production.svc.cluster.local:3003/healthz",
  "discord-mcp": "http://discord-mcp.production.svc.cluster.local:3003/healthz",
  "twitter-mcp": "http://twitter-mcp.production.svc.cluster.local:3003/healthz",
  "runner": "http://claude-orchestrator.production.svc.cluster.local:8080/health",
  "market-research": "http://market-research.production.svc.cluster.local:3003/healthz",
  "reddit-mcp": "http://reddit-mcp.production.svc.cluster.local:3004/healthz",
  "claudeai-mcp": "http://claudeai-mcp.production.svc.cluster.local:3003/healthz",
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/mcp-services", (c) => {
  return c.json(MCP_SERVICES);
});

app.get("/api/mcp-services/health", async (c) => {
  const results: Record<string, boolean> = {};
  await Promise.all(
    MCP_SERVICES.map(async (svc) => {
      const url = SERVICE_HEALTH_URLS[svc.id];
      if (!url) {
        results[svc.id] = false;
        return;
      }
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        results[svc.id] = resp.ok;
      } catch {
        results[svc.id] = false;
      }
    }),
  );
  return c.json(results);
});

export { app as mcpKeys };
