variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "project_number" {
  description = "GCP project number (for the Pub/Sub service agent identity)."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names (typically the environment)."
  type        = string
}

variable "sentiment_push_url" {
  description = "Base URL of the sentiment-worker Cloud Run service (push target for the item topic)."
  type        = string
}

variable "report_push_url" {
  description = "Base URL of the report-worker Cloud Run service (push target for the report topic)."
  type        = string
}

variable "ingestion_sa_email" {
  description = "Ingestion SA — publishes per-item messages to the item topic."
  type        = string
}

variable "scheduler_sa_email" {
  description = "Scheduler SA — publishes report-trigger messages to the report topic."
  type        = string
}

variable "push_invoker_sa_email" {
  description = "SA used as the OIDC identity for push subscriptions (has run.invoker on the workers)."
  type        = string
}

variable "max_delivery_attempts" {
  description = "Deliveries before a message is dead-lettered."
  type        = number
  default     = 5
}
