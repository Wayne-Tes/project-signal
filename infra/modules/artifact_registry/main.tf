# Docker image registry for all app containers. Images are pushed by deploy-staging.yml.
resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "Project Signal container images"
}
