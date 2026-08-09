# Phase 3/4 — the work queues.
#
# `item` carries one message per newly ingested signal, body = the bare signal uuid. The
# sentiment worker consumes it. `report` is published to weekly and is unused until Epic 12.
#
# Each has a dead-letter queue with maxReceiveCount = 5, matching scripts/localstack-init.sh so
# the local stack fails the same way this one does. That redrive policy is only meaningful
# because the worker classifies failures: permanent ones ack (retrying sends the identical
# prompt and gets the identical garbage), transient ones nack so the backoff and the DLQ can
# actually fire. KNOWN-GAPS #9 was the defect where everything was swallowed and the DLQ could
# never trigger — do not reintroduce a catch-all in the consumer.

locals {
  queues = toset(["item", "report", "scan"])
}

resource "aws_sqs_queue" "dlq" {
  for_each = local.queues

  name = "${local.name_prefix}-${each.value}-dlq"

  # 14 days, the maximum. A dead letter is evidence of a defect; giving it a fortnight means a
  # failure on a Friday is still there to diagnose after a week off.
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true

  tags = { Name = "${local.name_prefix}-${each.value}-dlq" }
}

resource "aws_sqs_queue" "main" {
  for_each = local.queues

  name = "${local.name_prefix}-${each.value}"

  # Visibility must exceed the worst-case processing time or a slow message is redelivered while
  # still being worked, producing duplicate scoring. Scoring is one Bedrock call — sub-second in
  # practice — but 300s leaves room for a model that is throttling and retrying internally.
  # Scoring is idempotent on the unique signal_id anyway, so a duplicate is wasteful, not wrong.
  visibility_timeout_seconds = 300

  message_retention_seconds = 345600 # 4 days
  sqs_managed_sse_enabled   = true

  # Long polling. Without it a consumer polling an empty queue burns requests and CPU for
  # nothing; 20s is the maximum and the right default for a queue that is idle most of the time.
  receive_wait_time_seconds = 20

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.value].arn
    maxReceiveCount     = 5
  })

  tags = { Name = "${local.name_prefix}-${each.value}" }
}

# Explicitly allow only this queue's source to redrive back out of the DLQ. Without it, moving
# messages off a DLQ for reprocessing is denied — which you discover at the worst possible
# moment, with a full DLQ and an incident in progress.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each = local.queues

  queue_url = aws_sqs_queue.dlq[each.value].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main[each.value].arn]
  })
}
