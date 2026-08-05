terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Bootstrap uses local state because it CREATES the remote state bucket
  # (chicken-and-egg). After the first apply, migrate this state into the
  # created bucket with `terraform init -migrate-state` if desired.
  backend "local" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
