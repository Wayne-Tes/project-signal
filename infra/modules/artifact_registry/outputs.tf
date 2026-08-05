output "repository_id" {
  description = "Artifact Registry repository name."
  value       = google_artifact_registry_repository.docker.repository_id
}

output "registry_url" {
  description = "Base Docker registry URL for app images (…/<app>:<tag>)."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}
