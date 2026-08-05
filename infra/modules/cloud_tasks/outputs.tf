output "queue_id" {
  description = "Full Cloud Tasks queue ID."
  value       = google_cloud_tasks_queue.ingestion.id
}

output "queue_name" {
  description = "Cloud Tasks queue short name."
  value       = google_cloud_tasks_queue.ingestion.name
}
