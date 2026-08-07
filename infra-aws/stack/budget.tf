# Cost controls, created BEFORE anything billable exists (rule 4, docs/AWS-SETUP.md).
#
# Two halves, and both are required for either to be useful:
#   1. Activate the mandatory tag keys as cost allocation tags, so AWS attributes spend to them.
#   2. A budget filtered to THIS project's tag, so the alarm is ours and not the account's.
#
# The account already has `monthly_tesai-dev-sandbox` covering total spend (docs/HANDOVER.md
# §3.3). That one belongs to whoever runs the sandbox — it is not touched here, and this budget
# sits alongside it rather than replacing it.

# --- 1. Cost allocation tags -------------------------------------------------------------
#
# Until a tag key is ACTIVE, Cost Explorer and Budgets cannot see it, and a budget filtered on
# it matches nothing while reporting a perfectly healthy $0. That failure is silent, which is
# what makes it worth the extra resource rather than a line in a runbook.
#
# Newly activated keys can take up to 24 hours to start attributing spend, and they only apply
# from activation forward — they do not backfill. Activating now, before the first billable
# resource, is therefore not merely tidy: it is the only moment it can be done without losing
# attribution for the resources created in between.
resource "aws_ce_cost_allocation_tag" "mandatory" {
  for_each = var.manage_cost_allocation_tags ? toset(local.mandatory_tag_keys) : toset([])

  tag_key = each.value
  status  = "Active"
}

# --- 2. The project budget ---------------------------------------------------------------

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

  # The tag filter is meaningless until the keys are active. Ordering them makes the dependency
  # explicit rather than incidental.
  depends_on = [aws_ce_cost_allocation_tag.mandatory]
}
