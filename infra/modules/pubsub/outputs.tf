output "item_topic_id" {
  description = "Full ID of the item topic (ingestion publishes here)."
  value       = google_pubsub_topic.item.id
}

output "report_topic_id" {
  description = "Full ID of the report topic (scheduler publishes here)."
  value       = google_pubsub_topic.report.id
}

output "item_topic_name" {
  description = "Short name of the item topic."
  value       = google_pubsub_topic.item.name
}

output "report_topic_name" {
  description = "Short name of the report topic."
  value       = google_pubsub_topic.report.name
}
