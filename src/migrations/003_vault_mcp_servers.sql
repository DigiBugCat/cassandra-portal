-- Per-vault MCP server configuration
-- Applied via: wrangler d1 execute cassandra-portal --file=src/migrations/003_vault_mcp_servers.sql

ALTER TABLE runner_vaults ADD COLUMN mcp_servers_encrypted TEXT;
