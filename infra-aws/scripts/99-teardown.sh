#!/usr/bin/env bash
#
# Teardown — reverse everything this project created, and PROVE the account is clean.
#
# Rule 5 of docs/AWS-SETUP.md: teardown is written before build-up. In a shared enterprise
# account the expensive failure is not a broken deploy, it is leaving something behind that
# somebody else has to explain.
#
# The valuable half of this script is not `terraform destroy` — it is step 3, which inventories
# the account INDEPENDENTLY of Terraform state, by tag. Anything Terraform lost track of (a
# resource created by a failed apply, or one whose state was discarded) is invisible to destroy
# and visible here. That is the whole point.
#
# DRY RUN BY DEFAULT. Nothing is deleted without --execute.
#
# Usage:
#   bash infra-aws/scripts/99-teardown.sh                          # show what would go
#   bash infra-aws/scripts/99-teardown.sh --execute                # destroy the stack
#   bash infra-aws/scripts/99-teardown.sh --execute --include-state-bucket
#
# The state bucket is excluded by default and guarded by prevent_destroy in Terraform, because
# destroying state before the resources it tracks is how you strand things permanently.

set -uo pipefail

EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-290304998906}"
REGION="${AWS_REGION:-eu-west-2}"
PROJECT_TAG="${PROJECT_TAG:-project-signal}"
NAME_PREFIX="${NAME_PREFIX:-psignal-dev}"
ENV_FILE="${ENV_FILE:-../envs/dev.tfvars}"
STACK_VARS="${STACK_VARS:-../envs/dev.stack.tfvars}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

EXECUTE=0
INCLUDE_STATE_BUCKET=0
for arg in "$@"; do
  case "$arg" in
    --execute)              EXECUTE=1 ;;
    --include-state-bucket) INCLUDE_STATE_BUCKET=1 ;;
    *) echo "Unknown argument: $arg"; exit 2 ;;
  esac
done

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
hr() { printf '\n== %s\n' "$1"; }

command -v aws >/dev/null 2>&1       || { echo "FATAL: aws CLI not found on PATH."; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo "FATAL: terraform not found on PATH."; exit 1; }

# The guard matters more here than anywhere else in the repo: this is the only script that
# deletes things. Wrong account plus --execute is the worst outcome available, so the abort
# happens before a single API call.
# shellcheck source=infra-aws/scripts/_guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/_guard.sh"

hr "1. Account guard"
assert_sandbox_account
ACCOUNT_ID="$EXPECTED_ACCOUNT"

if [ "$EXECUTE" = "0" ]; then
  printf '\n  %sDRY RUN.%s Nothing will be deleted. Re-run with --execute to act.\n' "$YELLOW" "$RESET"
fi

hr "2. What Terraform believes it manages"
if [ "$EXECUTE" = "1" ]; then
  ( cd "$REPO_ROOT/infra-aws/stack" \
    && terraform destroy -auto-approve -var-file="$ENV_FILE" -var-file="$STACK_VARS" )
  echo "  terraform destroy exit: $?"
else
  ( cd "$REPO_ROOT/infra-aws/stack" \
    && terraform plan -destroy -var-file="$ENV_FILE" -var-file="$STACK_VARS" 2>&1 | tail -n 30 )
fi

hr "3. INDEPENDENT inventory — what actually carries our tag, whatever Terraform thinks"
# Deliberately not derived from Terraform state. A resource orphaned by a failed apply is
# exactly what this catches, and it is the only check here that can find one.
echo "  Tagged Project=${PROJECT_TAG} in ${REGION}:"
REMAINING="$(aws resourcegroupstaggingapi get-resources --region "$REGION" \
  --tag-filters "Key=Project,Values=${PROJECT_TAG}" \
  --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null)"
if [ -z "$REMAINING" ]; then
  printf '    %snone%s\n' "$GREEN" "$RESET"
else
  echo "$REMAINING" | tr '\t' '\n' | sed 's/^/    /'
fi

# Budgets are not returned by the Resource Groups Tagging API, so they need their own check.
# A budget left behind is harmless financially but is still litter in a shared account.
echo "  Budgets named ${NAME_PREFIX}-*:"
aws budgets describe-budgets --account-id "$ACCOUNT_ID" \
  --query "Budgets[?starts_with(BudgetName, '${NAME_PREFIX}')].BudgetName" \
  --output text 2>/dev/null | tr '\t' '\n' | sed 's/^/    /'

echo "  S3 buckets named ${NAME_PREFIX}-*:"
aws s3api list-buckets --query "Buckets[?starts_with(Name, '${NAME_PREFIX}')].Name" \
  --output text 2>/dev/null | tr '\t' '\n' | sed 's/^/    /'

hr "4. State bucket"
if [ "$INCLUDE_STATE_BUCKET" = "1" ] && [ "$EXECUTE" = "1" ]; then
  echo "  Removing the state bucket. This is irreversible and leaves nothing to manage the"
  echo "  stack with — only correct once step 3 above reports nothing remaining."
  STATE_BUCKET="$(cd "$REPO_ROOT/infra-aws/bootstrap" && terraform output -raw state_bucket_name 2>/dev/null)"
  if [ -n "$STATE_BUCKET" ]; then
    # prevent_destroy in main.tf blocks `terraform destroy`, deliberately. Removing the bucket
    # is therefore an explicit two-step, which is the intended friction.
    echo "  Bucket: $STATE_BUCKET"
    echo "  Edit infra-aws/bootstrap/main.tf to drop prevent_destroy, then:"
    echo "    aws s3 rm s3://$STATE_BUCKET --recursive"
    echo "    terraform -chdir=infra-aws/bootstrap destroy -var-file=../envs/dev.tfvars"
  else
    echo "  Could not read state_bucket_name from bootstrap outputs."
  fi
else
  echo "  Skipped (default). Pass --execute --include-state-bucket to see the removal steps."
fi

hr "Done"
if [ "$EXECUTE" = "0" ]; then
  echo "  Dry run only. Nothing was changed."
else
  echo "  Re-run WITHOUT --execute to confirm step 3 reports nothing remaining."
fi
