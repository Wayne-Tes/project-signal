terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # The sandbox rule applies here exactly as it does in bootstrap/ and stack/. This module
  # changes an ACCOUNT-WIDE setting, so provisioning it into the wrong account would not be a
  # scoped mistake — it would reconfigure someone else's billing attribution.
  allowed_account_ids = [var.aws_account_id]

  # No `default_tags` block, deliberately. This module manages exactly one kind of resource —
  # `aws_ce_cost_allocation_tag` — which is an account SETTING, not a taggable resource. A
  # default_tags block here would be decoration implying an ownership this module does not have.
}
