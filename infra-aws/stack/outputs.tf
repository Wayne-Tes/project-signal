output "account_id" {
  description = "The account actually provisioned into. If this is not 290304998906, every account-specific fact in docs/HANDOVER.md §3 is unverified."
  value       = data.aws_caller_identity.current.account_id
}

output "region" {
  description = "Region resolved by the provider."
  value       = data.aws_region.current.region
}

output "name_prefix" {
  description = "The prefix every resource in this project is named with. The teardown script scopes to it."
  value       = local.name_prefix
}

output "budget_name" {
  description = "The project budget. Distinct from the account-wide monthly_tesai-dev-sandbox, which this does not touch."
  value       = aws_budgets_budget.project.name
}

output "budget_tag_filter" {
  description = "The cost filter the budget matches on. Verify with `aws ce list-cost-allocation-tags` that the Project key is Active, or this silently reports zero."
  value       = local.budget_tag_filter
}

# There is deliberately no `cost_allocation_tags_managed` output. Whether the keys are Active is
# a fact about the ACCOUNT, not about this stack's state, and reporting it from here would be
# reporting an intention rather than a reality. Read it from the account itself:
#
#   aws ce list-cost-allocation-tags --status Active
#   bash infra-aws/scripts/10-preflight.sh    # §3 does exactly this, and interprets it
#
# See infra-aws/account/ for the module that activates them.

# ── Phase 2 ──────────────────────────────────────────────────────────────────────────────────

output "vpc_id" {
  description = "The project VPC. Phase 4's Fargate services and ALB attach here."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnets — ALB in Phase 4. Nothing is placed here by default."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnets — RDS today, Fargate tasks in Phase 4. No default route to the internet; see the NAT decision in vpc.tf."
  value       = aws_subnet.private[*].id
}

output "app_security_group_id" {
  description = "Attach to Fargate tasks. It is what the database's ingress rule permits, so a task outside this group cannot reach Postgres."
  value       = aws_security_group.app.id
}

output "db_endpoint" {
  description = "RDS endpoint, host:port. Not a secret; the instance is not publicly accessible and only the app security group may reach it."
  value       = aws_db_instance.main.endpoint
}

output "db_secret_arn" {
  description = "Secrets Manager ARN holding the DB credentials as JSON, including a ready-made `url` for DATABASE_URL. Grant the ECS task role read access to THIS arn only."
  value       = aws_secretsmanager_secret.db.arn
}

output "raw_bucket" {
  description = "RAW_BUCKET for ingestion and sentiment-worker. getObjectStore() throws a named error if unset."
  value       = aws_s3_bucket.raw.id
}

output "reports_bucket" {
  description = "REPORTS_BUCKET. Unused until Epic 12."
  value       = aws_s3_bucket.reports.id
}

output "ecr_repository_urls" {
  description = "Push targets per service, keyed by app name. Phase 6's CI pushes here; Terraform owns which tag is deployed."
  value       = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "alb_dns_name" {
  description = "The team-facing URL. HTTP only until a real hostname and ACM certificate exist (docs/OWNER-ACTIONS.md item 6)."
  value       = "http://${aws_lb.main.dns_name}"
}

output "ecs_cluster" {
  description = "Cluster name, for `aws ecs execute-command` when debugging a task in a private subnet."
  value       = aws_ecs_cluster.main.name
}

output "cognito_user_pool_id" {
  description = "Cognito user pool. The API verifies tokens against its JWKS; the web client authenticates against it."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  description = "Public web app client id. Safe to ship in the browser bundle — it identifies the app, it does not authorise anything."
  value       = aws_cognito_user_pool_client.web.id
}
