# Every variable here is REQUIRED and has no default, deliberately. A default is how a
# mandatory tag quietly becomes an optional one — see docs/HANDOVER.md §3.2, where the whole
# point of the tag set is that a resource cannot exist without being attributable.

variable "aws_account_id" {
  description = "The AWS account this stack may provision into. Any other account aborts the run before the first API call."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits."
  }
}

variable "aws_region" {
  description = "Region for all resources. Storage, database and queues stay in eu-west-2 regardless of where Bedrock inference routes."
  type        = string
}

variable "project" {
  description = "Project tag value, e.g. project-signal. The discriminator between co-tenant workloads in this shared account, and what the budget's cost filter matches on."
  type        = string
}

# Deliberately distinct from var.project. The tag is read by humans and by Cost Explorer, so it
# is spelled out; the prefix goes into resource names, several of which are length-limited
# (ALB target groups cap at 32 chars, IAM roles at 64), so it is short. Conflating them means
# either an unreadable tag or a name that will not fit later.
variable "project_prefix" {
  description = "Short prefix for every resource name, e.g. psignal. Combined as <prefix>-<environment>-<resource>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{2,12}$", var.project_prefix))
    error_message = "project_prefix must be 2-12 lower-case alphanumeric characters — it is used in S3 bucket names, which forbid upper case."
  }
}

variable "environment" {
  description = "Environment tag and name-prefix segment, e.g. dev. Describes OUR environment, not the account."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+$", var.environment))
    error_message = "environment must be lower-case alphanumeric — it becomes part of S3 bucket names, which forbid upper case."
  }
}

variable "owner" {
  description = "Owner tag. A person or team reachable without opening a ticket."
  type        = string
}

variable "cost_centre" {
  description = "CostCentre tag. Must be activated as a cost allocation tag in Billing or spend is not attributable."
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
