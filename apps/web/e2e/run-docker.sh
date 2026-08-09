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
# Usage:
#   E2E_BASE_URL=... E2E_EMAIL=... E2E_PASSWORD=... bash apps/web/e2e/run-docker.sh [args]
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.50.0-noble"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

: "${E2E_BASE_URL:?E2E_BASE_URL must be set (e.g. the dev ALB or http://host.docker.internal:3000)}"
: "${E2E_EMAIL:?E2E_EMAIL must be set}"
: "${E2E_PASSWORD:?E2E_PASSWORD must be set}"

# host.docker.internal lets the container reach a `next dev` running on the host.
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e E2E_BASE_URL \
  -e E2E_EMAIL \
  -e E2E_PASSWORD \
  -e CI \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "${REPO_ROOT}:/repo" \
  -w /repo/apps/web \
  "${IMAGE}" \
  npx playwright test "$@"
