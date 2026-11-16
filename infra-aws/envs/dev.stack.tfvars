# Stack-only values. Kept separate from dev.tfvars so that bootstrap, which does not declare
# these variables, can consume dev.tfvars without Terraform warning about undeclared values.

# Sizing this is a judgement, so here is the arithmetic behind it rather than a round number.
# Steady state of the stack AS DEPLOYED (re-derived 2026-11-16 from ecs.tf), eu-west-2 on-demand.
# The Fargate figures scale the original estimate of ~$9/month per 0.25 vCPU / 0.5 GB task; they
# are estimates, and Cost Explorer grouped by SERVICE is the measurement (docs/HANDOVER.md §6):
#
#   RDS db.t4g.micro, single-AZ, 20GB gp3        ~ $15
#   3x Fargate 0.25 vCPU / 0.5 GB (web, ingestion,
#      sentiment-worker), 24/7                   ~ $27   <- does NOT scale to zero
#   1x Fargate 0.5 vCPU / 1 GB (api), 24/7       ~ $18
#   Application Load Balancer                    ~ $17
#   NAT gateway, one AZ                          ~ $33   <- the only complete egress option; see nat.tf
#   S3 + SQS + Secrets Manager + ALB access logs ~  $3
#   Container Insights (enhanced)                ~  $3
#   CloudWatch alarms (13) + SNS                 ~  $1
#   Bedrock (low volume)                         ~  $5
#                                                -------
#                                                ~ $122
#
# 150 leaves headroom for a bad week without being so generous that breaching it means nothing.
# The FORECASTED notification is the one that will actually catch a mistake here, because
# Fargate bills continuously and a forgotten service shows in the trajectory long before it
# shows in the total.
monthly_budget_usd = 150

budget_notification_emails = ["wayne.strydom@tes.com"]

# `manage_cost_allocation_tags` used to be set here. Cost allocation tag activation is
# ACCOUNT-GLOBAL and has moved to its own root module with its own state — see
# infra-aws/account/ and infra-aws/envs/account.tfvars. It is applied deliberately, by the
# account owner or the platform team, and never as part of a project deploy.
#
# The budget below still needs the `Project` key to be Active or it matches nothing and reports
# $0 forever. That precondition is checked by infra-aws/scripts/10-preflight.sh §3, which you
# run before applying.

# ── Phase 2: network ──────────────────────────────────────────────────────────────────────────
# Registered in infra-aws/CONVENTIONS.md §6. Allocations start at 10.20 so the scheme cannot
# collide with a corporate network occupying 10.0.x. Add a row there before claiming a new one.
vpc_cidr = "10.20.0.0/16"

# ── Phase 2: database ─────────────────────────────────────────────────────────────────────────
# Verified available in eu-west-2 on 2026-08-08:
#   aws rds describe-db-engine-versions --engine postgres --region eu-west-2
#     -> 16.10 16.11 16.12 16.13 16.14
#   aws rds describe-orderable-db-instance-options --engine postgres --engine-version 16.14
#     -> db.t4g.micro supports gp3
# Do not change either value without re-running those commands. A version written from memory
# fails the apply, and this repo has already shipped two model ids that did not exist.
db_engine_version = "16.14"
db_instance_class = "db.t4g.micro"

# 20GB is the gp3 floor. Autoscaling to 100GB means a runaway ingestion cannot fill the disk and
# take the database down — but growth is automatic and NOT reversible, so the ceiling is the
# actual cost control. ~$0.10/GB-month.
db_allocated_storage     = 20
db_max_allocated_storage = 100

# Match docker-compose so a connection string differs only by host between local and dev.
db_name     = "project_signal"
db_username = "project_signal_app"

# Dev settings. Every one of these flips for a production environment.
db_multi_az              = false # Multi-AZ roughly doubles instance cost; dev data is re-ingestable
db_backup_retention_days = 7     # Cheap insurance even in dev; 0 would disable backups entirely
db_deletion_protection   = false # So 99-teardown.sh genuinely tears down
db_skip_final_snapshot   = true  # A snapshot of reproducible data is storage nobody restores
db_apply_immediately     = true  # No waiting for a maintenance window while iterating

# 0 = delete immediately on destroy. Otherwise Secrets Manager holds the NAME for 7-30 days and
# the next apply collides with a secret scheduled for deletion — a confusing failure to hit
# while iterating. Set to 7+ anywhere the credential loss would matter.
secret_recovery_window_days = 0

# Dev: teardown must genuinely tear down. ECR repositories and S3 buckets are emptied by
# `terraform destroy` (images rebuild from git; raw payloads re-ingest), the Cognito pool and the
# ALB carry no deletion protection. BOTH flip to the opposite value anywhere data or users are real.
allow_force_destroy        = true
protect_stateful_resources = false

# RDS log export groups that ALREADY exist in the account and are adopted by import (logs.tf).
# ⚠️ NOT YET VERIFIED — this repository cannot read the account offline. Immediately before the
# next apply, run (read-only, sandbox only):
#   aws logs describe-log-groups --region eu-west-2 \
#     --log-group-name-prefix /aws/rds/instance/psignal-dev-postgres/ --query 'logGroups[].logGroupName'
# and list exactly the suffixes it returns. `postgresql` is pre-filled because exports have been
# enabled since 2026-08-08 and Postgres writes on every start; `upgrade` only exists if a minor
# upgrade has run. A wrong entry fails the plan (import of a missing group) or the apply
# (create of an existing one) — both before anything is changed.
rds_log_groups_existing = ["postgresql"]

# No certificate yet — HTTP only. Set to an ACM ARN in eu-west-2 once a domain exists.
# certificate_arn = "arn:aws:acm:eu-west-2:290304998906:certificate/<id>"

# ── Phase 4: Bedrock model routing ────────────────────────────────────────────────────────────
# Named by USE CASE, not by provider, so the underlying model changes without touching a call
# site. Both are EU inference profiles — the `eu.` prefix keeps inference inside the EU, and the
# bare model id (no prefix) is rejected at invoke time with "on-demand throughput isn't
# supported".
#
# History, because it explains the value: on 2026-08-08T23:39Z only Sonnet 5 and Opus 5
# answered an invoke; Haiku 4.5 and the other older profiles returned ResourceNotFoundException,
# "Model use case details have not been submitted for this account", and every slot was moved to
# Sonnet 5. The Anthropic use case form was then submitted (docs/OWNER-ACTIONS.md #1, 2026-08-09
# 10:20Z) and Haiku 4.5 INVOKED SUCCESSFULLY again, so all three slots returned to Haiku 4.5 —
# the values below, which match the defaults in libs/config/src/index.ts.
#
# The evidence that counts is an INVOKE, never a listing: every refusing profile was still listed
# ACTIVE by `list-inference-profiles`, and `get-foundation-model-availability` reported
# NOT_AVAILABLE for profiles that answered. Re-invoke before changing any value here.
#
# SCORER: runs once per signal — the cost-sensitive slot, and the reason it is Haiku.
scorer_model = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"

# REPORTER: deliberately the SAME model as the scorer. Opus 5 also works and the reporter is the
# slot that would benefit — but nothing reads it until Epic 12 and no output has been measured.
# Shipping an unmeasured "better" default is a smaller version of how this project came to ship
# gemini-2.0-pro-001, a model that never existed. Change it when Epic 12 can compare two outputs.
reporter_model = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"

# ASSISTANT: the interactive in-product assistant. Separate variable so a latency-sensitive
# surface can be tuned without disturbing the queue-driven scoring pipeline.
assistant_model = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
