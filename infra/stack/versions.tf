terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Send the quota/billing project on API calls (required by identitytoolkit and other
  # APIs that don't infer a quota project from the credentials).
  user_project_override = true
  billing_project       = var.project_id
}
