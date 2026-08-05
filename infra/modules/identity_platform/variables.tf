variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "authorized_domains" {
  description = "Domains allowed to complete sign-in redirects (Cloud Run URL, custom domains, localhost for dev)."
  type        = list(string)
  default     = ["localhost"]
}

variable "enable_email_signin" {
  description = "Enable email/password sign-in as a fallback alongside social providers."
  type        = bool
  default     = true
}

# Built-in ("default supported") OAuth IdPs, keyed by their GCIP idp_id
# (e.g. "microsoft.com", "google.com"). Client ID/secret come from each provider's
# app registration. Supply at apply time via TF_VAR_auth_social_idps or a CI secret —
# NEVER commit these values to a .tfvars file.
variable "social_idps" {
  description = "Map of default-supported social IdPs to enable, keyed by idp_id."
  type = map(object({
    client_id     = string
    client_secret = string
  }))
  default   = {}
  sensitive = true
}
