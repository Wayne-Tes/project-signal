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

# `manage_cost_allocation_tags` used to be set here. Cost allocation tag activation is
# ACCOUNT-GLOBAL and has moved to its own root module with its own state — see
# infra-aws/account/ and infra-aws/envs/account.tfvars. It is applied deliberately, by the
# account owner or the platform team, and never as part of a project deploy.
#
# The budget below still needs the `Project` key to be Active or it matches nothing and reports
# $0 forever. That precondition is checked by infra-aws/scripts/10-preflight.sh §3, which you
# run before applying.
