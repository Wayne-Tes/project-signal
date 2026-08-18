#!/usr/bin/env bash
#
# Every top-level API route prefix must be forwarded to the API by the ALB.
#
# WHY THIS FILE EXISTS. This defect has now shipped twice, and both times everything that could
# report a problem reported success. `/assistant*` went live on 2026-08-09 and the in-product
# assistant answered "something went wrong". `/crm*` went live on 2026-08-18: images built, task
# definitions replaced, rollout COMPLETED, all four services healthy, migrations applied — and
# every CRM endpoint returned 404, served by the WEB target group, which has no such route.
#
# Nothing catches it. ECS is correct, Terraform is correct, the API is correct, and the tests are
# correct; the load balancer in front of them simply never learned the route existed. The 404
# reads as a missing handler rather than a missing listener rule, which is why it costs an hour
# each time.
#
# It is a pure text comparison — no AWS call, no credentials, no _guard.sh needed — because both
# sides of the question are in the repository: the routes the API declares, and the paths the ALB
# is told to forward.
#
#   bash infra-aws/scripts/test/alb-routes.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ROUTES_DIR="$ROOT/apps/api/src/routes"
ALB_TF="$ROOT/infra-aws/stack/alb.tf"

RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
fail=0

[ -d "$ROUTES_DIR" ] || { echo "FATAL: no route directory at $ROUTES_DIR"; exit 1; }
[ -f "$ALB_TF" ]     || { echo "FATAL: no alb.tf at $ALB_TF"; exit 1; }

# Top-level prefix of every path string the API registers. Route files declare paths as the first
# argument to fastify.<verb>(, always a single-quoted literal beginning with a slash.
api_prefixes="$(grep -rhoE "^[[:space:]]*'/[a-z0-9][a-z0-9/:_-]*'" "$ROUTES_DIR" \
  | tr -d " '" \
  | sed -E 's|^(/[a-z0-9_-]+).*|\1|' \
  | sort -u)"

[ -n "$api_prefixes" ] || { echo "FATAL: extracted no API prefixes — has the route style changed?"; exit 1; }

# Every value inside every path_pattern block in alb.tf, trailing wildcard stripped.
alb_prefixes="$(grep -oE '"/[a-z0-9][a-z0-9/*_-]*"' "$ALB_TF" \
  | tr -d '"' \
  | sed -E 's|\*$||; s|/$||' \
  | sort -u)"

[ -n "$alb_prefixes" ] || { echo "FATAL: extracted no ALB path patterns — has alb.tf changed shape?"; exit 1; }

printf 'API prefixes : %s\n' "$(echo "$api_prefixes" | tr '\n' ' ')"
printf 'ALB patterns : %s\n\n' "$(echo "$alb_prefixes" | tr '\n' ' ')"

while IFS= read -r prefix; do
  [ -n "$prefix" ] || continue
  if echo "$alb_prefixes" | grep -qxF "$prefix"; then
    printf '  %sPASS%s  %s is forwarded to the API\n' "$GREEN" "$RESET" "$prefix"
  else
    printf '  %sFAIL%s  %s is served by the API but the ALB does not forward it.\n' "$RED" "$RESET" "$prefix"
    printf '        It will return 404 from the WEB target group. Add "%s*" to a\n' "$prefix"
    printf '        path_pattern in infra-aws/stack/alb.tf — mind the five-value cap per rule.\n'
    fail=1
  fi
done <<< "$api_prefixes"

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf '  %sAll API route prefixes are reachable through the load balancer.%s\n\n' "$GREEN" "$RESET"
else
  printf '  %sAt least one API route is unreachable in a deployed environment.%s\n\n' "$RED" "$RESET"
fi
exit "$fail"
