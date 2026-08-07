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

output "cost_allocation_tags_managed" {
  description = "Whether Terraform activated the cost allocation tags. False means the platform team must activate them from the Organization management account."
  value       = var.manage_cost_allocation_tags
}
