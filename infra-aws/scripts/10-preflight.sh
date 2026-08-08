#!/usr/bin/env bash
#
# Preflight — run before any apply. READ-ONLY.
#
# Terraform's allowed_account_ids already aborts on the wrong account, but it does so after you
# have typed `apply`, and it cannot see the two things that silently break this phase:
#
#   1. Whether the mandatory tag keys are ACTIVE cost allocation tags. A budget filtered on an
#      inactive tag matches nothing and reports a healthy $0 forever. That is the failure this
#      whole phase exists to prevent, and it is invisible from the budget itself.
#   2. Whether the account-wide budget is still there and untouched. It belongs to whoever runs
#      the sandbox; confirming it is intact is how we prove we added alongside rather than over.
#
# Usage:
#   bash infra-aws/scripts/10-preflight.sh                      # uses AWS_PROFILE / default chain
#   AWS_PROFILE=psignal-dev bash infra-aws/scripts/10-preflight.sh

set -uo pipefail

EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-290304998906}"
REGION="${AWS_REGION:-eu-west-2}"
PROJECT_TAG="${PROJECT_TAG:-project-signal}"
NAME_PREFIX="${NAME_PREFIX:-psignal-dev}"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
fail=0
warn_count=0

# Tracked across sections so the summary can distinguish the two states that look identical in
# isolation: "tags not active yet, nothing exists" (expected before the first apply) from "tags
# not active and resources already exist" (spend is being incurred unattributed — a real fault).
project_tag_active=0
tagged_resource_count=0

hr() { printf '\n== %s\n' "$1"; }
ok()   { printf '  %sPASS%s  %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %sWARN%s  %s\n' "$YELLOW" "$RESET" "$1"; warn_count=$((warn_count + 1)); }
bad()  { printf '  %sFAIL%s  %s\n' "$RED" "$RESET" "$1"; fail=1; }

command -v aws >/dev/null 2>&1 || { echo "FATAL: aws CLI not found on PATH."; exit 1; }

# Hard abort before ANY other AWS call if these credentials are not the sandbox. This must be
# the first thing that happens — a read-only call against another account in this enterprise
# organisation is still unauthorised access to it.
# shellcheck source=infra-aws/scripts/_guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/_guard.sh"

hr "1. Identity — which account do these credentials resolve to?"
assert_sandbox_account
ACCOUNT_ID="$EXPECTED_ACCOUNT"
ok "Account is the sandbox $EXPECTED_ACCOUNT; every fact in docs/HANDOVER.md §3 applies."

hr "2. Region"
echo "  Target: $REGION"

hr "3. Cost allocation tags — are the mandatory keys ACTIVE?"
# This is the silent-failure check. An inactive key means the budget's cost filter matches
# nothing. Activation does not backfill, so a key activated late loses attribution for
# everything created before it.
CAT_JSON="$(aws ce list-cost-allocation-tags --status Active --output json 2>&1)"
if echo "$CAT_JSON" | grep -qi 'AccessDenied\|not authorized'; then
  warn "Denied. In an AWS Organization, cost allocation tags are usually managed only from the"
  echo "       management account. Do NOT work around this — ask the platform team to activate"
  echo "       these six keys centrally, once, for every project in the account:"
  echo "         Project, Owner, CostCentre, Environment, ManagedBy, Expires"
  echo "       Then skip applying infra-aws/account/ entirely; it exists only to do this."
  echo "       The budget still deploys — but it reports \$0 until they are Active."
else
  for key in Project Owner CostCentre Environment ManagedBy Expires; do
    if echo "$CAT_JSON" | grep -q "\"TagKey\": *\"$key\""; then
      ok "$key is Active."
      [ "$key" = "Project" ] && project_tag_active=1
    else
      warn "$key is NOT active — spend carrying it will not be attributed until it is."
    fi
  done
fi

