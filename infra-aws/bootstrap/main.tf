# Bootstrap — creates the remote state backend, and nothing else.
#
# This is the one place that must exist before Terraform can keep state in the account rather
# than on somebody's laptop. It is separate from stack/ for the ordinary chicken-and-egg
# reason, mirroring infra/bootstrap/ on the GCP side.
#
#   terraform -chdir=infra-aws/bootstrap init
#   terraform -chdir=infra-aws/bootstrap apply -var-file=../envs/dev.tfvars
#
# An empty versioned bucket is not meaningfully billable, so this does not violate the
# "cost controls precede spend" rule in docs/AWS-SETUP.md — the budget in stack/ is still
# created before anything that actually costs money (VPC endpoints, RDS, Fargate).

data "aws_caller_identity" "current" {}

locals {
  # S3 bucket names are globally unique across all AWS accounts, so the account id is the
  # standard disambiguator. An account id is an identifier, not a secret.
  state_bucket_name = "${var.project_prefix}-${var.environment}-tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "tfstate" {
  bucket = local.state_bucket_name

  # Losing Terraform state does not lose the resources — it loses the ability to manage or
  # cleanly destroy them, which in a shared account under review is the worse outcome.
  # Removing this guard is a deliberate two-step, exactly as intended.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning is the actual recovery mechanism for a corrupted or truncated state write.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 rather than SSE-KMS: state can contain generated passwords, so encryption at rest is
# required, but a customer-managed key adds per-request cost and another thing to lose for no
# gain in this threat model — the bucket is already unreachable from outside the account.
resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Old state versions accumulate forever otherwise. 90 days is well beyond any realistic
# "roll back to last week's state" need, and expiring them keeps the bucket genuinely free.
resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    id     = "expire-noncurrent-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.tfstate]
}

# Reject any request that is not over TLS. Without this the bucket policy permits plaintext
# HTTP, and Terraform state in flight is exactly the thing you do not want in plaintext.
resource "aws_s3_bucket_policy" "tfstate_tls_only" {
  bucket = aws_s3_bucket.tfstate.id
  policy = data.aws_iam_policy_document.tfstate_tls_only.json

  depends_on = [aws_s3_bucket_public_access_block.tfstate]
}

data "aws_iam_policy_document" "tfstate_tls_only" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.tfstate.arn,
      "${aws_s3_bucket.tfstate.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}
