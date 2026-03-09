variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID"
  type        = string
}

variable "domain" {
  description = "Root domain name"
  type        = string
}

variable "subdomain" {
  description = "Portal subdomain"
  type        = string
  default     = "portal"
}

variable "worker_script_name" {
  description = "Worker script name deployed by Wrangler"
  type        = string
  default     = "cassandra-portal"
}

variable "allowed_emails" {
  description = "Email addresses allowed to access the portal via Google OAuth"
  type        = list(string)
}

variable "allowed_email_domains" {
  description = "Email domains allowed to access the portal"
  type        = list(string)
  default     = []
}

variable "google_idp_id" {
  description = "CF Access Google identity provider ID"
  type        = string
}
