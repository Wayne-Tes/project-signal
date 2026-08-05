output "instance_connection_name" {
  description = "Cloud SQL connection name (project:region:instance) for the Cloud SQL connector."
  value       = google_sql_database_instance.main.connection_name
}

output "database_name" {
  description = "Application database name."
  value       = google_sql_database.app.name
}

output "app_user" {
  description = "Application database user name."
  value       = google_sql_user.app.name
}

output "db_password_secret_id" {
  description = "Secret Manager secret ID (short name) holding the DB password — for Cloud Run secret_key_ref."
  value       = google_secret_manager_secret.db_password.secret_id
}

output "db_password_secret_resource_id" {
  description = "Full Secret Manager secret resource ID for the DB password — for IAM bindings."
  value       = google_secret_manager_secret.db_password.id
}
