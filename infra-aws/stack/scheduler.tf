# ── Scheduled collection and rollup ──────────────────────────────────────────
#
# NOTHING IN THIS SYSTEM HAS EVER RUN ON A TIMER. There was no scheduler anywhere in this tree
# before this file: the periodic design lived only in `infra/` (GCP Cloud Scheduler), which was
# never deployed. So `POST /ingest/dispatch` and `POST /ingest/rollup` existed and were never
# called by anything, and `dimension_scores` — which is what produces the Brand Perception Index,
# the five dimensions and every trend — has never been written in a deployed environment.
#
# The schedules target SQS, not the ingestion service. Ingestion has no ALB target group and no
# listener rule, so nothing outside the VPC can reach it over HTTP; and a collection sweep blocks
# on third-party APIs for minutes, which is not a request to hold open. EventBridge Scheduler
# writes a job name to the queue and ingestion works out the rest.

resource "aws_scheduler_schedule_group" "main" {
  name = "${local.name_prefix}-schedules"
}

# Collection. Hourly is deliberate rather than aspirational: the index moves on a 90-day
# half-life, so more frequent collection changes nothing a user could see while multiplying
# third-party API calls against quotas that are shared with every other tenant.
resource "aws_scheduler_schedule" "scan" {
  name       = "${local.name_prefix}-scan-all"
  group_name = aws_scheduler_schedule_group.main.name

  # UTC explicitly. A schedule in a DST-observing zone silently runs twice on one day a year and
  # not at all on another.
  schedule_expression          = "cron(0 * * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    # Fifteen minutes of jitter, so every tenant's sweep does not start on the same second and
    # collide on the same third-party rate limits.
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 15
  }

  target {
    arn      = aws_sqs_queue.main["scan"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "scan-all" })

    retry_policy {
      # One retry. The next hourly firing is the real retry; piling attempts on a queue that is
      # already down only deepens the backlog.
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 600
    }
  }
}

# Rollup. Runs on the half hour, deliberately offset from collection: scoring is asynchronous and
# rolling up at the same moment a sweep starts would summarise signals that have not been scored
# yet. Half an hour is not a guarantee — it is enough for a normal sweep, and the next rollup
# picks up anything late.
resource "aws_scheduler_schedule" "rollup" {
  name       = "${local.name_prefix}-rollup"
  group_name = aws_scheduler_schedule_group.main.name

  schedule_expression          = "cron(30 * * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_sqs_queue.main["scan"].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "rollup" })

    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 600
    }
  }
}

# The scheduler's own role. Send-only, and only to the scan queue: EventBridge never needs to
# read, and a scheduler that could consume would race the service that is meant to.
resource "aws_iam_role" "scheduler" {
  name = "${local.name_prefix}-scheduler"
  tags = { Name = "${local.name_prefix}-scheduler" }

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        # Confused-deputy guard. Without it, any EventBridge schedule in ANY account could assume
        # this role — and this is a shared sandbox with co-tenant projects in it.
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "send-scan"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = [aws_sqs_queue.main["scan"].arn]
    }]
  })
}
