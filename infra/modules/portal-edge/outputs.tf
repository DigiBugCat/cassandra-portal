output "mcp_keys_kv_namespace_id" {
  description = "KV namespace ID for MCP_KEYS — bind in portal + MCP worker wrangler.jsonc files"
  value       = cloudflare_workers_kv_namespace.mcp_keys.id
}

output "portal_hostname" {
  description = "Portal hostname"
  value       = "${var.subdomain}.${var.domain}"
}

output "portal_url" {
  description = "Portal URL"
  value       = "https://${var.subdomain}.${var.domain}"
}
