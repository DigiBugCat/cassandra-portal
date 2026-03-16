declare namespace Cloudflare {
  interface Env {
    RUNNER_URL: string;
    RUNNER_ADMIN_KEY: string;
    DOMAIN: string;
    MCP_KEYS: KVNamespace;
    PORTAL_DB: D1Database;
    CREDENTIALS_KEY: string;
    VM_PUSH_URL: string;
    VM_PUSH_CLIENT_ID: string;
    VM_PUSH_CLIENT_SECRET: string;
    ACL_URL?: string;
    ACL_SECRET?: string;
    ACL_SERVICE?: Fetcher;
  }
}

interface Env extends Cloudflare.Env {}
