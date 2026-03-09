terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

# MCP API keys — shared KV namespace bound by portal + all MCP workers
resource "cloudflare_workers_kv_namespace" "mcp_keys" {
  account_id = var.account_id
  title      = "cassandra-mcp-keys"
}

# DNS record for the portal worker (deployed by wrangler, not Terraform)
resource "cloudflare_record" "portal" {
  zone_id = var.zone_id
  name    = var.subdomain
  content = "${var.worker_script_name}.${var.account_id}.workers.dev"
  type    = "CNAME"
  proxied = true
  comment = "Cassandra Portal worker hostname"
}

# CF Access application — protects the portal with Google OAuth
resource "cloudflare_zero_trust_access_application" "portal" {
  zone_id                   = var.zone_id
  name                      = "${var.worker_script_name}-portal"
  domain                    = "${var.subdomain}.${var.domain}"
  type                      = "self_hosted"
  session_duration          = "24h"
  auto_redirect_to_identity = true
  allowed_idps              = [var.google_idp_id]
}

# Access policy — allow specific Google emails
resource "cloudflare_zero_trust_access_policy" "google_email" {
  application_id = cloudflare_zero_trust_access_application.portal.id
  zone_id        = var.zone_id
  name           = "Allowed Google users"
  precedence     = 1
  decision       = "allow"

  include {
    email        = var.allowed_emails
    email_domain = var.allowed_email_domains
  }
}
