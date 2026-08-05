variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "GCP region for the Cloud SQL instance."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names (typically the environment, e.g. 'staging')."
  type        = string
}

variable "tier" {
  description = "Cloud SQL machine tier. db-f1-micro (~$10/mo) is fine for staging."
  type        = string
  default     = "db-f1-micro"
}

variable "database_version" {
  description = "Postgres version."
  type        = string
  default     = "POSTGRES_16"
}

variable "disk_size_gb" {
  description = "Initial disk size in GB."
  type        = number
  default     = 10
}

variable "database_name" {
  description = "Application database name."
  type        = string
  default     = "project_signal"
}

variable "app_user" {
  description = "Application database user name."
  type        = string
  default     = "project_signal_app"
}

variable "deletion_protection" {
  description = "Block accidental instance deletion. Keep true outside throwaway envs."
  type        = bool
  default     = true
}
