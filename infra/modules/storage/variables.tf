variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Location for the buckets."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names (typically the environment)."
  type        = string
}

variable "force_destroy" {
  description = "Allow Terraform to delete non-empty buckets (true only for throwaway envs)."
  type        = bool
  default     = false
}

variable "ingestion_sa_email" {
  description = "Ingestion SA — writes raw payloads."
  type        = string
}

variable "sentiment_sa_email" {
  description = "Sentiment worker SA — reads raw payloads."
  type        = string
}

variable "report_sa_email" {
  description = "Report worker SA — writes reports."
  type        = string
}

variable "api_sa_email" {
  description = "API SA — reads reports to serve them."
  type        = string
}
