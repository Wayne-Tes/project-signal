# --- Data + auth -------------------------------------------------------------
module "cloud_sql" {
  source = "../modules/cloud_sql"

  project_id          = var.project_id
  region              = var.region
  name_prefix         = var.environment
  tier                = var.sql_tier
  deletion_protection = var.sql_deletion_protection
}

module "identity_platform" {
  source = "../modules/identity_platform"

  project_id          = var.project_id
  authorized_domains  = var.auth_authorized_domains
  enable_email_signin = var.auth_enable_email_signin
  social_idps         = var.auth_social_idps
}

# --- Service accounts (least-privilege, per service) -------------------------
module "service_accounts" {
  source = "../modules/service_accounts"

  project_id                     = var.project_id
  name_prefix                    = var.environment
  db_password_secret_resource_id = module.cloud_sql.db_password_secret_resource_id
}

# --- Registry, storage, queue -----------------------------------------------
module "artifact_registry" {
  source = "../modules/artifact_registry"

  project_id    = var.project_id
  region        = var.region
  repository_id = var.artifact_repository_id
}

module "storage" {
  source = "../modules/storage"

  project_id         = var.project_id
  region             = var.region
  name_prefix        = var.environment
  force_destroy      = var.storage_force_destroy
  ingestion_sa_email = module.service_accounts.emails["ingestion"]
  sentiment_sa_email = module.service_accounts.emails["sentiment-worker"]
  report_sa_email    = module.service_accounts.emails["report-worker"]
  api_sa_email       = module.service_accounts.emails["api"]
}

module "cloud_tasks" {
  source = "../modules/cloud_tasks"

  project_id        = var.project_id
  region            = var.region
  name_prefix       = var.environment
  enqueuer_sa_email = module.service_accounts.emails["ingestion"]
}

# --- Cloud Run services ------------------------------------------------------
locals {
  # Terraform owns the image (deployed atomically with env). The deploy workflow passes
  # image_tag = staging-<sha>; images are built+pushed before the apply.
  images = {
    api                = "${module.artifact_registry.registry_url}/api:${var.image_tag}"
    web                = "${module.artifact_registry.registry_url}/web:${var.image_tag}"
    ingestion          = "${module.artifact_registry.registry_url}/ingestion:${var.image_tag}"
    "sentiment-worker" = "${module.artifact_registry.registry_url}/sentiment-worker:${var.image_tag}"
    "report-worker"    = "${module.artifact_registry.registry_url}/report-worker:${var.image_tag}"
  }
  common_env = {
    GOOGLE_CLOUD_PROJECT = var.project_id
    NODE_ENV             = "production"
    VERTEX_AI_LOCATION   = var.region
  }
  # Cloud SQL Auth Proxy socket connection (Cloud Run) — discrete parts, not a URL.
  # postgres-js `path` must point at the socket FILE, not the directory.
  db_env = {
    DB_SOCKET_PATH = "/cloudsql/${module.cloud_sql.instance_connection_name}/.s.PGSQL.5432"
    DB_NAME        = module.cloud_sql.database_name
    DB_USER        = module.cloud_sql.app_user
  }
  db_secret = {
    DB_PASSWORD = {
      secret  = module.cloud_sql.db_password_secret_id
      version = "latest"
    }
  }
  # Source-API credentials for ingestion adapters. The secrets are created out-of-band
  # (gcloud) so the key values never live in Terraform state; we reference them by name.
  youtube_secret_id = "${var.environment}-youtube-api-key"
  ingestion_secret = merge(local.db_secret, {
    YOUTUBE_API_KEY = {
      secret  = local.youtube_secret_id
      version = "latest"
    }
  })
}

module "run_api" {
  source = "../modules/cloud_run"

