#!/usr/bin/env bash
#
# Account guard — sourced by every script in this directory that talks to AWS.
#
# This exists because "only ever touch the sandbox" is a rule, and a rule that depends on
# somebody remembering is not a control. Sourcing this turns it into a mechanism: any script
# that forgets to call assert_sandbox_account simply does not get past its first AWS call
# without the operator noticing, and any script that does call it cannot proceed in the wrong
# account at all.
#
# The repository lives in a TES enterprise organisation under active scrutiny. A read-only call
# against a sibling or production account is still unauthorised access to that account, so this
# guard aborts BEFORE any command runs rather than checking afterwards.
#
# Usage, at the top of a script:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/_guard.sh"
#   assert_sandbox_account
#
# Override only for a genuinely different sandbox, never to reach production:
#   EXPECTED_ACCOUNT=<12 digits> bash infra-aws/scripts/<script>.sh

set -uo pipefail

# docs/HANDOVER.md §3.1, confirmed by the owner 2026-08-07.
EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-290304998906}"
EXPECTED_REGION="${EXPECTED_REGION:-eu-west-2}"

assert_sandbox_account() {
  local red green yellow reset account_id caller_arn
  red=$'\033[31m'; green=$'\033[32m'; yellow=$'\033[33m'; reset=$'\033[0m'

  command -v aws >/dev/null 2>&1 || {
    printf '%sFATAL%s aws CLI not found on PATH.\n' "$red" "$reset" >&2
    exit 1
  }

  account_id="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"
  caller_arn="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)"

  if [ -z "$account_id" ]; then
    printf '%sFATAL%s Could not resolve caller identity — no valid credentials.\n' "$red" "$reset" >&2
    printf '      Authenticate first:  aws sso login --profile "$AWS_PROFILE"\n' >&2
    exit 1
  fi

  if [ "$account_id" != "$EXPECTED_ACCOUNT" ]; then
    printf '\n%s' "$red" >&2
    printf '  ================================================================\n' >&2
    printf '   ABORT — WRONG AWS ACCOUNT\n' >&2
    printf '  ================================================================\n' >&2
    printf '%s' "$reset" >&2
    printf '   Credentials resolve to : %s\n' "$account_id" >&2
    printf '   This script permits    : %s (tesai-dev-sandbox)\n' "$EXPECTED_ACCOUNT" >&2
    printf '   Caller ARN             : %s\n\n' "${caller_arn:-<unknown>}" >&2
    printf '   This repository is in a TES enterprise organisation under active\n' >&2
    printf '   scrutiny. Nothing here may run against any other account — a\n' >&2
    printf '   read-only call is still unauthorised access.\n\n' >&2
    printf '   Nothing has been run. Fix your profile, do not override this guard.\n\n' >&2
    exit 1
  fi

  printf '  %sACCOUNT OK%s  %s (%s)\n' "$green" "$reset" "$account_id" "${caller_arn:-unknown}"

  # Region is a WARNING, never an abort. Being in the wrong region is not a rule breach — the
  # sandbox rule is about accounts — but it is how resources end up scattered across regions in
  # an account somebody else has to audit, and it is invisible until you go looking for them.
  #
  # Not fatal, because there are legitimate exceptions: Cost Explorer is a global service
  # reached via us-east-1 (see infra-aws/account/main.tf). Storage, database and queues always
  # stay in eu-west-2.
  local active_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
  if [ -n "$active_region" ] && [ "$active_region" != "$EXPECTED_REGION" ]; then
    printf '  %sREGION    %s  AWS_REGION is %s, expected %s. Resources would be created there.\n' \
      "$yellow" "$reset" "$active_region" "$EXPECTED_REGION" >&2
  fi
}
