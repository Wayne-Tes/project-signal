# Cloud SQL Postgres with a private IP, plus the app user's password in Secret Manager.

resource "google_sql_database_instance" "main" {
  project          = var.project_id
  name             = "${var.name_prefix}-project-signal-pg"
  region           = var.region
  database_version = var.database_version

  deletion_protection = var.deletion_protection

  settings {
    # ENTERPRISE edition supports shared-core tiers (db-f1-micro); ENTERPRISE_PLUS does not.
    edition   = "ENTERPRISE"
    tier      = var.tier
    disk_size = var.disk_size_gb
    disk_type = "PD_SSD"

    ip_configuration {
      # Public IP with NO authorized networks: the instance is not reachable from the
      # open internet — only through the Cloud SQL Auth Proxy, which is what Cloud Run's
      # native Cloud SQL connection uses. Avoids the always-on Serverless VPC connector.
      ipv4_enabled = true
    }

    backup_configuration {
      enabled = true
    }
  }
}

resource "google_sql_database" "app" {
  project  = var.project_id
  name     = var.database_name
  instance = google_sql_database_instance.main.name
}

resource "random_password" "app_user" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  project  = var.project_id
  name     = var.app_user
  instance = google_sql_database_instance.main.name
  password = random_password.app_user.result
}

# Store the DB password in Secret Manager; Cloud Run injects it as DB_PASSWORD and connects
# over the Cloud SQL Auth Proxy unix socket (DB_SOCKET_PATH = /cloudsql/<connection_name>).
resource "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-db-password"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.app_user.result
}
