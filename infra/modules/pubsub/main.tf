# Event backbone:
#   item   topic → push to sentiment-worker (per-signal scoring)
#   report topic → push to report-worker  (weekly report generation)
# Each has a dead-letter topic; failed deliveries land there after N attempts.

locals {
  # Pub/Sub's service agent — needs rights to write DLQs, read source subs, and mint OIDC.
  pubsub_sa = "serviceAccount:service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# --- Topics ------------------------------------------------------------------
resource "google_pubsub_topic" "item" {
  project = var.project_id
  name    = "${var.name_prefix}-item"
}

resource "google_pubsub_topic" "item_dlq" {
  project = var.project_id
  name    = "${var.name_prefix}-item-dlq"
}

resource "google_pubsub_topic" "report" {
  project = var.project_id
  name    = "${var.name_prefix}-report"
}

resource "google_pubsub_topic" "report_dlq" {
  project = var.project_id
  name    = "${var.name_prefix}-report-dlq"
}

# --- Subscriptions (push to workers, with OIDC auth) -------------------------
resource "google_pubsub_subscription" "item" {
  project              = var.project_id
  name                 = "${var.name_prefix}-item-sub"
  topic                = google_pubsub_topic.item.id
  ack_deadline_seconds = 60

  push_config {
    push_endpoint = "${var.sentiment_push_url}/events"
    oidc_token {
      service_account_email = var.push_invoker_sa_email
      audience              = var.sentiment_push_url
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.item_dlq.id
    max_delivery_attempts = var.max_delivery_attempts
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

resource "google_pubsub_subscription" "report" {
  project              = var.project_id
  name                 = "${var.name_prefix}-report-sub"
  topic                = google_pubsub_topic.report.id
  ack_deadline_seconds = 60

  push_config {
    push_endpoint = "${var.report_push_url}/events"
    oidc_token {
      service_account_email = var.push_invoker_sa_email
      audience              = var.report_push_url
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.report_dlq.id
    max_delivery_attempts = var.max_delivery_attempts
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

# Pull subscriptions on the DLQs for inspection / manual replay.
resource "google_pubsub_subscription" "item_dlq" {
  project              = var.project_id
  name                 = "${var.name_prefix}-item-dlq-sub"
  topic                = google_pubsub_topic.item_dlq.id
  ack_deadline_seconds = 60
}

resource "google_pubsub_subscription" "report_dlq" {
  project              = var.project_id
  name                 = "${var.name_prefix}-report-dlq-sub"
  topic                = google_pubsub_topic.report_dlq.id
  ack_deadline_seconds = 60
}

# --- Publisher IAM -----------------------------------------------------------
resource "google_pubsub_topic_iam_member" "item_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.item.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${var.ingestion_sa_email}"
}

resource "google_pubsub_topic_iam_member" "report_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.report.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${var.scheduler_sa_email}"
}

# --- Dead-letter wiring: the Pub/Sub service agent must publish to the DLQ topics
#     and read the source subscriptions. ---------------------------------------
resource "google_pubsub_topic_iam_member" "item_dlq_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.item_dlq.name
  role    = "roles/pubsub.publisher"
  member  = local.pubsub_sa
}

resource "google_pubsub_topic_iam_member" "report_dlq_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.report_dlq.name
  role    = "roles/pubsub.publisher"
  member  = local.pubsub_sa
}

resource "google_pubsub_subscription_iam_member" "item_sub_subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.item.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_sa
}

resource "google_pubsub_subscription_iam_member" "report_sub_subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.report.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_sa
}

# --- OIDC: Pub/Sub service agent mints tokens as the push-invoker SA ----------
resource "google_service_account_iam_member" "pubsub_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.push_invoker_sa_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.pubsub_sa
}
