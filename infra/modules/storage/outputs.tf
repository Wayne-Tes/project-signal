output "raw_bucket" {
  description = "Name of the raw payloads bucket."
  value       = google_storage_bucket.raw.name
}

output "reports_bucket" {
  description = "Name of the reports bucket."
  value       = google_storage_bucket.reports.name
}
