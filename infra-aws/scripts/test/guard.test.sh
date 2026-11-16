#!/usr/bin/env bash
#
# Tests for _guard.sh — the control the entire sandbox rule rests on.
#
# WHY THIS FILE EXISTS. Until 2026-08-08, DEVRULES.md, docs/HANDOVER.md and
# infra-aws/CONVENTIONS.md all stated that the guard's "wrong-account and no-credential aborts
# are both tested". No test existed, and there was no shell test framework in the repository at
# all. The most important control in the tree was asserted to be verified and was not.
#
# That is a worse failure than an untested guard, because a stated test invites everyone
# downstream to stop checking. These tests make the claim true.
#
# HERMETIC BY CONSTRUCTION. Every case runs against a STUB `aws` placed first on PATH, so no
# real AWS API call is made, no credentials are needed, and the wrong-account path can be
# exercised without ever holding credentials for another account — which we must never do.
# That last point is the whole reason for stubbing rather than integration-testing: the failure
# mode under test is "credentials resolve somewhere they should not", and the only safe way to
# produce it is to fake it.
#
#   bash infra-aws/scripts/test/guard.test.sh

set -uo pipefail

GUARD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/_guard.sh"
[ -f "$GUARD" ] || { echo "FATAL: cannot find _guard.sh at $GUARD"; exit 1; }

STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

pass=0
fail=0

# Writes a stub `aws` that reports the given account id and never contacts AWS.
# An empty account id simulates unresolvable credentials (the CLI exits non-zero, printing
# nothing on stdout), which is exactly what an expired SSO session looks like.
#
# Optional second argument: the region `aws configure get region` reports (the active profile's
# configured region). Optional third argument "fail-noisy": the identity call exits non-zero but
# still prints text on stdout — a CLI wrapper or proxy that reports errors on the wrong stream.
make_stub() {
  local account="$1" profile_region="${2:-}" mode="${3:-}"
  {
    echo '#!/usr/bin/env bash'
    echo "# STUB. Never contacts AWS. Reports account '${account:-<none>}'."
    echo 'case "$*" in'
    echo "  *'configure get region'*) [ -n '$profile_region' ] && echo '$profile_region'; exit 0 ;;"
    echo 'esac'
    if [ "$mode" = "fail-noisy" ]; then
      echo "echo '$account	arn:aws:sts::$account:assumed-role/stub/tester'; exit 255"
    elif [ -z "$account" ]; then
      echo 'echo "Unable to locate credentials" >&2; exit 255'
    else
      echo 'case "$*" in'
      echo "  *'--query [Account,Arn]'*) printf '%s\t%s\n' '$account' 'arn:aws:sts::$account:assumed-role/stub/tester' ;;"
      echo "  *) echo 'stub-response' ;;"
      echo 'esac'
    fi
  } > "$STUB_DIR/aws"
  chmod +x "$STUB_DIR/aws"
}

# Runs assert_sandbox_account in a subshell with the stub first on PATH, capturing combined
# output and exit status. A subshell is required because the guard aborts with `exit`.
#
# HERMETIC ENVIRONMENT. The variables the guard reads are cleared unless a case sets them, so an
# operator's own `export EXPECTED_ACCOUNT=...` or `AWS_REGION=...` cannot change the result —
# before 2026-11-16 an inherited value silently altered cases 1-4.
run_guard() {
  env -u EXPECTED_ACCOUNT -u EXPECTED_REGION -u AWS_REGION -u AWS_DEFAULT_REGION -u AWS_PROFILE \
    ${T_EXPECTED_ACCOUNT+EXPECTED_ACCOUNT="$T_EXPECTED_ACCOUNT"} \
    ${T_AWS_REGION+AWS_REGION="$T_AWS_REGION"} \
    PATH="$STUB_DIR:$PATH" bash -c 'source "$0"; assert_sandbox_account' "$GUARD" 2>&1
}

check() {
  local name="$1" expected_status="$2" expected_text="$3" output status
  output="$(run_guard)"
  status=$?

  if [ "$status" != "$expected_status" ]; then
    printf '  FAIL  %s\n        expected exit %s, got %s\n' "$name" "$expected_status" "$status"
    fail=$((fail + 1))
    return
  fi
  if [ -n "$expected_text" ] && ! printf '%s' "$output" | grep -q "$expected_text"; then
    printf '  FAIL  %s\n        expected output to contain: %s\n        got: %s\n' \
      "$name" "$expected_text" "$output"
    fail=$((fail + 1))
    return
  fi
  printf '  PASS  %s\n' "$name"
  pass=$((pass + 1))
}

echo "== _guard.sh"

