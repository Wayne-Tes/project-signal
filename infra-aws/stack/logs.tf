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

# ECS Exec session transcripts (ecs.tf, cluster `execute_command_configuration`). Kept for a year,
# not 30 days: this is an access record — who opened a shell in a task holding DATABASE_URL, and
# what they ran — and those questions get asked long after the fact.
resource "aws_cloudwatch_log_group" "exec" {
  name              = "/${local.name_prefix}/ecs-exec"
  retention_in_days = 365

  tags = { Name = "${local.name_prefix}-ecs-exec-logs" }
}

# ── RDS log exports ─────────────────────────────────────────────────────────────────────────
#
# rds.tf exports `postgresql` and `upgrade` logs. RDS creates their log groups ITSELF on first
# write, with NO retention — so before 2026-11-16 they grew forever, unmanaged and untagged.
#
# The groups may already exist in the account, and creating an existing log group fails the
# apply. They are therefore ADOPTED with `import` blocks rather than created. Which ones exist is
# a fact about the account that this repository cannot know offline, so it is an explicit input:
#
#   aws logs describe-log-groups --region eu-west-2 \
#     --log-group-name-prefix /aws/rds/instance/psignal-dev-postgres/ \
#     --query 'logGroups[].logGroupName'
#
# List each EXISTING one in var.rds_log_groups_existing (envs/dev.stack.tfvars). One that does not
# exist yet is simply created, with retention, before RDS ever writes to it.

locals {
  rds_log_exports = toset(["postgresql", "upgrade"])
}

resource "aws_cloudwatch_log_group" "rds" {
  for_each = local.rds_log_exports

  name              = "/aws/rds/instance/${local.name_prefix}-postgres/${each.key}"
  retention_in_days = 30

  tags = { Name = "${local.name_prefix}-postgres-${each.key}-logs" }
}

import {
  for_each = toset([for g in var.rds_log_groups_existing : g if contains(local.rds_log_exports, g)])
  to       = aws_cloudwatch_log_group.rds[each.key]
  id       = "/aws/rds/instance/${local.name_prefix}-postgres/${each.key}"
}
