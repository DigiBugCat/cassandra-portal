# CLAUDE.md — Cassandra Portal

## What This Is

FastAPI service that serves the Cassandra dashboard UI (Workbench). Runs in k8s behind CF Tunnel. Manages:
- **Projects** — organizational boundaries for grouping service configs (personal + shared, with membership)
- **MCP keys** — project-scoped API keys for MCP services, stored in local SQLite (metadata) and synced to auth service (runtime auth)
- **Service credentials** — per-project credentials (e.g. Pushover), encrypted in SQLite, synced to auth service
- **Runner config** — Obsidian auth tokens, per-vault E2EE passwords, MCP server configs
- **Runner keys** — tenant API keys proxied to the orchestrator

User identity from CF Access headers (`Cf-Access-Authenticated-User-Email` or `CF_Authorization` JWT) passed through the CF Tunnel.

## Repo Structure

```
cassandra-portal/
├── service/                       # FastAPI backend
│   ├── src/cassandra_portal/
│   │   ├── app.py                 # FastAPI app, lifespan, PortalState
│   │   ├── auth.py                # get_user_email from CF Access headers
│   │   ├── crypto.py              # Fernet encrypt/decrypt for credentials
│   │   ├── db.py                  # Async SQLite (WAL mode)
│   │   ├── queries.py             # Shared DB query helpers
│   │   ├── services.py            # MCP_SERVICES registry + credential schemas
│   │   ├── main.py                # CLI entrypoint (uvicorn)
│   │   └── routes/
│   │       ├── admin.py           # ACL admin proxy → auth service
│   │       ├── keys.py            # MCP keys + credentials + ACL tool check
│   │       ├── projects.py        # Project + member CRUD
│   │       ├── proxy.py           # Discord MCP proxy
│   │       └── runner.py          # Runner config + vaults + tenant proxy
│   ├── tests/
│   │   └── test_app.py
│   ├── schema.sql                 # SQLite schema
│   └── pyproject.toml
├── frontend/                      # Vite + Tailwind v4 + vanilla TS SPA
│   ├── src/
│   │   ├── main.ts                # SPA router
│   │   ├── api.ts                 # Fetch wrappers for all API routes
│   │   ├── style.css              # @import "tailwindcss" + @theme
│   │   ├── pages/                 # dashboard, workbench, runner-keys
│   │   └── components/            # modal, ui primitives
│   └── package.json
├── infra/modules/portal-edge/     # Terraform (needs update for k8s)
└── CLAUDE.md
```

## Env Vars

- `DB_PATH` — SQLite database path (default: `/data/portal.db`)
- `AUTH_URL` — Auth service URL (default: `http://auth:8080`)
- `AUTH_SECRET` — Shared secret for auth service calls
- `CREDENTIALS_KEY` — Fernet key for encrypting credentials at rest
- `RUNNER_URL` — Runner orchestrator URL
- `RUNNER_ADMIN_KEY` — Admin API key for runner /tenants routes
- `DOMAIN` — Root domain for link generation
- `DISCORD_MCP_URL` — Discord MCP controller URL
- `HOST` / `PORT` — bind address (default: `0.0.0.0:8080`)

## Run

```bash
cd service
uv run cassandra-portal          # or: uv run uvicorn cassandra_portal.app:create_app --factory
uv run pytest -v                 # tests
```

## Frontend

```bash
cd frontend
npm install
npm run dev                      # Vite dev server (proxies /api to backend)
npm run build                    # Build to dist/ for static serving
```

## Tailwind CSS v4 Rules

This project uses Tailwind CSS v4 with Vite. Follow these rules strictly:

- Use `@import "tailwindcss"` — NOT `@tailwind base/components/utilities`
- Theme config via `@theme` directive in CSS — NO `tailwind.config.js`
- Vite plugin: `@tailwindcss/vite` — NO `autoprefixer` or `postcss-import`
- Use slash notation for opacity: `bg-black/50` — NOT `bg-opacity-*`
- Default border color is `currentColor` (was `gray-200`)
