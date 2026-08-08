#!/usr/bin/env bash
#
# Phase 0 — discovery. READ-ONLY.
#
# Creates nothing, changes nothing, costs nothing. Every command below is a describe/list/get.
# The single optional write test is at the end, is clearly fenced, and cleans up after itself —
# you have to pass --test-iam to run it at all.
#
# Purpose: establish exactly which AWS account you are in, what you are permitted to do in it,
# and which services are actually available — BEFORE anything is provisioned. In a scrutinised
# enterprise environment the expensive mistake is building in the wrong place, and that mistake
# is only preventable here, at step zero.
#
# ACCOUNT GUARD. This script is READ-ONLY, and that is NOT a reason to skip the guard.
# Under the sandbox rule a `describe`/`list` against a sibling or production account is still
# unauthorised access to it, so "it only reads" is precisely the reasoning that produces an
# incident. Every one of the ~20 calls below is therefore fenced behind assert_sandbox_account.
#
# This was a real defect: until 2026-08-08 this script did not source the guard at all. It ran
# every call first and only then printed "confirm this is YOUR sandbox account" — asking a human
# to verify the account *after* the traffic had already left. Meanwhile CONVENTIONS.md §0,
# infra-aws/README.md and DEVRULES.md all stated that every AWS-calling script sourced the
# guard. The documentation was right about the intent and wrong about this file.
#
# The chicken-and-egg — "discovery is what tells you which account you are in" — is real but it
# does not survive contact with the rule. The account is known and twice confirmed
# (290304998906, docs/HANDOVER.md §3.1), so discovery is guarded like everything else. To point
# this at a genuinely different sandbox you have legitimate access to, name it explicitly:
#
#   EXPECTED_ACCOUNT=<12 digits> bash infra-aws/scripts/00-discover.sh
#
# Naming the account is the point: it is a deliberate act, recorded in your shell history,
# rather than whatever a stale AWS_PROFILE happened to resolve to.
#
# Usage:
#   bash infra-aws/scripts/00-discover.sh                 # read-only
#   bash infra-aws/scripts/00-discover.sh --test-iam      # adds the reversible IAM probe
#
# Send the whole output back. It contains account IDs and ARNs (identifiers, not credentials).
# It does NOT print access keys, secrets or tokens. Redact the account ID if you prefer — just
# tell me you have, so I don't read its absence as a failed call.

set -uo pipefail

REGION="${AWS_REGION:-eu-west-2}"
TEST_IAM=0
[ "${1:-}" = "--test-iam" ] && TEST_IAM=1

hr() { printf '\n== %s\n' "$1"; }
# Never abort the run on a denied call: an AccessDenied IS the finding.
try() { echo "\$ $*"; "$@" 2>&1 | sed 's/^/  /'; echo; }

command -v aws >/dev/null 2>&1 || { echo "FATAL: aws CLI not found on PATH."; exit 1; }

# Hard abort before the first describe/list. Nothing below this line runs in another account.
# shellcheck source=infra-aws/scripts/_guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/_guard.sh"

hr "0. Account guard"
assert_sandbox_account

hr "0b. Tooling"
try aws --version

hr "1. WHO AM I — the answer that governs everything else"
try aws sts get-caller-identity

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"
CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)"
echo "  ACCOUNT_ID = ${ACCOUNT_ID:-<unresolved>}"
echo "  CALLER_ARN = ${CALLER_ARN:-<unresolved>}"
echo
echo "  >> Already asserted against \$EXPECTED_ACCOUNT by the guard above — this section is the"
echo "  >> full identity record for the report, not the check. The check has passed."

hr "2. Organisation context — am I inside someone else's guardrails?"
# Frequently AccessDenied outside the management account. Denied is a perfectly good answer.
try aws organizations describe-organization
try aws organizations describe-account --account-id "${ACCOUNT_ID:-000000000000}"
try aws organizations list-parents --child-id "${ACCOUNT_ID:-000000000000}"

hr "3. Region availability"
echo "  Target region: $REGION"
try aws ec2 describe-regions --region-names "$REGION" --query 'Regions[0]' --output json

hr "4. Existing footprint in $REGION — is this account really empty?"
# If these come back populated, the account is shared in practice whatever it is called,
# and the plan has to avoid colliding with what is already here.
try aws ec2 describe-vpcs --region "$REGION" --query 'Vpcs[].{Id:VpcId,Cidr:CidrBlock,Default:IsDefault,Tags:Tags}' --output json
try aws ecs list-clusters --region "$REGION"
try aws rds describe-db-instances --region "$REGION" --query 'DBInstances[].DBInstanceIdentifier'
try aws s3api list-buckets --query 'Buckets[].Name'
try aws sqs list-queues --region "$REGION"
try aws cognito-idp list-user-pools --max-results 20 --region "$REGION" --query 'UserPools[].{Id:Id,Name:Name}'
try aws ecr describe-repositories --region "$REGION" --query 'repositories[].repositoryName'

