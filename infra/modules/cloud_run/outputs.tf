output "uri" {
  description = "HTTPS URL of the Cloud Run service."
  value       = google_cloud_run_v2_service.this.uri
}

output "name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.this.name
}
