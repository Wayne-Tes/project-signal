output "state_bucket_name" {
  description = "GCS bucket holding Terraform remote state. Use as the backend for each environment."
  value       = google_storage_bucket.tf_state.name
}

output "ci_service_account_email" {
  description = "Service account GitHub Actions impersonates to deploy."
  value       = google_service_account.ci_deployer.email
}

output "workload_identity_provider" {
  description = "Full WIF provider resource name for the GitHub Actions auth step."
  value       = google_iam_workload_identity_pool_provider.github.name
}
