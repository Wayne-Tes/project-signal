# Phase 4 — logging.
#
# One log group for every service, with the service name as the stream prefix, rather than a
# group per service. The pipeline is a chain — ingest, score, roll up — and the questions worth
# asking cross services ("what happened to signal X?"). One group makes that a single Logs
# Insights query instead of four correlated ones.

resource "aws_cloudwatch_log_group" "app" {
  name = "/${local.name_prefix}/app"

  # 30 days. Long enough to investigate a weekly ingestion run that went wrong two runs ago,
  # short enough that the group is not a slow storage bill nobody is watching.
  retention_in_days = 30

  tags = { Name = "${local.name_prefix}-app-logs" }
}
