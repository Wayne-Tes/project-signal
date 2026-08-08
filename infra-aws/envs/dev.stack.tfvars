# Stack-only values. Kept separate from dev.tfvars so that bootstrap, which does not declare
# these variables, can consume dev.tfvars without Terraform warning about undeclared values.

# Sizing this is a judgement, so here is the arithmetic behind it rather than a round number.
# Expected steady state once Phase 4 is complete, eu-west-2 on-demand:
#
#   RDS db.t4g.micro, single-AZ, 20GB gp3      ~ $15
#   4x Fargate task, 0.25 vCPU / 0.5 GB, 24/7  ~ $36   <- does NOT scale to zero
#   Application Load Balancer                  ~ $17
#   NAT gateway (if Phase 2 uses one)          ~ $33   <- prefer VPC endpoints; see infra-aws/README.md
#   S3 + SQS + Secrets Manager                 ~  $3
#   Bedrock (Haiku 4.5, low volume)            ~  $5
#                                              -------
#                                              ~ $109
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
