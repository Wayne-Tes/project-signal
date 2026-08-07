terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bootstrap uses LOCAL state because it creates the remote state bucket that everything
  # else uses (chicken-and-egg) — the same shape as infra/bootstrap/versions.tf on the GCP
  # side. Its state is deliberately disposable: the single resource it manages is
  # identifiable by name, so a lost .tfstate is recoverable with `terraform import`, not a
  # stranded resource. Do not add anything else here.
  backend "local" {}
}

provider "aws" {
  region = var.aws_region

  # Hard stop before any API call if the credentials resolve to a different account. This is
  # rule 1 of docs/AWS-SETUP.md — you should never be one mistyped profile away from
  # provisioning into a colleague's tenant. The account is SHARED, so this is not paranoia.
  allowed_account_ids = [var.aws_account_id]

  # Mandatory tags applied as provider defaults so a resource CANNOT be created without them.
  # Keys are PascalCase per docs/HANDOVER.md §3.2, which is authoritative over AWS-SETUP.md's
  # earlier lower-case list (HANDOVER.md:5). AWS tag keys are case-sensitive and cost
  # allocation tags are activated by exact key, so the casing is load-bearing, not cosmetic.
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
