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

hr "0. Tooling"
try aws --version

hr "1. WHO AM I — the answer that governs everything else"
try aws sts get-caller-identity

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"
CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)"
echo "  ACCOUNT_ID = ${ACCOUNT_ID:-<unresolved>}"
echo "  CALLER_ARN = ${CALLER_ARN:-<unresolved>}"
echo
echo "  >> Confirm this is YOUR sandbox account before running anything in Phase 1."
echo "  >> Every later script will hard-code this id and refuse to run against a different one."

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
# Permission boundaries and SCPs are the usual enterprise blockers. The simulator does not
# model SCPs reliably, so treat a PASS here as necessary-but-not-sufficient; §8 is the real test.
if [ -n "${CALLER_ARN:-}" ]; then
  try aws iam simulate-principal-policy \
    --policy-source-arn "$CALLER_ARN" \
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
  PROBE="psignal-discovery-probe-$$"
  echo "  Creating throwaway role '$PROBE', then deleting it. This is the only write in this script."
  try aws iam create-role --role-name "$PROBE" \
      --description "Project Signal discovery probe - safe to delete" \
      --tags Key=project,Value=project-signal Key=purpose,Value=discovery-probe Key=ephemeral,Value=true \
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
