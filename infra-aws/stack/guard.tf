# The provider's allowed_account_ids in versions.tf is the real enforcement — it aborts before
# any API call. This adds the account id to the plan output and to `terraform output`, so the
# account being targeted is visible in a plan review rather than inferred from a profile name.

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# A `check` block reports without blocking. The blocking guard is allowed_account_ids; this
# exists so that a mismatch is explained in English rather than as a bare provider error, and
# so `terraform plan` surfaces it even when the provider check has been edited out.
check "account_matches_expectation" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == var.aws_account_id
    error_message = "Credentials resolve to account ${data.aws_caller_identity.current.account_id}, but this configuration targets ${var.aws_account_id}. Every account-specific fact in docs/HANDOVER.md §3 was verified against 290304998906 and does not transfer. Re-run infra-aws/scripts/00-discover.sh before proceeding."
  }
}

check "region_matches_expectation" {
  assert {
    condition     = data.aws_region.current.region == var.aws_region
    error_message = "Provider resolved region ${data.aws_region.current.region}, expected ${var.aws_region}. Storage, database and queues must stay in one region; only Bedrock inference routes more widely."
  }
}
