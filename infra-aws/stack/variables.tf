# These mirror infra-aws/bootstrap/variables.tf and are fed from the SAME file,
# infra-aws/envs/<env>.tfvars, so the tag values can never drift between the two root modules.
# Terraform requires each root module to declare its own variables; only the values are shared.

variable "aws_account_id" {
  description = "The AWS account this stack may provision into. Any other account aborts the run before the first API call."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits."
  }
}

variable "aws_region" {
  description = "Region for all resources. Storage, database and queues stay here regardless of where Bedrock inference routes."
  type        = string
}

variable "project" {
  description = "Project tag value, e.g. project-signal. What the budget's cost filter matches on."
  type        = string
}

variable "project_prefix" {
  description = "Short prefix for every resource name, e.g. psignal. Combined as <prefix>-<environment>-<resource>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{2,12}$", var.project_prefix))
    error_message = "project_prefix must be 2-12 lower-case alphanumeric characters."
  }
}

variable "environment" {
  description = "Environment tag and name-prefix segment, e.g. dev. Describes OUR environment, not the account."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+$", var.environment))
    error_message = "environment must be lower-case alphanumeric."
  }
}

variable "owner" {
  description = "Owner tag. A person or team reachable without opening a ticket."
  type        = string
}

variable "cost_centre" {
  description = "CostCentre tag. Must be activated as a cost allocation tag or spend is not attributable."
  type        = string
}

variable "expires" {
  description = "Expires tag, ISO-8601 date. What makes the teardown script safe to point at stale resources."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", var.expires))
    error_message = "expires must be an ISO-8601 date, YYYY-MM-DD."
  }
}

variable "monthly_budget_usd" {
  description = <<-EOT
    Monthly cost ceiling for THIS project's tagged resources, in USD. Not an account budget —
    `monthly_tesai-dev-sandbox` already covers the account and must not be touched
    (docs/HANDOVER.md §3.3).

    Sizing note: ECS Fargate does not scale to zero, unlike the Cloud Run design this replaces.
    A NAT gateway is ~$32/mo on its own before a byte crosses it, which is why Phase 2 should
    prefer VPC endpoints. Set this above realistic steady state but low enough to be a genuine
    alarm rather than decoration.
  EOT
  type        = number

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be greater than zero."
  }
}

variable "budget_notification_emails" {
  description = "Who is emailed when a budget threshold trips. An unmonitored address makes the whole control theatre."
  type        = list(string)

  validation {
    condition     = length(var.budget_notification_emails) > 0
    error_message = "At least one notification address is required — a budget nobody is told about is not a cost control."
  }
}

# `manage_cost_allocation_tags` used to live here. It is gone, along with the resource it
# gated: cost allocation tag activation is account-global and now lives in
# `infra-aws/account/`, which has its own state so that destroying this stack cannot deactivate
# tags for co-tenant projects. The escape hatch went with it — a module you simply choose not
# to apply needs no flag to disable it.

# ── Phase 2: network ─────────────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR for this project's VPC. Registered in infra-aws/CONVENTIONS.md §6 — add a row there BEFORE applying a new one, because overlapping ranges make future peering impossible without renumbering."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

# ── Phase 2: database ────────────────────────────────────────────────────────────────────────

variable "db_engine_version" {
  description = "RDS Postgres version. VERIFY IT EXISTS before changing: `aws rds describe-db-engine-versions --engine postgres --region eu-west-2`. The same rule that applies to Bedrock model ids applies here — a version written from memory fails the apply."
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class. Verify with `aws rds describe-orderable-db-instance-options` that the class supports the engine version AND gp3 in this region."
  type        = string
}

variable "db_allocated_storage" {
  description = "Initial storage in GB. gp3 has a 20GB floor."
  type        = number

  validation {
    condition     = var.db_allocated_storage >= 20
    error_message = "db_allocated_storage must be at least 20 GB for gp3."
  }
}

variable "db_max_allocated_storage" {
  description = "Ceiling for RDS storage autoscaling. Set above allocated_storage to enable it; growth is automatic and irreversible, so this is the real cost control."
  type        = number
}

variable "db_name" {
  description = "Initial database name. Matches the local docker-compose database so connection strings differ only in host."
  type        = string
}

variable "db_username" {
  description = "Master username. Matches the local docker-compose user for the same reason."
  type        = string
}

variable "db_multi_az" {
  description = "Multi-AZ standby. Roughly doubles instance cost for a dev environment whose data is reproducible by re-ingesting. Off in dev, on in prod."
  type        = bool
}

variable "db_backup_retention_days" {
  description = "Automated backup retention. 0 disables backups entirely — never do that in an environment holding anything you would miss."
  type        = number

  validation {
    condition     = var.db_backup_retention_days >= 1
    error_message = "Keep at least one day of backups; 0 disables automated backups completely."
  }
}

variable "db_deletion_protection" {
  description = "Blocks `terraform destroy` on the instance. Off in dev so 99-teardown.sh genuinely tears down; ON in any environment with data worth keeping."
  type        = bool
}

variable "db_skip_final_snapshot" {
  description = "Skip the final snapshot on destroy. True in dev — a snapshot of reproducible data is storage nobody will ever restore. Must be false anywhere real."
  type        = bool
}

variable "db_apply_immediately" {
  description = "Apply modifications at once rather than in the maintenance window. True in dev to avoid waiting; false in prod, where an unexpected restart is an outage."
  type        = bool
}

variable "secret_recovery_window_days" {
  description = "Secrets Manager recovery window. 0 deletes immediately, which is what dev wants — otherwise the name is held for 7-30 days and the next apply collides with a secret scheduled for deletion."
  type        = number

  validation {
    condition     = var.secret_recovery_window_days == 0 || (var.secret_recovery_window_days >= 7 && var.secret_recovery_window_days <= 30)
    error_message = "secret_recovery_window_days must be 0, or between 7 and 30."
  }
}
