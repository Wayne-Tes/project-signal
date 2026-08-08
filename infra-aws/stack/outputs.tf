output "account_id" {
  description = "The account actually provisioned into. If this is not 290304998906, every account-specific fact in docs/HANDOVER.md §3 is unverified."
  value       = data.aws_caller_identity.current.account_id
}

output "region" {
  description = "Region resolved by the provider."
  value       = data.aws_region.current.region
}

output "name_prefix" {
  description = "The prefix every resource in this project is named with. The teardown script scopes to it."
  value       = local.name_prefix
}

output "budget_name" {
  description = "The project budget. Distinct from the account-wide monthly_tesai-dev-sandbox, which this does not touch."
  value       = aws_budgets_budget.project.name
}

output "budget_tag_filter" {
  description = "The cost filter the budget matches on. Verify with `aws ce list-cost-allocation-tags` that the Project key is Active, or this silently reports zero."
  value       = local.budget_tag_filter
}

# There is deliberately no `cost_allocation_tags_managed` output. Whether the keys are Active is
# a fact about the ACCOUNT, not about this stack's state, and reporting it from here would be
# reporting an intention rather than a reality. Read it from the account itself:
#
#   aws ce list-cost-allocation-tags --status Active
#   bash infra-aws/scripts/10-preflight.sh    # §3 does exactly this, and interprets it
#
# See infra-aws/account/ for the module that activates them.
