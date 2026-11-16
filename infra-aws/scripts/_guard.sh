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
# Override only for a genuinely different sandbox the owner has approved in writing, never to
# reach production. The override must be exactly 12 digits, and it prints a warning on every run
# so a stale export cannot retarget scripts silently:
#   EXPECTED_ACCOUNT=<12 digits> bash infra-aws/scripts/<script>.sh
#
# Terraform does NOT honour this override: every root module validates
# aws_account_id == 290304998906 as a constant (infra-aws/*/variables.tf).

set -uo pipefail

# docs/HANDOVER.md §3.1, confirmed by the owner 2026-08-07.
SANDBOX_ACCOUNT="290304998906"
EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-$SANDBOX_ACCOUNT}"
EXPECTED_REGION="${EXPECTED_REGION:-eu-west-2}"

assert_sandbox_account() {
  local red green yellow reset account_id caller_arn identity status
  red=$'\033[31m'; green=$'\033[32m'; yellow=$'\033[33m'; reset=$'\033[0m'

  # A malformed override is refused outright rather than compared: an EXPECTED_ACCOUNT of "" or
  # "29030499890" (a typo) must never be the value a real account id is checked against.
  if ! printf '%s' "$EXPECTED_ACCOUNT" | grep -Eq '^[0-9]{12}$'; then
    printf '%sFATAL%s EXPECTED_ACCOUNT="%s" is not a 12-digit account id. Nothing has been run.\n' \
      "$red" "$reset" "$EXPECTED_ACCOUNT" >&2
    exit 1
  fi

  # An override is legal (a genuinely different sandbox) but it must never be silent: a stale
  # `export EXPECTED_ACCOUNT=...` in a shell profile would otherwise retarget every script with no
  # visible sign. Printed BEFORE any AWS call, on every run.
  if [ "$EXPECTED_ACCOUNT" != "$SANDBOX_ACCOUNT" ]; then
    printf '\n%s  !! EXPECTED_ACCOUNT OVERRIDE ACTIVE: %s (the sandbox is %s).%s\n' \
      "$yellow" "$EXPECTED_ACCOUNT" "$SANDBOX_ACCOUNT" "$reset" >&2
    printf '     CLAUDE.md permits ONLY the sandbox. Unset EXPECTED_ACCOUNT unless the owner has\n' >&2
    printf '     approved this account in writing.\n\n' >&2
  fi

  command -v aws >/dev/null 2>&1 || {
    printf '%sFATAL%s aws CLI not found on PATH.\n' "$red" "$reset" >&2
    exit 1
  }

  # One call, and its EXIT STATUS decides — not merely whether stdout happened to be empty. A CLI
  # that fails but prints something (a proxy error page, a warning on stdout) must not be read as
  # an account id.
  identity="$(aws sts get-caller-identity --query '[Account,Arn]' --output text 2>/dev/null)"
  status=$?
  if [ "$status" -ne 0 ]; then
    account_id=""
  else
    account_id="$(printf '%s' "$identity" | awk '{print $1}')"
    caller_arn="$(printf '%s' "$identity" | awk '{print $2}')"
  fi

  if [ -z "$account_id" ] || ! printf '%s' "$account_id" | grep -Eq '^[0-9]{12}$'; then
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
    # The alias belongs to 290304998906 and to nothing else. Printing it unconditionally meant
    # that an overridden EXPECTED_ACCOUNT was labelled "tesai-dev-sandbox" in the abort — the
    # message asserted a decoy account WAS the sandbox. This is the text somebody reads while
    # working out what just went wrong, so it must not state something false.
    if [ "$EXPECTED_ACCOUNT" = "$SANDBOX_ACCOUNT" ]; then
      printf '   This script permits    : %s (tesai-dev-sandbox)\n' "$EXPECTED_ACCOUNT" >&2
    else
      printf '   This script permits    : %s (via EXPECTED_ACCOUNT override)\n' "$EXPECTED_ACCOUNT" >&2
    fi
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
  #
  # Resolved the way the CLI resolves it: AWS_REGION, then AWS_DEFAULT_REGION, then the active
  # profile's configured region. Before 2026-11-16 only the two variables were read, so an SSO
  # profile configured for the wrong region — the normal way to set region — was never warned
  # about. `aws configure get` reads local config only; it makes no API call.
  local active_region source_name
  if [ -n "${AWS_REGION:-}" ]; then
    active_region="$AWS_REGION"; source_name="AWS_REGION"
  elif [ -n "${AWS_DEFAULT_REGION:-}" ]; then
    active_region="$AWS_DEFAULT_REGION"; source_name="AWS_DEFAULT_REGION"
  else
    active_region="$(aws configure get region 2>/dev/null || true)"
    source_name="profile '${AWS_PROFILE:-default}' region"
  fi
  if [ -n "$active_region" ] && [ "$active_region" != "$EXPECTED_REGION" ]; then
    printf '  %sREGION    %s  %s is %s, expected %s. Resources would be created there.\n' \
      "$yellow" "$reset" "$source_name" "$active_region" "$EXPECTED_REGION" >&2
  fi
}