  project_id               = var.project_id
  region                   = var.region
  name                     = "${var.environment}-api"
  image                    = local.images["api"]
  service_account_email    = module.service_accounts.emails["api"]
  allow_unauthenticated    = true
  cloudsql_connection_name = module.cloud_sql.instance_connection_name
  env                      = merge(local.common_env, local.db_env)
  secret_env               = local.db_secret
}

module "run_web" {
  source = "../modules/cloud_run"

  project_id            = var.project_id
  region                = var.region
  name                  = "${var.environment}-web"
  image                 = local.images["web"]
  service_account_email = module.service_accounts.emails["web"]
  allow_unauthenticated = true
  env = {
    NODE_ENV = "production"
    API_URL  = module.run_api.uri
  }
}

module "run_ingestion" {
  source = "../modules/cloud_run"

  project_id            = var.project_id
  region                = var.region
  name                  = "${var.environment}-ingestion"
  image                 = local.images["ingestion"]
  service_account_email = module.service_accounts.emails["ingestion"]
  invoker_members = [
    "serviceAccount:${module.service_accounts.scheduler_email}",
    "serviceAccount:${module.service_accounts.emails["ingestion"]}",
  ]
  cloudsql_connection_name = module.cloud_sql.instance_connection_name
  secret_env               = local.ingestion_secret
  env = merge(local.common_env, local.db_env, {
    RAW_BUCKET  = module.storage.raw_bucket
    TASKS_QUEUE = module.cloud_tasks.queue_name
    ITEM_TOPIC  = "${var.environment}-item" # deterministic name; avoids a cycle with the pubsub module
  })
}

# Ingestion SA reads the YouTube Data API key. Secret is created via gcloud (value out of
# state); we grant accessor here and reference it by full resource name.
resource "google_secret_manager_secret_iam_member" "ingestion_youtube_reader" {
  project   = var.project_id
  secret_id = "projects/${var.project_id}/secrets/${local.youtube_secret_id}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${module.service_accounts.emails["ingestion"]}"
}

module "run_sentiment" {
  source = "../modules/cloud_run"

  project_id               = var.project_id
  region                   = var.region
  name                     = "${var.environment}-sentiment-worker"
  image                    = local.images["sentiment-worker"]
  service_account_email    = module.service_accounts.emails["sentiment-worker"]
  invoker_members          = ["serviceAccount:${module.service_accounts.pubsub_invoker_email}"]
  cloudsql_connection_name = module.cloud_sql.instance_connection_name
  secret_env               = local.db_secret
  env = merge(local.common_env, local.db_env, {
    RAW_BUCKET = module.storage.raw_bucket
  })
}

module "run_report" {
  source = "../modules/cloud_run"

  project_id               = var.project_id
  region                   = var.region
  name                     = "${var.environment}-report-worker"
  image                    = local.images["report-worker"]
  service_account_email    = module.service_accounts.emails["report-worker"]
  invoker_members          = ["serviceAccount:${module.service_accounts.pubsub_invoker_email}"]
  cloudsql_connection_name = module.cloud_sql.instance_connection_name
  secret_env               = local.db_secret
  env = merge(local.common_env, local.db_env, {
    REPORTS_BUCKET = module.storage.reports_bucket
  })
}

# --- Event backbone + cron ---------------------------------------------------
module "pubsub" {
  source = "../modules/pubsub"

  project_id            = var.project_id
  project_number        = var.project_number
  name_prefix           = var.environment
  sentiment_push_url    = module.run_sentiment.uri
  report_push_url       = module.run_report.uri
  ingestion_sa_email    = module.service_accounts.emails["ingestion"]
  scheduler_sa_email    = module.service_accounts.scheduler_email
  push_invoker_sa_email = module.service_accounts.pubsub_invoker_email
}

module "scheduler" {
  source = "../modules/scheduler"

  project_id         = var.project_id
  region             = var.region
  name_prefix        = var.environment
  scheduler_sa_email = module.service_accounts.scheduler_email
  ingestion_url      = module.run_ingestion.uri
  report_topic_id    = module.pubsub.report_topic_id
}
