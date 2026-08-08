terraform {
  # 1.10+ is required for `use_lockfile` on the S3 backend. DynamoDB-based locking is
  # deprecated by HashiCorp and slated for removal, so this tree never creates a lock table.
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    # Generates the RDS master password. The value lands in Terraform state, which is why the
    # state bucket is encrypted, versioned and TLS-only — see infra-aws/bootstrap.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Rule 1 of docs/AWS-SETUP.md, enforced by the provider before any API call rather than by
  # a human remembering to check. The account is shared; a wrong profile is a real risk.
  allowed_account_ids = [var.aws_account_id]

  # The mandatory tag set from docs/HANDOVER.md §3.2, applied as provider defaults so a
  # resource CANNOT be created without them. Keys are PascalCase — AWS tag keys are
  # case-sensitive and cost allocation tags are activated by exact key, so these must match
  # `mandatory_tag_keys` in infra-aws/account/variables.tf CHARACTER FOR CHARACTER. That module
  # activates these same keys account-wide; a mismatch produces tags that attribute nothing and
  # a budget that reports $0 forever, with no error anywhere.
  default_tags {
    tags = {
      Project     = var.project
      Owner       = var.owner
      CostCentre  = var.cost_centre
      Environment = var.environment
      ManagedBy   = "terraform"
      Expires     = var.expires
    }
  }
}
