variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names (typically the environment, e.g. 'staging')."
  type        = string
}

variable "db_password_secret_resource_id" {
  description = "Full Secret Manager resource ID of the DB password secret, for scoped accessor IAM."
  type        = string
}
