# Stack-only values. Kept separate from dev.tfvars so that bootstrap, which does not declare
# these variables, can consume dev.tfvars without Terraform warning about undeclared values.

# Sizing this is a judgement, so here is the arithmetic behind it rather than a round number.
# Expected steady state once Phase 4 is complete, eu-west-2 on-demand:
#
#   RDS db.t4g.micro, single-AZ, 20GB gp3      ~ $15
#   4x Fargate task, 0.25 vCPU / 0.5 GB, 24/7  ~ $36   <- does NOT scale to zero
#   Application Load Balancer                  ~ $17
#   NAT gateway (if Phase 2 uses one)          ~ $33   <- prefer VPC endpoints; see infra-aws/README.md
#   S3 + SQS + Secrets Manager                 ~  $3
#   Bedrock (Haiku 4.5, low volume)            ~  $5
#                                              -------
#                                              ~ $109
#
# 150 leaves headroom for a bad week without being so generous that breaching it means nothing.
# The FORECASTED notification is the one that will actually catch a mistake here, because
# Fargate bills continuously and a forgotten service shows in the trajectory long before it
# shows in the total.
monthly_budget_usd = 150

budget_notification_emails = ["wayne.strydom@tes.com"]

# Terraform activates the six mandatory tag keys as cost allocation tags. If this account is a
# member of an Organization, that call may be denied — activation is usually reserved to the
# management account. Flip to false and request activation from the platform team if so; the
# budget still deploys, but its filter matches nothing until the Project key is Active.
manage_cost_allocation_tags = true
