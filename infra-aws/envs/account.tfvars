# Values for infra-aws/account — the ACCOUNT-GLOBAL root module.
#
#   terraform -chdir=infra-aws/account apply -var-file=../envs/account.tfvars
#
# Kept separate from dev.tfvars because nothing here is per-environment. Project Signal's `dev`
# and a future `prod` share one set of cost allocation tags, because there is one set per AWS
# account. Contains no secrets: an account id and a region are identifiers.
#
# The account id is duplicated between this file and dev.tfvars. That is accepted rather than
# solved: Terraform root modules cannot share variable values without a wrapper, and every one
# of the three root modules independently pins `allowed_account_ids`, so a drifted value fails
# closed — the provider aborts before the first API call rather than provisioning somewhere
# unexpected.

# Verified live 2026-08-07 (docs/HANDOVER.md §3.1), re-confirmed by the owner.
aws_account_id = "290304998906"

# Cost Explorer is a GLOBAL service whose endpoint is in us-east-1. eu-west-2 is set here for
# consistency with the rest of the tree. If `terraform apply` fails on endpoint or region
# resolution, change this to "us-east-1" — that is a region change within the SAME account and
# does not touch the sandbox rule, because this module stores no data anywhere.
aws_region = "eu-west-2"

# mandatory_tag_keys is deliberately NOT set here. Its default in account/variables.tf is the
# canonical list of the six keys, single-sourced so it cannot drift from the `default_tags`
# blocks that apply them. Override it only if the convention itself changes — in which case
# infra-aws/bootstrap/versions.tf and infra-aws/stack/versions.tf change in the same commit.
