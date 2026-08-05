variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "GCP region for the service."
  type        = string
}

variable "name" {
  description = "Cloud Run service name (e.g. 'staging-api')."
  type        = string
}

variable "service_account_email" {
  description = "Runtime service account for this service."
  type        = string
}

variable "image" {
  description = "Container image. Defaults to the public hello image; CI owns it after first deploy."
  type        = string
  default     = "gcr.io/cloudrun/hello"
}

variable "ingress" {
  description = "Ingress setting."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "allow_unauthenticated" {
  description = "Grant allUsers run.invoker (public services like api/web)."
  type        = bool
  default     = false
}

variable "invoker_members" {
  description = "Members granted run.invoker (e.g. the Pub/Sub or Scheduler SA for private services)."
  type        = list(string)
  default     = []
}

variable "env" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Secret-backed env vars: name -> { secret = <secret id>, version = <version> }."
  type = map(object({
    secret  = string
    version = string
  }))
  default = {}
}

variable "cloudsql_connection_name" {
  description = "Cloud SQL instance connection name to mount; empty to skip."
  type        = string
  default     = ""
}

variable "min_instances" {
  description = "Minimum instances (0 = scale to zero)."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum instances."
  type        = number
  default     = 2
}
