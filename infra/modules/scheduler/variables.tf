variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the scheduler jobs."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names (typically the environment)."
  type        = string
}

variable "scheduler_sa_email" {
  description = "SA used for OIDC HTTP targets and Pub/Sub publishing."
  type        = string
}

variable "ingestion_url" {
  description = "Base URL of the ingestion service (HTTP targets)."
  type        = string
}

variable "report_topic_id" {
  description = "Full Pub/Sub topic ID to publish report-trigger messages to."
  type        = string
}

variable "ingestion_schedule" {
  description = "Cron for the ingestion run."
  type        = string
  default     = "0 6 * * 1" # Mondays 06:00
}

variable "report_schedule" {
  description = "Cron for weekly report generation."
  type        = string
  default     = "0 7 * * 1" # Mondays 07:00
}

variable "sweep_schedule" {
  description = "Cron for the pending-signal reconciliation sweep."
  type        = string
  default     = "0 * * * *" # hourly
}

variable "time_zone" {
  description = "Time zone for the cron schedules."
  type        = string
  default     = "Etc/UTC"
}
