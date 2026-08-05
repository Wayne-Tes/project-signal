# One least-privilege service account per runtime service, plus a Scheduler SA and a
# Pub/Sub push-invoker SA. Each runtime SA gets only the project-level roles it needs;
# resource-scoped grants (buckets, topics, queue) live in the modules that own them.

locals {
  runtime_services = ["api", "web", "ingestion", "sentiment-worker", "report-worker"]

  sql_clients    = ["api", "ingestion", "sentiment-worker", "report-worker"]
  ai_users       = ["sentiment-worker", "report-worker"]
  secret_readers = ["api", "ingestion", "sentiment-worker", "report-worker"]
}

resource "google_service_account" "runtime" {
  for_each     = toset(local.runtime_services)
  project      = var.project_id
  account_id   = "${var.name_prefix}-${each.key}"
  display_name = "Project Signal ${each.key} (${var.name_prefix})"
}

resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-scheduler"
  display_name = "Project Signal Cloud Scheduler (${var.name_prefix})"
}

resource "google_service_account" "pubsub_invoker" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-pubsub-invoker"
  display_name = "Project Signal Pub/Sub push invoker (${var.name_prefix})"
}

# --- Project-level roles -----------------------------------------------------
resource "google_project_iam_member" "sql_client" {
  for_each = toset(local.sql_clients)
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "ai_user" {
  for_each = toset(local.ai_users)
  project  = var.project_id
  role     = "roles/aiplatform.user"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "log_writer" {
  for_each = toset(local.runtime_services)
  project  = var.project_id
  role     = "roles/logging.logWriter"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "metric_writer" {
  for_each = toset(local.runtime_services)
  project  = var.project_id
  role     = "roles/monitoring.metricWriter"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

# --- Scoped DATABASE_URL secret access ---------------------------------------
resource "google_secret_manager_secret_iam_member" "db_password_reader" {
  for_each  = toset(local.secret_readers)
  secret_id = var.db_password_secret_resource_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.key].email}"
}
