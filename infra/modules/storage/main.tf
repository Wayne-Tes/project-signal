# Object storage: `raw` holds verbatim ingested payloads (audit trail); `reports` holds
# generated PDF/report artifacts. Bucket names are globally unique via project + env prefix.

resource "google_storage_bucket" "raw" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name_prefix}-raw"
  location                    = var.region
  force_destroy               = var.force_destroy
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Raw data is the audit trail; move it to cheaper storage as it ages.
  lifecycle_rule {
    condition { age = 30 }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
}

resource "google_storage_bucket" "reports" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name_prefix}-reports"
  location                    = var.region
  force_destroy               = var.force_destroy
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}

# --- Scoped IAM --------------------------------------------------------------
resource "google_storage_bucket_iam_member" "raw_writer" {
  bucket = google_storage_bucket.raw.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.ingestion_sa_email}"
}

resource "google_storage_bucket_iam_member" "raw_reader" {
  bucket = google_storage_bucket.raw.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${var.sentiment_sa_email}"
}

resource "google_storage_bucket_iam_member" "reports_writer" {
  bucket = google_storage_bucket.reports.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.report_sa_email}"
}

resource "google_storage_bucket_iam_member" "reports_reader" {
  bucket = google_storage_bucket.reports.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${var.api_sa_email}"
}
