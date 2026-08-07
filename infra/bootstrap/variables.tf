variable "project_id" {
  description = "GCP project ID that hosts Project Signal."
  type        = string
}

variable "region" {
  description = "Default GCP region for regional resources (London = europe-west2)."
  type        = string
  default     = "europe-west2"
}

variable "state_bucket_name" {
  description = "Globally unique name for the GCS bucket holding Terraform remote state."
  type        = string
}

variable "github_repository" {
  description = "GitHub repo allowed to authenticate via Workload Identity Federation, as 'owner/name'."
  type        = string
  default     = "Wayne-Tes/project-signal"
}

variable "enabled_apis" {
  description = "GCP service APIs to enable for the project."
  type        = list(string)
  default = [
    "cloudresourcemanager.googleapis.com",
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "aiplatform.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "identitytoolkit.googleapis.com",
    # Firebase Management API — needed to add Firebase to the project and create the web app
    # that supplies the NEXT_PUBLIC_FIREBASE_* build args.
    "firebase.googleapis.com",
    # YouTube Data API — the ingestion adapter's API key is issued against this project.
    "youtube.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "cloudbilling.googleapis.com",
  ]
}

variable "ci_service_account_roles" {
  description = "IAM roles granted to the CI deploy service account (used by GitHub Actions)."
  type        = list(string)
  default = [
    "roles/run.admin",
    "roles/cloudsql.admin",
    "roles/pubsub.admin",
    "roles/cloudscheduler.admin",
    "roles/cloudtasks.admin",
    "roles/secretmanager.admin",
    "roles/artifactregistry.admin",
    "roles/storage.admin",
    "roles/identityplatform.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.serviceAccountUser",
    "roles/resourcemanager.projectIamAdmin",
    "roles/serviceusage.serviceUsageAdmin",
  ]
}
