# Phase 2 — object storage.
#
# `raw` holds the verbatim ingested payloads that sentiment scoring reads back. It is the audit
# trail: KNOWN-GAPS #4 was the defect where nothing was ever written here and the worker scored
# a URL string, producing real-looking sentiment derived from nothing. Ingestion now uploads
# BEFORE inserting the signal row, so raw_storage_ref can never point at a missing object.
#
# `reports` is unused until Epic 12 and is created now because an empty bucket costs nothing and
# adding it later means another apply against a live stack.

locals {
  # Bucket names are globally unique across all AWS accounts, so the account id disambiguates —
  # the same pattern the state bucket uses. An account id is an identifier, not a secret.
  raw_bucket_name     = "${local.name_prefix}-raw-${data.aws_caller_identity.current.account_id}"
  reports_bucket_name = "${local.name_prefix}-reports-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "raw" {
  bucket = local.raw_bucket_name
  tags   = { Name = local.raw_bucket_name }
}

resource "aws_s3_bucket" "reports" {
  bucket = local.reports_bucket_name
  tags   = { Name = local.reports_bucket_name }
}

# --- Hardening, applied identically to both -----------------------------------------------
#
# for_each over the two buckets rather than duplicated blocks, so a setting cannot be applied to
# one and forgotten on the other. That asymmetry is exactly how a public bucket happens.

locals {
  buckets = {
    raw     = aws_s3_bucket.raw.id
    reports = aws_s3_bucket.reports.id
  }
}

resource "aws_s3_bucket_public_access_block" "buckets" {
  for_each = local.buckets
  bucket   = each.value

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "buckets" {
  for_each = local.buckets
  bucket   = each.value

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_ownership_controls" "buckets" {
  for_each = local.buckets
  bucket   = each.value

  # ACLs disabled entirely. Object ownership is the bucket owner's, full stop — which removes
  # the whole class of "an object nobody can read because another principal owns it".
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "tls_only" {
  for_each = local.buckets
  bucket   = each.value

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        "arn:aws:s3:::${each.value}",
        "arn:aws:s3:::${each.value}/*",
      ]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.buckets]
}

# Raw payloads are read once by the sentiment worker, shortly after ingestion, and then only for
# audit. Standard-IA after 30 days matches the intent of the GCP stack's NEARLINE rule.
# Nothing is expired: the audit trail is the point of the bucket.
resource "aws_s3_bucket_lifecycle_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id

  rule {
    id     = "raw-to-infrequent-access"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
