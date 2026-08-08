output "account_id" {
  description = "The account whose cost allocation tags were activated. If this is not 290304998906, stop — this module changes account-wide billing configuration."
  value       = data.aws_caller_identity.current.account_id
}

output "activated_tag_keys" {
  description = "The tag keys now Active as cost allocation tags, account-wide. Verify independently with `aws ce list-cost-allocation-tags --status Active`, or via infra-aws/scripts/10-preflight.sh §3."
  value       = sort(keys(aws_ce_cost_allocation_tag.mandatory))
}