hr "4. Existing budgets — is the account-wide one intact?"
# docs/HANDOVER.md §3.3: monthly_tesai-dev-sandbox belongs to whoever runs the sandbox.
# We add alongside it. If it has vanished, something outside this project changed.
aws budgets describe-budgets --account-id "$ACCOUNT_ID" \
  --query 'Budgets[].{Name:BudgetName,Limit:BudgetLimit.Amount,Unit:BudgetLimit.Unit}' \
  --output table 2>&1 | sed 's/^/  /'

hr "5. Name collisions — is anything already using our prefix?"
# "Nothing that could collide" is rule 2 of docs/AWS-SETUP.md. Proving it beats assuming it.
echo "  S3 buckets matching ${NAME_PREFIX}:"
aws s3api list-buckets --query "Buckets[?starts_with(Name, '${NAME_PREFIX}')].Name" --output text 2>&1 | sed 's/^/    /'
echo "  Resources already tagged Project=${PROJECT_TAG}:"
TAGGED="$(aws resourcegroupstaggingapi get-resources --region "$REGION" \
  --tag-filters "Key=Project,Values=${PROJECT_TAG}" \
  --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null)"
if [ -z "$TAGGED" ]; then
  echo "    none"
else
  echo "$TAGGED" | tr '\t' '\n' | sed 's/^/    /'
  tagged_resource_count="$(echo "$TAGGED" | tr '\t' '\n' | grep -c .)"
fi

hr "6. The condition this whole phase exists to prevent"
# Tags inactive AND resources already tagged means real spend is being incurred that the budget
# cannot see. The budget will report a healthy $0 while billing accrues, and because cost
# allocation tags do not backfill, that attribution is lost permanently rather than deferred.
if [ "$project_tag_active" = "0" ] && [ "$tagged_resource_count" -gt 0 ]; then
  # WARN, not FAIL. Owner decision 2026-08-08: cost allocation tags are a nice-to-have, not a
  # core requirement, and they are NOT a gate on delivery. Activation is impossible from this
  # linked account anyway (payer-only), so failing here would block every apply indefinitely on
  # something we cannot fix — see docs/AWS-SETUP.md.
  #
  # Attribution is not lost meanwhile: the sandbox has no VPC, RDS, ECS or ECR outside this
  # project, so Cost Explorer's SERVICE grouping attributes all of it to us without tags. Only
  # S3, SQS, Secrets Manager and Bedrock are shared with the co-tenant workload.
  warn "The Project tag is INACTIVE but $tagged_resource_count resource(s) already carry it."
  echo "       The budget will report \$0 regardless of spend until the keys are Active, which"
  echo "       only the payer account can do. Track spend by SERVICE in Cost Explorer meanwhile:"
  echo "         aws ce get-cost-and-usage --granularity MONTHLY --metrics UnblendedCost \\"
  echo "           --group-by Type=DIMENSION,Key=SERVICE --time-period Start=<d>,End=<d>"
elif [ "$project_tag_active" = "0" ]; then
  warn "Project tag not yet active, but nothing carries it either — expected before the first apply."
  echo "       Activate it by applying infra-aws/account/ (ACCOUNT-GLOBAL — read its header first,"
  echo "       and tell the sandbox's other tenants), or have the platform team do it. Then"
  echo "       re-run this script to confirm before applying the stack."
else
  ok "Project tag is active, so anything tagged from now on is attributable."
fi

hr "Result"
if [ "$fail" != "0" ]; then
  printf '  %sPreflight FAILED.%s Do not apply — fix the FAIL above first.\n' "$RED" "$RESET"
elif [ "$warn_count" -gt 0 ]; then
  printf '  %sPreflight passed with %d warning(s).%s Read them before applying.\n' "$YELLOW" "$warn_count" "$RESET"
else
  printf '  %sPreflight passed clean.%s Safe to apply.\n' "$GREEN" "$RESET"
fi
exit "$fail"
