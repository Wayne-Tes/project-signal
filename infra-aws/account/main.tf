# Account-global settings for the shared sandbox 290304998906.
#
# ─────────────────────────────────────────────────────────────────────────────────────────────
# READ THIS BEFORE APPLYING. Nothing in this module belongs to Project Signal.
# ─────────────────────────────────────────────────────────────────────────────────────────────
#
# Everything here is ACCOUNT-WIDE and therefore SHARED WITH EVERY OTHER PROJECT in the sandbox.
# It lives in its own root module, with its own state, for one reason: so that no project's
# lifecycle can reach it.
#
# WHY THIS MODULE EXISTS — the defect it fixes:
#
#   `aws_ce_cost_allocation_tag` used to live in `infra-aws/stack/budget.tf`, alongside Project
#   Signal's budget. Cost allocation tag activation is not project-scoped — it is one global
#   switch per tag key for the whole account. Three consequences followed, none of them
#   intended, all of them discovered by reading rather than by an outage:
#
#     1. `terraform destroy` on the stack — which is what `scripts/99-teardown.sh --execute`
#        runs — would have set all six keys to Inactive FOR EVERY PROJECT IN THE ACCOUNT.
#        Tearing down Project Signal would have silently broken cost attribution for co-tenant
#        workloads that have nothing to do with it.
#
#     2. Because activation does NOT backfill, that damage is permanent rather than deferred.
#        Re-activating restores attribution from that moment forward; the spend incurred while
#        the keys were inactive is unattributable for good.
#
#     3. CONVENTIONS.md §7 tells the next repository to copy `stack/`. Two projects copying it
#        would give two Terraform states ownership of the same six global resources, and they
#        would fight — each apply reverting the other's view of reality.
#
# THE RULE THIS ENCODES: a resource that is account-global does not belong in a project-scoped
# state file. If you add anything else here, it must clear the same bar — and CONVENTIONS.md §7
# must tell other repos to REFERENCE this module, never to copy it.
#
# WHO APPLIES IT: the account owner or the platform team, once, deliberately, with the other
# tenants of the sandbox aware that it is happening. Not as part of any project's deploy, and
# never from CI.
#
#   terraform -chdir=infra-aws/account init -backend-config=...   # see backend.tf
#   terraform -chdir=infra-aws/account apply -var-file=../envs/account.tfvars

data "aws_caller_identity" "current" {}

# The provider's allowed_account_ids is the blocking guard. This makes the target account
# visible in plan output and explains a mismatch in English, matching stack/guard.tf.
check "account_matches_expectation" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == var.aws_account_id
    error_message = "Credentials resolve to account ${data.aws_caller_identity.current.account_id}, but this configuration targets ${var.aws_account_id}. This module changes ACCOUNT-WIDE billing configuration — applying it to the wrong account reconfigures somebody else's cost attribution. Stop and check your profile."
  }
}

# --- Cost allocation tag activation ------------------------------------------------------
#
# Until a tag key is ACTIVE, Cost Explorer and Budgets cannot see it. A budget filtered on an
# inactive key matches nothing and reports a perfectly healthy $0 while spend accrues. That
# failure is completely silent, which is why it is worth a managed resource rather than a line
# in a runbook — and why `scripts/10-preflight.sh` §3 checks the status independently.
#
# Activation applies FORWARD ONLY. It does not backfill. Doing this before the first billable
# resource is therefore not tidiness — it is the only moment it can be done without permanently
# losing attribution for whatever is created in between.
#
# THIS MAY BE DENIED, AND THAT IS A NORMAL OUTCOME. In an AWS Organization,
# `ce:UpdateCostAllocationTagsStatus` is usually reserved to the management account. If the
# apply fails with AccessDenied, do not work around it: ask the platform team to activate these
# six keys centrally — once, for every project in the account. The stack's budget deploys
# regardless; it simply cannot attribute anything until the keys are Active.
#
# REGION NOTE, UNVERIFIED AT TIME OF WRITING: Cost Explorer is a global service whose endpoint
# lives in us-east-1. This module uses var.aws_region (eu-west-2) for consistency with the rest
# of the tree. If the apply fails with an endpoint or region resolution error, set
# `aws_region = "us-east-1"` in envs/account.tfvars. That is a REGION change only — the account
# is unchanged and the sandbox rule is untouched, since no data is stored by this module.
resource "aws_ce_cost_allocation_tag" "mandatory" {
  for_each = toset(var.mandatory_tag_keys)

  tag_key = each.value
  status  = "Active"

  # Deactivating a key is an account-wide, non-backfilling, cross-project action. It must never
  # happen as a side effect of destroying something — it has to be a deliberate edit to this
  # file, exactly like dropping prevent_destroy on the state bucket in bootstrap/main.tf.
  lifecycle {
    prevent_destroy = true
  }
}
