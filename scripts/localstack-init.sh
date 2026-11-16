#!/usr/bin/env bash
#
# Runs once inside the LocalStack container when it reports ready. Creates the bucket and the
# three queues the pipeline expects, so `yarn dev` produces a working stack with no manual step —
# the same intent as migrations applying on API startup.
#
# Names mirror the deployed ones with a `psignal-local-` prefix. The account id in a LocalStack
# queue URL is always 000000000000, which is why .env.example can hardcode the URLs here and
# nowhere else.
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-eu-west-2}"

awslocal s3api create-bucket \
  --bucket psignal-local-raw \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" 2>/dev/null || true

# Dead-letter queues first: the redrive policy on the main queues references them by ARN.
# 'scan' carries on-demand/scheduled collect requests (API publishes, ingestion consumes);
# it was added to the queue union in libs/messaging while this script still created only
# item and report — ingestion crashed on start with `SCAN_QUEUE_URL must be set` until the
# drift was closed. See libs/config/src/index.ts for the authority on env names.
for q in item report scan; do
  awslocal sqs create-queue --queue-name "psignal-local-${q}-dlq" --region "$REGION" >/dev/null
  DLQ_ARN="$(awslocal sqs get-queue-attributes \
      --queue-url "http://localhost:4566/000000000000/psignal-local-${q}-dlq" \
      --attribute-names QueueArn --region "$REGION" \
      --query 'Attributes.QueueArn' --output text)"

  # maxReceiveCount 5 matches the deployed policy, so the local stack fails the same way the
  # real one does. A worker that acks everything would never exercise this — see KNOWN-GAPS #9.
  awslocal sqs create-queue \
    --queue-name "psignal-local-${q}" \
    --region "$REGION" \
    --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\",\"VisibilityTimeout\":\"60\"}" >/dev/null
done

echo "LocalStack ready: bucket psignal-local-raw, queues psignal-local-{item,report,scan}(+dlq)"
