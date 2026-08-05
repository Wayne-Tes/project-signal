# Backend config is supplied at `terraform init` time — not hard-coded here —
# so the same .tf files work for every environment with isolated state:
#
#   terraform init \
#     -backend-config="bucket=<state_bucket_name>" \
#     -backend-config="prefix=env/<environment>"   # e.g. env/staging, env/production
#
# The CI pipeline does this automatically via deploy-staging.yml / deploy-production.yml.
terraform {
  backend "gcs" {}
}
