# Phase 2 — container registries, one per deployable service.
#
# report-worker is deliberately absent. Owner decision (HANDOVER §10, Q4): it is a health-check
# skeleton until Epic 12, and a permanently-running Fargate task serving /health is pure cost.
# Adding it back is one line here and one service in Phase 4.

locals {
  # Matches the apps that have a Dockerfile and will run on Fargate. `web` is included: it is a
  # standalone Next.js server, not a static bundle.
  ecr_repositories = toset(["api", "web", "ingestion", "sentiment-worker"])
}

resource "aws_ecr_repository" "app" {
  for_each = local.ecr_repositories

  name = "${local.name_prefix}/${each.value}"

  # IMMUTABLE, and this is load-bearing rather than tidy. Terraform owns the image via a required
  # image_tag variable with no default, precisely so an apply cannot silently roll images back
  # (CLAUDE.md). Mutable tags would reopen that hole from the other end: the same tag could point
  # at different content over time, so a rollback to a known tag would not be a known rollback.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${local.name_prefix}-${each.value}" }
}

# Images accumulate one per deploy, forever, and each is ~100-200MB. Keeping the last 20 leaves
# ample rollback depth while stopping the registry becoming a slow storage leak nobody looks at.
resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day — build leftovers, never deployed"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the 20 most recent tagged images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}
