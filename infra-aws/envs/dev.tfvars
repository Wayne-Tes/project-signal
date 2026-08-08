# Shared by BOTH root modules — infra-aws/bootstrap and infra-aws/stack — so the mandatory tag
# values can never drift between them. Contains no secrets: an account id, a region and tag
# values are identifiers, and this file is committed deliberately.
#
#   terraform -chdir=infra-aws/bootstrap apply -var-file=../envs/dev.tfvars
#   terraform -chdir=infra-aws/stack     apply -var-file=../envs/dev.tfvars -var-file=../envs/dev.stack.tfvars

# Verified live on 2026-08-07 (docs/HANDOVER.md §3.1) and re-confirmed by the owner on
# 2026-08-07. The provider's allowed_account_ids aborts the run if credentials resolve
# anywhere else.
aws_account_id = "290304998906"

# London. Storage, database and queues stay here. Bedrock inference routes across the EU via
# the `eu.` inference profile, which is a separate and deliberate decision — docs/HANDOVER.md §3.4.
aws_region = "eu-west-2"

# Project tag: read by humans and by Cost Explorer, so spelled out.
project = "project-signal"

# Name prefix: short, because several AWS resource names are length-limited. Already in use by
# the local stack (scripts/localstack-init.sh creates psignal-local-raw), so dev is consistent
# with what already ships.
project_prefix = "psignal"

# OUR environment, not the account's nature. Owner decision, 2026-08-07. Keeping this as our
# own environment name is what lets the whole stack lift into a dedicated account later as an
# account-id change rather than a rename — docs/HANDOVER.md §3.2 calls that the highest-value
# property to protect.
environment = "dev"

owner = "wayne.strydom@tes.com"

# Owner decision, 2026-08-07: no formal cost centre code exists yet, so the account alias
# stands in. It is at least attributable to a known owner if someone audits the shared account.
# SETTLED, owner 2026-08-08 — this is the correct value, not a placeholder awaiting a real one.
# An earlier comment here said "REPLACE THIS once a real code is issued". There is no such code:
# 290304998906 is the shared account where the department's canary projects, prototypes and
# spikes live, and they are not charged per project. `tesai-dev-sandbox` names the thing actually
# paying, which is what a cost centre is.
#
# Separating THIS project's spend from its co-tenants' is the `Project` tag's job, not this one —
# the budget filters on user:Project$project-signal. See docs/HANDOVER.md §10.
#
# Revisit only if per-project charge codes appear, or if Project Signal moves to a dedicated
# account, at which point aws_account_id changes anyway.
cost_centre = "tesai-dev-sandbox"

# Review date, one year out. The teardown script uses this to identify stale resources.
expires = "2027-08-07"
