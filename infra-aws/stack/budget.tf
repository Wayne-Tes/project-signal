# Cost controls, created BEFORE anything billable exists (rule 4, docs/AWS-SETUP.md).
#
# This file creates ONE thing: a budget filtered to THIS project's tag, so the alarm is ours and
# not the account's. The account already has `monthly_tesai-dev-sandbox` covering total spend
# (docs/HANDOVER.md §3.3). That one belongs to whoever runs the sandbox — it is not touched
# here, and this budget sits alongside it rather than replacing it.
#
# ── THE HALF THAT IS NO LONGER HERE, AND WHY ────────────────────────────────────────────────
#
# This file used to also activate the six mandatory tag keys as cost allocation tags, via
# `aws_ce_cost_allocation_tag`. That has moved to `infra-aws/account/`, which has its own state
# and its own lifecycle. It was moved because tag activation is ACCOUNT-GLOBAL, not
# project-scoped, and owning an account-global resource from a project's state file meant:
#
#   - `terraform destroy` here — which `scripts/99-teardown.sh --execute` runs — would have
#     deactivated those keys FOR EVERY PROJECT IN THE SHARED ACCOUNT. Tearing down Project
#     Signal would have silently broken cost attribution for unrelated workloads.
#   - Activation does not backfill, so that breakage would have been permanent, not temporary.
#   - CONVENTIONS.md §7 tells the next repo to copy this tree; two copies would have given two
#     states ownership of the same six global switches.
#
# THE DEPENDENCY IS NOW A PRECONDITION, NOT A `depends_on`. The budget below is useless until
# the `Project` key is Active — it will match nothing and cheerfully report $0. Terraform can no
# longer express that ordering across state boundaries, so it is enforced by
# `scripts/10-preflight.sh` §3, which checks activation status independently and is the thing
# you run before applying. That is a fair trade: a check that reads the real account beats an
# ordering edge that only proves one Terraform run happened before another.

resource "aws_budgets_budget" "project" {
  name         = "${local.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Scoped to our tag, so this reports Project Signal's spend and not the sandbox's. Every
  # resource in this tree carries the tag by construction — it comes from the provider's
  # default_tags, so a resource cannot be created without it.
  cost_filter {
    name   = "TagKeyValue"
    values = [local.budget_tag_filter]
  }

  # 50% ACTUAL — an early "something is running that I did not expect" signal. On a stack whose
  # steady state should be predictable, crossing half the ceiling mid-month is informative.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  # 90% ACTUAL — act now, the ceiling is imminent.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 90
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  # 100% ACTUAL — the ceiling is breached. Kept separate from 90 so the mail subject differs
  # between "about to" and "has".
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_notification_emails
  }

  # 100% FORECASTED is the one that matters most here, and it is why this file exists at all.
  # ECS Fargate does not scale to zero — the GCP costing this replaces (~$13-15/mo) rested
  # entirely on Cloud Run doing so. Idle services bill continuously, so the useful alarm is the
  # one that fires on the TRAJECTORY early in the month, not the one that fires on the 29th.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_notification_emails
  }
}
