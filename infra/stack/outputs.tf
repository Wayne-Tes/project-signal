output "sql_instance_connection_name" {
  description = "Cloud SQL connection name (project:region:instance) — used by Cloud Run's native Cloud SQL connection."
  value       = module.cloud_sql.instance_connection_name
}

output "db_password_secret_id" {
  description = "Secret Manager secret ID holding the DB password."
  value       = module.cloud_sql.db_password_secret_id
}

output "artifact_registry_url" {
  description = "Base Docker registry URL for app images."
  value       = module.artifact_registry.registry_url
}

output "raw_bucket" {
  description = "Cloud Storage bucket for raw ingested payloads."
  value       = module.storage.raw_bucket
}

output "reports_bucket" {
  description = "Cloud Storage bucket for generated reports."
  value       = module.storage.reports_bucket
}

output "item_topic" {
  description = "Pub/Sub item topic (per-signal scoring)."
  value       = module.pubsub.item_topic_name
}

output "report_topic" {
  description = "Pub/Sub report topic (weekly report trigger)."
  value       = module.pubsub.report_topic_name
}

output "api_url" {
  description = "Public URL of the API service."
  value       = module.run_api.uri
}

output "web_url" {
  description = "Public URL of the web app."
  value       = module.run_web.uri
}

output "ingestion_url" {
  description = "URL of the ingestion service."
  value       = module.run_ingestion.uri
}

output "auth_enabled_social_idps" {
  description = "Social IdPs enabled in Identity Platform (e.g. microsoft.com)."
  value       = module.identity_platform.enabled_social_idps
}
