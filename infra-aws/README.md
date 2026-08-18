# `infra-aws/` — Project Signal on AWS

**Region:** `eu-west-2` (London) · **Account:** `290304998906` (`tesai-dev-sandbox`, shared)
**Phase:** 1 of 7 — guardrails. See [`../docs/AWS-SETUP.md`](../docs/AWS-SETUP.md) for the runbook
and [`../docs/HANDOVER.md`](../docs/HANDOVER.md) §6 for the phase plan.

> This is the real target. [`../infra/`](../infra/) is the superseded GCP tree, kept only as the
> clearest available specification of what each service needs. It will never be applied.

> ## ⛔ Sandbox account `290304998906` only
>
> This account is inside a **TES enterprise organisation under active scrutiny**. Nothing in this
> tree may run against any other account — **including read-only calls**, which are still
> unauthorised access. Never widen `allowed_account_ids`; never add a provider alias or
> `assume_role` reaching elsewhere; never touch Organizations, SCPs, root IAM or billing.
> `monthly_tesai-dev-sandbox` is read-only to us.
>
> Enforced by [`scripts/_guard.sh`](scripts/_guard.sh), which aborts before the first API call
> and is sourced by every script here. **Any new script must source it.** Full rule:
> [`CONVENTIONS.md`](CONVENTIONS.md) §0 and [`../DEVRULES.md`](../DEVRULES.md).

## What exists today

| Path                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`              | The S3 remote-state bucket. Local state, run once, creates nothing else                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `account/`                | ⚠️ **ACCOUNT-GLOBAL, and NOT APPLICABLE HERE.** Activates the six tag keys as cost allocation tags. **`290304998906` is a linked account and cannot do this** — verified 2026-08-08: _"Linked account doesn't have access to cost allocation tags"_. It stays **unapplied**; the platform team activates the keys from management account `857154590661` instead (request ready to send in `../docs/AWS-SETUP.md`). Kept because it is correct for an account that does hold the permission |
| `stack/`                  | The tag-filtered budget. Remote state                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `envs/dev.tfvars`         | Tag values shared by `bootstrap/` and `stack/`, so they cannot drift                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `envs/dev.stack.tfvars`   | Budget-only values                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `envs/account.tfvars`     | Values for the account-global module. Separate because nothing in it is per-environment                                                                                                                                                                                                                                                                                                                                                                                                     |
| `scripts/00-discover.sh`  | Phase 0 discovery, read-only. Already run — findings in HANDOVER §3                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/10-preflight.sh` | Run before any apply. Checks account, cost allocation tags, collisions                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/99-teardown.sh`  | Reverses everything and proves the account is clean. Dry run by default                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CONVENTIONS.md`          | The proposed cross-repo standard for this shared account                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**No VPC, RDS, ECR, Secrets Manager, ECS or Cognito yet** — those are Phases 2–5.

## Order of operations

Cost controls precede spend, so the budget is created before anything billable exists.

```bash
# 0. Authenticate. SSO enrolment is interactive and must be done by a human.
aws configure sso --profile psignal-dev
export AWS_PROFILE=psignal-dev

# 1. Preflight — read-only, proves the account and surfaces silent-failure conditions.
bash infra-aws/scripts/10-preflight.sh

# 2. State backend. Local state, one resource, run once.
terraform -chdir=infra-aws/bootstrap init
terraform -chdir=infra-aws/bootstrap apply -var-file=../envs/dev.tfvars

# 3. Wire the stack to that bucket. The bootstrap prints this command with the name filled in:
terraform -chdir=infra-aws/bootstrap output -raw backend_config

# 4. SKIPPED IN THIS ACCOUNT — do not run infra-aws/account here.
#    Cost allocation tag activation is denied to linked accounts. Verified 2026-08-08:
#      AccessDeniedException: Linked account doesn't have access to cost allocation tags
#    The platform team activates the six keys from management account 857154590661 instead.
#    The ready-to-send request is in ../docs/AWS-SETUP.md § Phase 1.
#
#    Run the module ONLY in an account that genuinely holds ce:UpdateCostAllocationTagsStatus,
#    and read infra-aws/account/main.tf in full first — it changes a setting for the WHOLE
#    account, shared with every other project in it.

# 5. The budget. It deploys fine without step 4, but its filter matches nothing until the
#    Project key is Active, so it reports $0 regardless of spend. 10-preflight.sh checks this.
terraform -chdir=infra-aws/stack init -backend-config=... # from step 3
terraform -chdir=infra-aws/stack apply \
  -var-file=../envs/dev.tfvars -var-file=../envs/dev.stack.tfvars

# 6. Confirm the guardrail actually guards something.
bash infra-aws/scripts/10-preflight.sh
```

Step 5's command is the **first** apply only, from when the stack stopped at the budget. Once
Phase 4 exists, `image_tag` is a required variable with no default, and an apply without it fails
rather than silently redeploying whatever was last written. Use the redeploy sequence below.

## Redeploying a code change

