# Backend config is supplied at `terraform init` time rather than hard-coded, so the same .tf
# files serve every environment with isolated state — the same pattern as infra/stack/backend.tf
# on the GCP side. `terraform -chdir=infra-aws/bootstrap output backend_config` prints the exact
# command with the bucket name already filled in.
#
#   terraform -chdir=infra-aws/stack init \
#     -backend-config="bucket=psignal-dev-tfstate-<account-id>" \
#     -backend-config="key=env/dev/terraform.tfstate" \
#     -backend-config="region=eu-west-2" \
#     -backend-config="use_lockfile=true"
#
# use_lockfile puts the lock in S3 alongside the state. DynamoDB-based locking is deprecated
# upstream, so there is deliberately no lock table anywhere in this tree.
terraform {
  backend "s3" {}
}
