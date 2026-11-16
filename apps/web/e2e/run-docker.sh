#!/usr/bin/env bash
#
# Runs the e2e suite inside the official Playwright container.
#
# WHY A CONTAINER. The browsers are a ~400MB platform-specific download that
# has to match the @playwright/test version exactly. Pinning the image to the
# same version as the package makes the pairing explicit and identical on a
# developer machine and in CI, and it means the suite runs on this Windows host
# without installing browsers into the user's profile.
#
# The image tag MUST track the @playwright/test version in apps/web/package.json.
# A mismatch fails loudly at startup ("Executable doesn't exist"), which is the
# behaviour we want — a silently-wrong browser build is worse than a hard stop.
#
# TWO TARGETS.
#   Local (default): the web app and API run on the HOST (web 3100, API 9080). The container
#     forwards its own localhost:3100 and :9080 to the host (e2e/port-forward.mjs), because the
#     bundle calls the API at the localhost URL inlined at build time — see that file.
#   Remote: E2E_BASE_URL=http://<alb-dns> drives a deployed environment directly.
#
# Usage:
#   # local, local sign-in (credentials from the root .env — LOCAL_AUTH_PASSWORD)
#   E2E_USERNAME=local-owner E2E_PASSWORD=... bash apps/web/e2e/run-docker.sh [playwright args]
#   # deployed, Cognito
#   E2E_BASE_URL=http://<alb> E2E_EMAIL=... E2E_PASSWORD=... bash apps/web/e2e/run-docker.sh
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.50.0-noble"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:3100}"
: "${E2E_PASSWORD:?E2E_PASSWORD must be set}"
if [ -z "${E2E_USERNAME:-}" ] && [ -z "${E2E_EMAIL:-}" ]; then
  echo "Set E2E_USERNAME (local sign-in) or E2E_EMAIL (Cognito)." >&2
  exit 2
fi

# Ports to forward when the target is local. Override if your API is not on 9080.
FORWARD_PORTS="${E2E_FORWARD_PORTS:-3100 9080}"
case "$E2E_BASE_URL" in
  http://localhost:* | http://127.0.0.1:*) LOCAL_TARGET=1 ;;
  *) LOCAL_TARGET=0 ;;
esac

# Git Bash on Windows rewrites "/repo"-style arguments into Windows paths; this stops it for the
# container-side paths below. Harmless elsewhere.
export MSYS_NO_PATHCONV=1

if [ "$LOCAL_TARGET" = 1 ]; then
  INNER="node e2e/port-forward.mjs ${FORWARD_PORTS} & sleep 1 && npx playwright test $*"
else
  INNER="npx playwright test $*"
fi

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e E2E_BASE_URL="$E2E_BASE_URL" \
  -e E2E_IN_CONTAINER=1 \
  -e E2E_AUTH_MODE \
  -e E2E_USERNAME \
  -e E2E_EMAIL \
  -e E2E_PASSWORD \
  -e CI \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "${REPO_ROOT}:/repo" \
  -w /repo/apps/web \
  "${IMAGE}" \
  bash -c "$INNER"