```bash
# 1. Build and push all four images at the current commit's sha. Refuses a dirty tree, refuses a
#    tag that already exists (ECR is IMMUTABLE), and reads the three NEXT_PUBLIC_* values out of
#    Terraform rather than trusting anyone to retype them.
AWS_PROFILE=psignal-dev bash infra-aws/scripts/20-build-push.sh

# 2. Plan, and READ IT LINE BY LINE. Terraform owns the image, so the tag is what moves.
terraform -chdir=infra-aws/stack plan \
  -var-file=../envs/dev.tfvars -var-file=../envs/dev.stack.tfvars \
  -var="image_tag=$(git rev-parse --short HEAD)"

# 3. Apply. Never -auto-approve, never a plan you have not read.
terraform -chdir=infra-aws/stack apply \
  -var-file=../envs/dev.tfvars -var-file=../envs/dev.stack.tfvars \
  -var="image_tag=$(git rev-parse --short HEAD)"
```

**Build the web image against the stack you are deploying to.** `NEXT_PUBLIC_*` values are
inlined into the client bundle by `next build`, so they are fixed at build time, not at task
start. An image built against the wrong Cognito pool or API origin builds, pushes, deploys and
runs healthy — and nobody can sign in. `20-build-push.sh` takes them from `terraform output` for
exactly that reason; do not pass them by hand.

**The image must be `linux/amd64`.** Fargate runs amd64. A build that defaults to arm64 pushes
cleanly and then fails at task start with `exec format error`, which reads as a broken image
rather than a wrong architecture. The script passes `--platform linux/amd64` explicitly.

Teardown, in reverse, dry run first:

```bash
bash infra-aws/scripts/99-teardown.sh              # shows what would go
bash infra-aws/scripts/99-teardown.sh --execute
bash infra-aws/scripts/99-teardown.sh              # re-run: step 3 must report nothing
```

## Things that will cost you time if you don't know them

**A budget on an inactive cost allocation tag reports $0 forever.** This is the single most
likely way Phase 1 can appear to succeed while doing nothing. Until a tag key is `Active`, Cost
Explorer and Budgets cannot see it, so the filter matches no resources and the budget reports a
perfectly healthy zero. `scripts/10-preflight.sh` §3 checks this explicitly. Activation also
**does not backfill** — it applies forward only, which is why it happens before the first
billable resource rather than after.

**Cost allocation tag activation is ACCOUNT-GLOBAL, and that is why it has its own module.**
It is one switch per tag key for the entire account, not a per-project setting. While it lived
in `stack/budget.tf`, `terraform destroy` — which `scripts/99-teardown.sh --execute` runs —
would have deactivated all six keys **for every other project in this sandbox**, permanently,
since activation does not backfill. Tearing down our project must not degrade somebody else's
cost reporting. It now lives in `account/`, with separate state and `prevent_destroy`, and
`99-teardown.sh` never touches it.

**Activation may be denied, and that is a normal outcome.** In an AWS Organization it is usually
reserved to the management account. If `terraform apply` fails on
`ce:UpdateCostAllocationTagsStatus`, **do not work around it** — ask the platform team to
activate the six keys centrally, once, for every project in the account, and simply never apply
`account/`. The budget still deploys; it just cannot attribute anything until they do, which
`scripts/10-preflight.sh` §3 will tell you.

**Tag key casing is load-bearing.** PascalCase — `Project`, not `project`. AWS tag keys are
case-sensitive and cost allocation tags are activated by exact key.
[`../docs/HANDOVER.md`](../docs/HANDOVER.md) §3.2 is authoritative; `AWS-SETUP.md` previously
carried a lower-case list and has been corrected.

**`$` in a Terraform tag filter needs `format()`, not interpolation.** AWS Budgets writes a tag
filter as `user:<Key>$<Value>`. In HCL, `$${` is the escape sequence for a literal `${`, so
`"user:Project$${var.project}"` silently produces the string `user:Project${var.project}` and
the budget filters on a value nothing carries. `stack/locals.tf` uses `format()` for exactly
this reason.

**The account-wide budget is not ours.** `monthly_tesai-dev-sandbox` belongs to whoever runs the
sandbox. We add alongside it and never modify it.

**Prefer VPC endpoints to a NAT gateway in Phase 2.** A NAT gateway is roughly $33/month before
a byte crosses it — on a stack budgeted at $150 that is over a fifth of the ceiling for
something the workload may not need.

**ECS Fargate does not scale to zero.** The GCP costing this replaces (~$13–15/month) rested
entirely on Cloud Run doing so. Five idle services bill continuously. The `FORECASTED`
notification on the budget is the one that catches this, and it is not ceremony.

## State

`bootstrap/` uses **local state** because it creates the remote backend — the usual
chicken-and-egg, and the same shape as [`../infra/bootstrap/`](../infra/bootstrap/) on the GCP
side. Its state is deliberately disposable: it manages one bucket, identifiable by name, so a
lost `.tfstate` is a `terraform import` rather than a stranded resource.

`stack/` uses **S3 remote state with native locking** (`use_lockfile = true`). There is no
DynamoDB lock table anywhere in this tree — DynamoDB-based locking is deprecated upstream and
slated for removal.

`account/` uses remote state too, keyed `account/terraform.tfstate` — deliberately **not**
`env/<environment>/`, because there is one set of cost allocation tags per AWS account, not one
per environment. Keying it beside the project environments would imply a per-environment
lifecycle that does not exist and would invite a second copy. It currently shares Project
Signal's state bucket because that is the only bucket in the account; if a platform-team bucket
ever exists, migrate it there with `terraform init -migrate-state`.