hr "5. IAM — can I create the roles this deployment needs?"
try aws iam list-open-id-connect-providers
try aws iam list-account-aliases
# simulate-principal-policy needs an IAM PRINCIPAL arn — a role or user — not the STS session
# arn that get-caller-identity returns. Under IAM Identity Center the session arn is
#   arn:aws:sts::<acct>:assumed-role/AWSReservedSSO_<permission-set>_<hash>/<email>
# and the API rejects it outright with InvalidInput, so this whole section produced nothing but
# an error every time it was run from an SSO session. Verified against 290304998906 on
# 2026-08-08 — the original Phase 0 run had the same failure and it went unnoticed because the
# script prints errors as findings rather than aborting.
#
# Resolve the underlying role by name instead. get-role is used rather than string surgery
# because the SSO role path — role/aws-reserved/sso.amazonaws.com/<sso-region>/<name> — embeds
# the Identity Center region (eu-west-1 here, NOT the client region), which cannot be
# reconstructed from the session arn.
POLICY_SOURCE_ARN=""
case "${CALLER_ARN:-}" in
  *:assumed-role/*)
    ROLE_NAME="$(printf '%s' "$CALLER_ARN" | cut -d/ -f2)"
    echo "  Resolving IAM role arn for assumed-role session '$ROLE_NAME'"
    POLICY_SOURCE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null)"
    ;;
  *:user/* | *:role/*)
    POLICY_SOURCE_ARN="$CALLER_ARN"
    ;;
esac

# Permission boundaries and SCPs are the usual enterprise blockers, and SCPs are ENABLED in this
# organisation (§2 shows SERVICE_CONTROL_POLICY on o-czz6h8lnm0). The simulator does NOT evaluate
# SCPs, so treat a PASS here as necessary-but-not-sufficient; §8 is the only reliable test.
if [ -n "$POLICY_SOURCE_ARN" ]; then
  try aws iam simulate-principal-policy \
    --policy-source-arn "$POLICY_SOURCE_ARN" \
    --action-names \
        iam:CreateRole \
        iam:AttachRolePolicy \
        iam:CreateOpenIDConnectProvider \
        ec2:CreateVpc \
        ecs:CreateCluster \
        rds:CreateDBInstance \
        s3:CreateBucket \
        sqs:CreateQueue \
        cognito-idp:CreateUserPool \
        ecr:CreateRepository \
        secretsmanager:CreateSecret \
        bedrock:InvokeModel \
    --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision}' \
    --output table
fi

hr "6. Bedrock — which models are ACTUALLY available to this account in $REGION?"
# Do not take a model id from any document, including ours. This list is the only truth,
# and availability moves month to month.
try aws bedrock list-foundation-models --region "$REGION" \
    --query 'modelSummaries[].{Id:modelId,Name:modelName,Provider:providerName}' --output table
echo "  >> Being LISTED is not the same as being ENABLED. Bedrock requires per-model access to"
echo "  >> be granted in the console (Bedrock > Model access), and in an Organization that grant"
echo "  >> is often centrally controlled. The real test is an InvokeModel call, in Phase 1."

hr "7. Cost controls"
try aws budgets describe-budgets --account-id "${ACCOUNT_ID:-000000000000}" --query 'Budgets[].{Name:BudgetName,Limit:BudgetLimit}' --output table
echo "  >> If this is empty we create a budget alarm BEFORE anything billable. ECS Fargate does"
echo "  >> not scale to zero, so idle services bill continuously — unlike the Cloud Run design"
echo "  >> this replaces, where idle cost was genuinely ~nil."

hr "8. OPTIONAL reversible IAM probe"
if [ "$TEST_IAM" = "1" ]; then
  PROBE="psignal-dev-discovery-probe-$$"
  echo "  Creating throwaway role '$PROBE', then deleting it. This is the only write in this script."
  # Tags are the SIX MANDATORY KEYS in PascalCase, exactly as infra-aws/*/versions.tf applies
  # them as provider default_tags. This is the one resource in the repo created outside
  # Terraform, so it is the one place the convention could silently diverge — and it had:
  # until 2026-08-08 this probe used lower-case `project`/`purpose`/`ephemeral`, none of which
  # are mandatory keys. AWS tag keys are case-sensitive, so in a shared account under review
  # that produces a role attributable to nothing, created by the script whose whole job is to
  # prove we can be trusted with the account.
  #
  # `Expires` is today's date: the role is deleted seconds later, and if the delete fails the
  # teardown sweep should treat it as already stale rather than wait a year.
  try aws iam create-role --role-name "$PROBE" \
      --description "Project Signal discovery probe - safe to delete" \
      --tags "Key=Project,Value=project-signal" \
             "Key=Owner,Value=wayne.strydom@tes.com" \
             "Key=CostCentre,Value=tesai-dev-sandbox" \
             "Key=Environment,Value=dev" \
             "Key=ManagedBy,Value=discovery-probe" \
             "Key=Expires,Value=$(date -u +%Y-%m-%d)" \
      --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  echo "  Cleaning up:"
  try aws iam delete-role --role-name "$PROBE"
  echo "  >> If create succeeded AND delete succeeded, role creation is genuinely permitted."
  echo "  >> If create was denied, an SCP or permission boundary is blocking it regardless of §5."
  echo "  >> If create succeeded but delete failed, TELL ME — a stray role must not be left behind."
else
  echo "  Skipped. Re-run with --test-iam to probe role creation for real."
  echo "  The §5 simulator result does not account for SCPs, so this probe is the reliable test."
fi

hr "Done"
echo "Nothing was provisioned. Send the full output back."
