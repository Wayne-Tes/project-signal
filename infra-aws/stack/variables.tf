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
