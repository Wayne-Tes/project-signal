# Rate-limited queue for ingestion pull jobs (one task per brand x source). The rate
# limit is the whole point: it protects third-party source-API quotas (Apify, YouTube).
resource "google_cloud_tasks_queue" "ingestion" {
  project  = var.project_id
  location = var.region
  name     = "${var.name_prefix}-ingestion"

  rate_limits {
    max_dispatches_per_second = var.max_dispatches_per_second
    max_concurrent_dispatches = var.max_concurrent_dispatches
  }

  retry_config {
    max_attempts  = 5
    min_backoff   = "5s"
    max_backoff   = "300s"
    max_doublings = 4
  }
}

resource "google_cloud_tasks_queue_iam_member" "enqueuer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.ingestion.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${var.enqueuer_sa_email}"
}
