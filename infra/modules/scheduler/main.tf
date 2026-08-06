# Cron triggers:
#   ingestion → HTTP POST to the ingestion dispatcher (fans out pull tasks via Cloud Tasks)
#   report    → publish to the report topic (report-worker consumes via push)
#   sweep     → HTTP POST to re-publish any signals stuck in 'pending' (safety net)
#   rollup    → HTTP POST to compute daily dimension scores (Brand Perception Index)

resource "google_cloud_scheduler_job" "ingestion" {
  project   = var.project_id
  region    = var.region
  name      = "${var.name_prefix}-ingestion"
  schedule  = var.ingestion_schedule
  time_zone = var.time_zone

  http_target {
    # /ingest/dispatch enumerates all enabled source_configs and runs each ingestion job.
    uri         = "${var.ingestion_url}/ingest/dispatch"
    http_method = "POST"
    oidc_token {
      service_account_email = var.scheduler_sa_email
      audience              = var.ingestion_url
    }
  }
}

resource "google_cloud_scheduler_job" "report" {
  project   = var.project_id
  region    = var.region
  name      = "${var.name_prefix}-report"
  schedule  = var.report_schedule
  time_zone = var.time_zone

  pubsub_target {
    topic_name = var.report_topic_id
    data       = base64encode("{\"trigger\":\"weekly\"}")
  }
}

resource "google_cloud_scheduler_job" "sweep" {
  project   = var.project_id
  region    = var.region
  name      = "${var.name_prefix}-pending-sweep"
  schedule  = var.sweep_schedule
  time_zone = var.time_zone

  http_target {
    uri         = "${var.ingestion_url}/reconcile"
    http_method = "POST"
    oidc_token {
      service_account_email = var.scheduler_sa_email
      audience              = var.ingestion_url
    }
  }
}

# Daily Brand Perception Index rollup. Writes one dimension_scores row per brand × dimension
# for the day; without it that table is never populated and every dimension read is empty.
# Runs after the weekly ingestion window opens so a fresh pull is scored the same day.
resource "google_cloud_scheduler_job" "rollup" {
  project   = var.project_id
  region    = var.region
  name      = "${var.name_prefix}-dimension-rollup"
  schedule  = var.rollup_schedule
  time_zone = var.time_zone

  http_target {
    uri         = "${var.ingestion_url}/rollup"
    http_method = "POST"
    oidc_token {
      service_account_email = var.scheduler_sa_email
      audience              = var.ingestion_url
    }
  }
}
