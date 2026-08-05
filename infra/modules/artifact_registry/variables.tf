variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "GCP region for the Artifact Registry repository."
  type        = string
}

variable "repository_id" {
  description = "Artifact Registry Docker repository name."
  type        = string
  default     = "project-signal"
}
