locals {
  ci_service_account_id = "project-signal-ci-deployer"
}

# --- Enable required project APIs -------------------------------------------
resource "google_project_service" "enabled" {
  for_each = toset(var.enabled_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Terraform remote state bucket ------------------------------------------
resource "google_storage_bucket" "tf_state" {
  name     = var.state_bucket_name
  project  = var.project_id
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled]
}

# --- CI deploy service account (impersonated via WIF, no JSON keys) ----------
resource "google_service_account" "ci_deployer" {
  project      = var.project_id
  account_id   = local.ci_service_account_id
  display_name = "Project Signal CI deployer (GitHub Actions via WIF)"
}

resource "google_project_iam_member" "ci_deployer_roles" {
  for_each = toset(var.ci_service_account_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ci_deployer.email}"
}

# --- Workload Identity Federation for GitHub Actions ------------------------
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions pool"
  depends_on                = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Restrict the pool to tokens issued for this repository only.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Allow the CI workflow (for this repo) to impersonate the deploy service account.
resource "google_service_account_iam_member" "ci_wif_binding" {
  service_account_id = google_service_account.ci_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
