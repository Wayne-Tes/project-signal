variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "GCP region for all regional resources (London = europe-west2)."
  type        = string
  default     = "europe-west2"
}

variable "environment" {
  description = "Environment name used as a prefix for all resource names (e.g. staging, production)."
  type        = string
}

variable "project_number" {
  description = "GCP project number (used to reference the Pub/Sub service agent)."
  type        = string
}

variable "image_tag" {
  description = "Container image tag to deploy for every Cloud Run service (e.g. staging-<sha>). Required — the deploy workflow passes it; do not run `terraform apply` locally without it."
  type        = string
}

variable "sql_tier" {
  description = "Cloud SQL machine tier. db-f1-micro (~$10/mo) for staging; db-g1-small or higher for production."
  type        = string
  default     = "db-f1-micro"
}

variable "sql_deletion_protection" {
  description = "Block accidental Cloud SQL instance deletion. Always true in production."
  type        = bool
  default     = true
}

variable "artifact_repository_id" {
  description = "Artifact Registry Docker repository name."
  type        = string
  default     = "project-signal"
}

variable "storage_force_destroy" {
  description = "Allow Terraform to delete non-empty storage buckets (true only for throwaway envs)."
  type        = bool
  default     = false
}

variable "auth_authorized_domains" {
  description = "Domains allowed to complete Identity Platform sign-in redirects (Cloud Run URL, custom domains, localhost for dev)."
  type        = list(string)
  default     = ["localhost"]
}

variable "auth_enable_email_signin" {
  description = "Enable email/password sign-in alongside social providers."
  type        = bool
  default     = true
}

# Social IdP client IDs/secrets — supplied at apply time via TF_VAR_auth_social_idps
# (CI sources it from a secret store). NEVER set this in a committed .tfvars file.
variable "auth_social_idps" {
  description = "Map of Identity Platform default-supported social IdPs, keyed by idp_id (e.g. microsoft.com)."
  type = map(object({
    client_id     = string
    client_secret = string
  }))
  default   = {}
  sensitive = true
}
