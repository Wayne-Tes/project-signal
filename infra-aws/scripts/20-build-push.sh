#!/usr/bin/env bash
#
# Build and push the four service images to ECR. The step between "main is green" and
# `terraform apply -var="image_tag=..."`.
#
# It exists because this was done by hand twice, from memory, and the hand version is not
# reproducible: the web image bakes three NEXT_PUBLIC_* values into the client bundle at BUILD
# time, so getting them wrong produces an image that builds, pushes, deploys and runs, and is
# simply pointed at the wrong Cognito pool or API origin. Nothing fails; users cannot sign in.
# Those values are read from Terraform outputs here rather than typed, so the bundle can only
# ever be built against the stack it is being deployed to.
#
# Usage:
#   AWS_PROFILE=psignal-dev bash infra-aws/scripts/20-build-push.sh
#   AWS_PROFILE=psignal-dev bash infra-aws/scripts/20-build-push.sh --tag ef93031
#
# Then, and only then:
#   terraform -chdir=infra-aws/stack apply \
#     -var-file=../envs/dev.tfvars -var-file=../envs/dev.stack.tfvars \
#     -var="image_tag=<tag>"

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REGION="${AWS_REGION:-eu-west-2}"
NAME_PREFIX="${NAME_PREFIX:-psignal-dev}"
SERVICES=(api web ingestion sentiment-worker)

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
ok()   { printf '  %sPASS%s  %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %sWARN%s  %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '\n  %sFATAL%s  %s\n\n' "$RED" "$RESET" "$1" >&2; exit 1; }
hr()   { printf '\n== %s\n' "$1"; }

TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# Hard abort before ANY AWS call if these credentials are not the sandbox.
# shellcheck source=infra-aws/scripts/_guard.sh
source "$(dirname "${BASH_SOURCE[0]}")/_guard.sh"

hr "Account"
assert_sandbox_account

hr "Source tree"
command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
docker info >/dev/null 2>&1 || die "docker daemon is not running."
ok "docker $(docker version --format '{{.Server.Version}}')"

# A tag names a commit, so the tree must BE that commit. Pushing a dirty tree produces an image
# labelled with a sha whose source nobody can ever recover — and ECR is IMMUTABLE, so the wrong
# content is welded to that name permanently.
if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  if [ "${ALLOW_DIRTY:-0}" = "1" ]; then
    warn "working tree is dirty and ALLOW_DIRTY=1 — the image will not match its tag"
  else
    git -C "$REPO_ROOT" status --short >&2
    die "working tree is dirty. Commit or stash first, or set ALLOW_DIRTY=1 knowing the tag will lie."
  fi
fi
[ -n "$TAG" ] || TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
ok "tag ${TAG} ($(git -C "$REPO_ROOT" log -1 --format=%s | cut -c1-60))"

hr "Stack outputs (baked into the web bundle)"
tf_out() {
  terraform -chdir="${REPO_ROOT}/infra-aws/stack" output -raw "$1" 2>/dev/null
}
COGNITO_POOL="$(tf_out cognito_user_pool_id)"
COGNITO_CLIENT="$(tf_out cognito_client_id)"
API_URL="$(tf_out alb_dns_name)"
REGISTRY="$(aws sts get-caller-identity --query Account --output text).dkr.ecr.${REGION}.amazonaws.com"

for pair in "cognito_user_pool_id=$COGNITO_POOL" "cognito_client_id=$COGNITO_CLIENT" "alb_dns_name=$API_URL"; do
  [ -n "${pair#*=}" ] || die "terraform output ${pair%%=*} is empty. Has the stack been applied, and is infra-aws/stack initialised?"
done
ok "user pool ${COGNITO_POOL}"
ok "client    ${COGNITO_CLIENT}"
ok "api url   ${API_URL}"

# IMMUTABLE repositories reject a re-push, but they reject it four images and several minutes in.
# Checking first turns that into an instant, comprehensible refusal.
hr "Tag availability"
for svc in "${SERVICES[@]}"; do
  if aws ecr describe-images --repository-name "${NAME_PREFIX}/${svc}" --image-ids "imageTag=${TAG}" \
       --region "$REGION" >/dev/null 2>&1; then
    die "${NAME_PREFIX}/${svc}:${TAG} already exists. ECR is IMMUTABLE — commit the change and build its own sha."
  fi
done
ok "${TAG} is free in all ${#SERVICES[@]} repositories"

hr "Registry login"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null 2>&1 \
  || die "docker login to ${REGISTRY} failed."
ok "$REGISTRY"

for svc in "${SERVICES[@]}"; do
  hr "Build ${svc}"
  image="${REGISTRY}/${NAME_PREFIX}/${svc}:${TAG}"

  build_args=()
  if [ "$svc" = "web" ]; then
    build_args=(
      --build-arg "NEXT_PUBLIC_COGNITO_USER_POOL_ID=${COGNITO_POOL}"
      --build-arg "NEXT_PUBLIC_COGNITO_CLIENT_ID=${COGNITO_CLIENT}"
      --build-arg "NEXT_PUBLIC_API_URL=${API_URL}"
    )
  fi

  # linux/amd64 explicitly: Fargate runs amd64, and a silent arm64 build on an Apple or ARM
  # Windows host produces an image that pushes cleanly and then fails at task start with
  # "exec format error" — a runtime failure three layers from its cause.
  docker build \
    --platform linux/amd64 \
    -f "${REPO_ROOT}/apps/${svc}/Dockerfile" \
    -t "$image" \
    "${build_args[@]}" \
    "$REPO_ROOT" || die "docker build failed for ${svc}."
  ok "built ${svc}"

  docker push "$image" >/dev/null || die "docker push failed for ${svc}."
  ok "pushed ${image}"
done

hr "Done"
printf '  All %d images pushed at tag %s.\n\n' "${#SERVICES[@]}" "$TAG"
printf '  Next — read the plan in full before applying:\n\n'
printf '    terraform -chdir=infra-aws/stack apply \\n'
printf '      -var-file=../envs/dev.tfvars -var-file=../envs/dev.stack.tfvars \\n'
printf '      -var="image_tag=%s"\n\n' "$TAG"
