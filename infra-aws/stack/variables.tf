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

  # The sandbox rule (CLAUDE.md) as a hard constant. `allowed_account_ids` in versions.tf takes
  # its value FROM this variable, so without this check a `-var aws_account_id=...` or a different
  # tfvars file would silently move the allowed account along with it. Changing this literal is a
  # reviewed decision to target another account, never a flag someone passes in a hurry.
  validation {
    condition     = var.aws_account_id == "290304998906"
    error_message = "This repository may only target the TES sandbox account 290304998906 (tesai-dev-sandbox). See CLAUDE.md and infra-aws/CONVENTIONS.md §0."
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

    Sizing note: ECS Fargate does not scale to zero, unlike the Cloud Run design this replaces,
    and the stack runs one NAT gateway (~$33/mo before a byte crosses it — see nat.tf for why a
    NAT rather than VPC endpoints). The arithmetic is in envs/dev.stack.tfvars. Set this above
    realistic steady state but low enough to be a genuine alarm rather than decoration.
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

# ── Phase 4: services ────────────────────────────────────────────────────────────────────────

variable "image_tag" {
  description = <<-EOT
    Container image tag deployed to every ECS service. REQUIRED, with no default, deliberately:
    Terraform owns the deployed image, so an apply that forgot the tag would otherwise silently
    roll every service back to whatever was last written. Pass it explicitly:

      terraform apply -var="image_tag=$(git rev-parse --short HEAD)" ...

    ECR repositories are IMMUTABLE, so a tag always identifies exactly one image.
  EOT
  type        = string

  validation {
    condition     = length(var.image_tag) > 0
    error_message = "image_tag must not be empty — see the note above about silent rollbacks."
  }
}

# ── Lifecycle of stateful resources ─────────────────────────────────────────────────────────

variable "allow_force_destroy" {
  description = <<-EOT
    Lets `terraform destroy` remove NON-EMPTY ECR repositories and S3 buckets (ECR force_delete,
    S3 force_destroy). Without it, 99-teardown.sh --execute fails on the first repository that
    holds an image and the first versioned bucket that holds an object — i.e. always.

    TRUE ONLY where the contents are reproducible: dev re-ingests raw payloads and rebuilds images
    from git. FALSE anywhere the raw bucket is an audit trail someone relies on — there the
    contents must be exported deliberately before a destroy, never deleted as a side effect.
  EOT
  type        = bool
}

variable "protect_stateful_resources" {
  description = <<-EOT
    Deletion protection on the Cognito user pool. Destroying the pool deletes every user and
    every `sub` the users table keys on, so in any environment holding real users this must be
    TRUE. Dev sets it FALSE for the same reason db_deletion_protection is false there: the
    teardown script must genuinely tear down, and dev users are re-creatable.
  EOT
  type        = bool
}

variable "rds_log_groups_existing" {
  description = "Which RDS log export groups (`postgresql`, `upgrade`) ALREADY exist in the account and must be adopted by import rather than created. Verify with the describe-log-groups command in logs.tf immediately before applying — never assume."
  type        = list(string)

  validation {
    condition     = alltrue([for g in var.rds_log_groups_existing : contains(["postgresql", "upgrade"], g)])
    error_message = "rds_log_groups_existing may contain only \"postgresql\" and/or \"upgrade\"."
  }
}

# ── Edge ────────────────────────────────────────────────────────────────────────────────────

variable "certificate_arn" {
  description = <<-EOT
    ACM certificate ARN (same region as the ALB) for HTTPS. NULL means HTTP only — the state today,
    because an ALB's own *.elb.amazonaws.com name cannot carry a certificate and no domain has
    been chosen (docs/OWNER-ACTIONS.md, hostname item). When set, the ALB gains a 443 listener
    with a TLS 1.3/1.2 policy, every API rule moves to it, and port 80 becomes a permanent
    redirect to HTTPS — so Cognito tokens never cross the internet in cleartext.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.certificate_arn == null || can(regex("^arn:aws:acm:[a-z0-9-]+:[0-9]{12}:certificate/", var.certificate_arn))
    error_message = "certificate_arn must be null or an ACM certificate ARN."
  }
}

variable "scorer_model" {
  description = "Bedrock inference profile for per-signal sentiment scoring. High volume: one call per signal. VERIFY IT EXISTS before changing — `aws bedrock list-inference-profiles --region eu-west-2`. This repo has shipped a retired model id and one that never existed."
  type        = string
}

variable "assistant_model" {
  description = "Bedrock inference profile for the interactive in-product assistant. Separate from the scorer so a latency-sensitive surface can be tuned without disturbing the queue-driven pipeline. VERIFY BY INVOKING IT — listing a profile does not mean this account may use it."
  type        = string
}

variable "reporter_model" {
  description = "Bedrock inference profile for weekly narrative reports. Low volume, higher quality — the slot that justifies a stronger model. Unused until Epic 12, so it stays on the verified scorer model until someone measures the alternative."
  type        = string
}
