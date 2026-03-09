# CLAUDE.md — Cassandra Portal

## What This Is

CF Worker that serves the Cassandra dashboard UI. Manages runner tenant API keys (proxied to orchestrator) and MCP API keys (direct KV CRUD). Protected by CF Access (Google OAuth).

## Repo Structure

```
cassandra-portal/
├── src/
│   ├── index.ts          # Hono router, HTML UI, entrypoint
│   ├── mcp-keys.ts       # MCP key CRUD against MCP_KEYS KV
│   └── runner-proxy.ts   # Runner tenant proxy to orchestrator admin API
├── infra/
│   └── modules/
│       └── portal-edge/  # Terraform: MCP_KEYS KV, DNS, CF Access
├── wrangler.jsonc
├── package.json
└── tsconfig.json
```

## Deploy

```bash
# Worker (manual deploy)
npm install
npx wrangler deploy

# Infra (from cassandra-infra)
cd cassandra-infra/environments/production/portal
source ../../.env
tofu init -backend-config=production.s3.tfbackend
tofu apply
```

## Secrets (via wrangler secret put)

- `RUNNER_URL` — Runner orchestrator URL
- `RUNNER_ADMIN_KEY` — Admin API key for runner /tenants routes
- `DOMAIN` — Root domain for link generation

## Bindings

- `MCP_KEYS` — Shared KV namespace for MCP API keys (from Terraform output)
