variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Location for the Cloud Tasks queue."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names (typically the environment)."
  type        = string
}

variable "enqueuer_sa_email" {
  description = "SA allowed to enqueue tasks (the ingestion dispatcher)."
  type        = string
}

variable "max_dispatches_per_second" {
  description = "Throttle for outbound pull tasks — protects third-party source-API quotas."
  type        = number
  default     = 5
}

variable "max_concurrent_dispatches" {
  description = "Max in-flight pull tasks."
  type        = number
  default     = 10
}
