# Deliberately a very small surface. This module is account-global, so it takes no project
# identity at all — no `project`, no `project_prefix`, no `environment`, no tag values. If you
# find yourself wanting to add one, that is the signal the resource belongs in stack/ instead.

variable "aws_account_id" {
  description = "The AWS account whose ACCOUNT-WIDE settings this module manages. Any other account aborts before the first API call."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits."
  }
}

variable "aws_region" {
  description = "Region the provider resolves. Cost Explorer is a global service; if an apply fails on endpoint resolution, set this to us-east-1 — a region change only, in the same account."
  type        = string
}

variable "mandatory_tag_keys" {
  description = <<-EOT
    The tag keys activated as cost allocation tags, account-wide.

    THIS IS THE CANONICAL LIST and it is single-sourced here. It must match the keys in the
    `default_tags` blocks of infra-aws/bootstrap/versions.tf and infra-aws/stack/versions.tf
    CHARACTER FOR CHARACTER. AWS tag keys are case-sensitive and cost allocation tags are
    activated by exact key, so applying `Project` and activating `project` yields two different
    tags, one of which attributes nothing — silently, and reported as a healthy $0.
  EOT
  type        = list(string)

  default = [
    "Project",
    "Owner",
    "CostCentre",
    "Environment",
    "ManagedBy",
    "Expires",
  ]

  validation {
    condition     = length(var.mandatory_tag_keys) > 0
    error_message = "At least one tag key is required — an empty list makes this module a no-op that looks like it worked."
  }
}
