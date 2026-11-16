# ALB access logs — who called what, from where, and what they got back.
#
# CloudWatch's ALB metrics are counts. When the question is "which client hammered /assistant at
# 03:00" or "did that 401 come from the office or from somewhere else", only the access log
# answers it, and it cannot be produced after the fact. This bucket is that record.
#
# Hardened exactly like the raw and reports buckets (s3.tf), with two differences forced by the
# service that writes into it:
#
#   * Encryption is SSE-S3 (AES256). ALB log delivery does not support SSE-KMS.
#   * The writer is Elastic Load Balancing's own regional account, granted PutObject on this
#     account's log prefix only. Its id differs per region and is not written here from memory:
#     `aws_elb_service_account` resolves it from the provider for the configured region.

data "aws_elb_service_account" "main" {}

resource "aws_s3_bucket" "alb_logs" {
  bucket = "${local.name_prefix}-alb-logs-${data.aws_caller_identity.current.account_id}"

  # Access logs are operational evidence, not the product's audit trail; in dev they are
  # disposable with everything else. See var.allow_force_destroy.
  force_destroy = var.allow_force_destroy

  tags = { Name = "${local.name_prefix}-alb-logs" }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 90 days covers "something odd happened last month" and keeps the bucket from becoming a slow,
# unwatched storage bill — an ALB writes a file per node every five minutes whether or not
# anything is happening.
resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {}

    expiration {
      days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowAlbLogDelivery"
        Effect    = "Allow"
        Principal = { AWS = data.aws_elb_service_account.main.arn }
        Action    = "s3:PutObject"
        # Only this account's log prefix — the ALB below writes to alb/AWSLogs/<account>/...
        Resource = "${aws_s3_bucket.alb_logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.alb_logs.arn, "${aws_s3_bucket.alb_logs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.alb_logs]
}
