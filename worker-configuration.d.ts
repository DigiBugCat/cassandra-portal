declare namespace Cloudflare {
  interface Env {
    RUNNER_URL: string;
    RUNNER_ADMIN_KEY: string;
    DOMAIN: string;
    MCP_KEYS: KVNamespace;
  }
}

interface Env extends Cloudflare.Env {}
