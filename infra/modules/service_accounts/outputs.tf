output "emails" {
  description = "Map of runtime service name -> service account email."
  value       = { for k, sa in google_service_account.runtime : k => sa.email }
}

output "scheduler_email" {
  description = "Email of the Cloud Scheduler service account."
  value       = google_service_account.scheduler.email
}

output "pubsub_invoker_email" {
  description = "Email of the Pub/Sub push-invoker service account."
  value       = google_service_account.pubsub_invoker.email
}