# 1. The sandbox. Must succeed, or the guard blocks all legitimate work.
make_stub "290304998906"
check "accepts the sandbox account 290304998906" 0 "ACCOUNT OK"

# 2. The case the rule exists for. A sibling or production account in the TES organisation must
#    abort before any command runs — read-only calls included.
make_stub "111122223333"
check "aborts on a different account" 1 "WRONG AWS ACCOUNT"

# 3. The abort must name the offending account, or the operator cannot tell what happened.
make_stub "111122223333"
check "names the resolved account in the abort" 1 "111122223333"

# 4. An expired SSO session resolves no identity. Aborting is the only safe response: proceeding
#    would run against whatever the default chain finds next.
make_stub ""
check "aborts when credentials cannot be resolved" 1 "no valid credentials"

# 5. The documented override, for a genuinely different sandbox the operator legitimately holds.
#    It must work, or people will edit the guard instead — which is far worse.
make_stub "111122223333"
T_EXPECTED_ACCOUNT="111122223333" check "honours the EXPECTED_ACCOUNT override" 0 "ACCOUNT OK"

# 6. ...but never silently: a stale export must be visible on every run.
make_stub "111122223333"
T_EXPECTED_ACCOUNT="111122223333" check "warns loudly whenever the override is active" 0 "OVERRIDE ACTIVE"

# 7. The override must not be a blanket bypass: naming one account must still reject another.
make_stub "999988887777"
T_EXPECTED_ACCOUNT="111122223333" check "override still rejects a non-matching account" 1 "WRONG AWS ACCOUNT"

# 8. A malformed override is refused before any AWS call — a typo must never become the value a
#    real account id is compared against.
make_stub "290304998906"
T_EXPECTED_ACCOUNT="29030499890" check "refuses an override that is not 12 digits" 1 "not a 12-digit"

# 8b. An EMPTY override is not an override: `${EXPECTED_ACCOUNT:-...}` falls back to the sandbox,
#     which is the safe direction. It must pass, and must not claim an override is active.
make_stub "290304998906"
output="$(T_EXPECTED_ACCOUNT="" run_guard)"; status=$?
if [ "$status" -eq 0 ] && ! printf '%s' "$output" | grep -q "OVERRIDE ACTIVE"; then
  printf '  PASS  an empty override falls back to the sandbox\n'; pass=$((pass + 1))
else
  printf '  FAIL  an empty override falls back to the sandbox (exit %s)\n        got: %s\n' "$status" "$output"
  fail=$((fail + 1))
fi

# 9. The CLI's EXIT STATUS decides. A failing CLI that still prints the sandbox id on stdout must
#    be treated as no credentials, not as success.
make_stub "290304998906" "" "fail-noisy"
check "aborts when the CLI fails even if it printed an account id" 1 "no valid credentials"

# 10. An inherited EXPECTED_ACCOUNT in the operator's shell must not leak into the cases above.
#     run_guard clears it; this proves the clearing works.
make_stub "290304998906"
output="$(EXPECTED_ACCOUNT="111122223333" run_guard)"; status=$?
if [ "$status" -eq 0 ] && ! printf '%s' "$output" | grep -q "OVERRIDE ACTIVE"; then
  printf '  PASS  an inherited EXPECTED_ACCOUNT does not affect the tests\n'; pass=$((pass + 1))
else
  printf '  FAIL  an inherited EXPECTED_ACCOUNT leaked into the guard (exit %s)\n        got: %s\n' "$status" "$output"
  fail=$((fail + 1))
fi

# 11. Region is a warning, never an abort — Cost Explorer is global and reached via us-east-1,
#     so a hard failure here would block infra-aws/account legitimately.
make_stub "290304998906"
T_AWS_REGION="us-east-1" check "warns but does not abort on an unexpected AWS_REGION" 0 "REGION"

# 12. The profile's configured region counts too — the normal way an SSO profile sets region.
make_stub "290304998906" "us-east-1"
check "warns on an unexpected PROFILE region when AWS_REGION is unset" 0 "profile 'default' region is us-east-1"

# 13. The expected region must stay silent, from either source, or the warning becomes noise
#     people learn to ignore.
for case_name in env profile; do
  if [ "$case_name" = env ]; then
    make_stub "290304998906"; output="$(T_AWS_REGION="eu-west-2" run_guard)"
  else
    make_stub "290304998906" "eu-west-2"; output="$(run_guard)"
  fi
  if printf '%s' "$output" | grep -q "REGION"; then
    printf '  FAIL  no region warning for eu-west-2 (%s)\n        got: %s\n' "$case_name" "$output"
    fail=$((fail + 1))
  else
    printf '  PASS  no region warning for eu-west-2 (%s)\n' "$case_name"
    pass=$((pass + 1))
  fi
done

printf '\n  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
