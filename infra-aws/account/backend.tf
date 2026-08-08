# Backend config is supplied at `terraform init` time, matching bootstrap/ and stack/.
#
#   terraform -chdir=infra-aws/account init \
#     -backend-config="bucket=psignal-dev-tfstate-<account-id>" \
#     -backend-config="key=account/terraform.tfstate" \
#     -backend-config="region=eu-west-2" \
#     -backend-config="use_lockfile=true"
#
# NOTE THE STATE KEY: `account/`, deliberately NOT `env/<environment>/`. This module has no
# environment — there is one set of cost allocation tags per AWS account, not one per dev/prod.
# Keying it alongside the project environments would imply a per-environment lifecycle that
# does not exist and would invite a second copy.
#
# ON THE BUCKET: this state currently lives in Project Signal's state bucket because that is the
# only bucket in the account. That is pragmatic, not principled — the module's CONTENTS belong
# to the account, not to this project. If a platform-team-owned bucket ever exists, migrate this
# state into it (`terraform init -migrate-state`) and leave the project buckets to projects.
terraform {
  backend "s3" {}
}
