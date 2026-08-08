# Project Signal on AWS — setup runbook

**Status:** Phase 0 complete (2026-08-07). Later phases are written as the code lands.
**Target region:** `eu-west-2` (London).
**Account model:** a **shared** enterprise sandbox — several projects, owner is admin inside it
but cannot create accounts outside it. The build is therefore designed to be _separable later_;
see [`HANDOVER.md`](HANDOVER.md) §3.2.

> This supersedes [`SETUP.md`](SETUP.md) as the setup path. `SETUP.md` describes the GCP
> deployment, which will not be built — it is kept because the GCP stack is the clearest
> available specification of what each service needs. See [`HANDOVER.md`](HANDOVER.md).

---

## The rules this runbook is built on

This is an enterprise account under review. The expensive failure is not a broken deploy — it
is building in the wrong place, or leaving something behind that someone else has to explain.
So every phase obeys the same five rules, and they are not negotiable:

1. **Prove the account first.** Every script starts by resolving the caller identity and
   comparing it against an expected account id. A mismatch aborts. You should never be one
   mistyped profile away from provisioning into a colleague's tenant.
2. **One prefix, everywhere.** Every resource is named `psignal-<env>-…`. Nothing is created
   with a name that could collide with, or be mistaken for, another workload.
3. **Tags are mandatory, not decorative.** Every resource carries `Project`, `Owner`,
   `CostCentre`, `Environment`, `ManagedBy` and `Expires`. This is what lets you answer "what is
   this and who owns it" without opening a ticket, and what makes the teardown script safe.

4. **Cost controls precede spend.** The budget alarm is created before the first billable
   resource. **ECS Fargate does not scale to zero** — five idle services bill continuously.
   That is a real change from the Cloud Run design this replaces, where idle cost was ~nil.
5. **Teardown is written before build-up.** Each phase ships with the commands to reverse it,
   scoped to the prefix and tags above, so you can prove the account is clean afterwards.

> **Rule 3, corrected 2026-08-07.** The tag list above previously read
> `project, owner, cost-centre, environment, expires` — lower-case, kebab-cased, and missing
> `ManagedBy`. It disagreed with [`HANDOVER.md`](HANDOVER.md) §3.2, which is authoritative
> (HANDOVER.md:5) and is what `infra-aws/` implements. **AWS tag keys are case-sensitive and cost
> allocation tags are activated by exact key**, so this was not a cosmetic discrepancy: applying
> one list and activating the other yields six tags that attribute nothing.

**On credentials.** Run everything yourself. I will never ask you to paste an access key,
secret, session token or password, and you should refuse any instruction that does — including
from me. Account ids and ARNs are identifiers, not secrets; those are fine to share, and I need
them to verify each step landed where intended.

---

## Phase 0 — COMPLETE (2026-08-07)

Run against account **`290304998906`** (`tesai-dev-sandbox`), `eu-west-2`. Full findings and
their consequences are in [`HANDOVER.md`](HANDOVER.md) §3. Summary:

| Finding             | Result                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Identity            | IAM Identity Center (SSO) admin. Temporary session role — **cannot be reused for CI**                |
| VPCs in `eu-west-2` | **None**, not even a default. No CIDR collisions; we create our own                                  |
| IAM role creation   | **Permitted** — probed for real with a create+delete, since the policy simulator does not model SCPs |
| OIDC providers      | **`gitlab.com` only.** GitHub's can be created. One provider per URL per account                     |
| Budgets             | `monthly_tesai-dev-sandbox` exists account-wide — leave it, add a tag-filtered one                   |
| Bedrock             | **Working.** `eu.anthropic.claude-haiku-4-5-20251001-v1:0` → "OK" in 752ms                           |
| Account spend       | ~$44 MTD, ~$182 forecast, rising. Not compute — our Fargate would be the first                       |

> ### ⚠️ If the enterprise AWS account is not `290304998906`, none of the above holds
>
> Model availability, IAM permissions, quotas, existing VPCs and OIDC providers are all
> account-specific. **Re-run the script below** — it is read-only and takes two minutes. Do not
> carry these values forward on faith.

---

## Phase 0 — discovery (read-only)

> **Read-only is not a reason to skip the account guard.** Since 2026-08-08 `00-discover.sh`
> sources `_guard.sh` and aborts before its first `describe`/`list`, like every other
> AWS-calling script. It previously did not: it ran all ~20 calls and only then printed
> _"confirm this is YOUR sandbox account"_ — asking a human to check **after** the traffic had
> already left. Under the sandbox rule a `list` against a sibling account is still unauthorised
> access to it, so "it only reads" is exactly the reasoning that produces an incident. To point
> it at a different account you legitimately hold, name that account explicitly:
> `EXPECTED_ACCOUNT=<12 digits> bash infra-aws/scripts/00-discover.sh`.

**Nothing is created. Nothing costs anything.** This establishes which account you are in, what
you are permitted to do, and which services are genuinely available, before any design is
committed to.

### Before you start

Install and authenticate the AWS CLI, then confirm which identity it is using:

```bash
aws --version
aws configure list          # shows which profile/region is active, not the secret values
```

If you use named profiles, export the right one for the whole session so no single command can
silently use the wrong account:

```bash
export AWS_PROFILE=<your-sandbox-profile>
export AWS_REGION=eu-west-2
```

### Run it

```bash
bash infra-aws/scripts/00-discover.sh
```

Then, once you have read the output and are satisfied it is your own account, run the one
reversible write probe:

```bash
bash infra-aws/scripts/00-discover.sh --test-iam
```

That probe creates a single IAM role with a deliberately un-assumable trust policy, then
deletes it. It exists because the IAM policy simulator in §5 **does not reliably account for
Service Control Policies** — an org-level SCP can deny role creation while the simulator says
`allowed`. Attempting it is the only trustworthy test. If the create succeeds but the delete
fails, say so immediately; a stray role must not be left behind.

### What each section tells us

| §   | Question it answers                        | Why it changes the plan                                                                                                                                  |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Which account, which principal             | Hard-coded into every later script as a guard                                                                                                            |
| 2   | Is the account inside an Organization / OU | `AccessDenied` is a normal, useful answer — it tells us guardrails exist above you                                                                       |
| 4   | Is the account actually empty              | Existing VPCs, buckets or clusters mean it is shared in practice, whatever it is called, and we must avoid colliding                                     |
| 5   | Can you create roles, VPCs, RDS, Cognito   | Necessary-but-not-sufficient; SCPs are invisible here                                                                                                    |
| 6   | Which Bedrock models exist in `eu-west-2`  | **The only source of truth.** Model ids and regional availability decay; this project has already been burned by a retired model id shipped as a default |
| 7   | Is there a budget                          | If not, one is created before anything billable                                                                                                          |
| 8   | Can you _really_ create a role             | The reliable version of §5                                                                                                                               |

### What I need back

The whole output. Redact the account id if you would rather — just tell me you have, so I do
not read a blank as a failed call.

Two results in particular will change the shape of the build:

- **If §6 lists no usable models, or §8 shows Bedrock invoke denied**, sentiment scoring needs
  another home. Options are inference in a different region (which has data-residency
  implications you would need cleared) or retaining an external LLM API. Better to find this
  out now than at the first scoring run.
- **If §8 shows role creation denied**, CI/CD cannot use GitHub OIDC as designed, and I will
  write a single consolidated request for your platform team — every role, trust policy and
  permission in one submission — rather than discovering them one failure at a time.

---

---

## Phase 1 — guardrails

**Status: APPLIED 2026-08-08, except cost allocation tag activation, which this account cannot
perform.** See "What actually happened" below before reading the rest of this section.

### What actually happened — 2026-08-08

Applied against `290304998906` as `psignal-dev`, plan reviewed and saved with `-out` so what
applied was exactly what was read. **No `-auto-approve`.**

| Step                     | Result                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `10-preflight.sh` before | Passed with 2 warnings — tags inactive, nothing tagged yet. Expected before a first apply                              |
| `bootstrap`              | ✅ **6 added.** `psignal-dev-tfstate-290304998906` — versioned, AES256, all four public-access blocks, TLS-only policy |
| `account`                | ⛔ **NOT APPLIED — impossible from this account.** See below                                                           |
| `stack`                  | ✅ **1 added.** Budget `psignal-dev-monthly`, $150, filter `user:Project$project-signal`                               |
| `10-preflight.sh` after  | **Exits 1, correctly blocking.** One resource carries `Project` while the key is inactive                              |
| `99-teardown.sh` dry run | Sees both resources by independent tag inventory. Changed nothing                                                      |

Verified by reading the resources back from AWS rather than from Terraform state: versioning
`Enabled`, encryption `AES256`, public access blocks `True True True True`, bucket policy
contains `DenyInsecureTransport`, and all six PascalCase tags present. Both budgets exist —
ours alongside the untouched `monthly_tesai-dev-sandbox`.

### ⛔ Cost allocation tags cannot be activated from this account

This is a structural limit, not a permissions gap to be argued with:

```
$ aws ce list-cost-allocation-tags --status Active
AccessDeniedException: Failed to list Cost Allocation Tags:
Linked account doesn't have access to cost allocation tags.
```

**`infra-aws/account/` was therefore never applied.** The denial was established by a read-only
call, so running the apply would only have added a failed apply to the audit log for information
already in hand.

> **This is also the clearest possible demonstration of why the policy simulator is not
> evidence.** Simulated against the same role, at the same moment:
>
> ```
> ce:UpdateCostAllocationTagsStatus  →  allowed
> ce:ListCostAllocationTags          →  allowed
> ```
>
> Both are denied in reality. The simulator evaluates identity policies; it does not model
> Organizations-level restrictions or SCPs, and SCPs are enabled on `o-czz6h8lnm0`. **Treat every
> `allowed` in §5 of the discovery script as necessary-but-not-sufficient.**

**Consequence, and its real size.** The budget's filter matches nothing until the `Project` key
is `Active`, so `psignal-dev-monthly` will report **$0 regardless of actual spend**. Right now
the only tagged resource is an empty state bucket, so the attribution being lost is worth
approximately nothing. **That changes at Phase 2**, when RDS and Fargate arrive — and because
activation does not backfill, spend incurred before activation is unattributable permanently.

`10-preflight.sh` now exits **1** on exactly this condition, so it blocks Phase 2 by design.
That is the correct behaviour and the check should not be weakened to get past it.

### Request for the platform team

Send this to whoever operates management account `857154590661`. It is one action, it benefits
every project in the sandbox, and it needs doing once.

> **Request: activate six cost allocation tag keys for account `290304998906`**
>
> Please activate the following user-defined cost allocation tags from the Organizations
> management account (Billing → Cost allocation tags), so that spend in the shared sandbox
> `tesai-dev-sandbox` can be attributed per project:
>
> `Project` · `Owner` · `CostCentre` · `Environment` · `ManagedBy` · `Expires`
>
> **Keys are case-sensitive and must be created exactly as spelled above** — activating
> `project` instead of `Project` attributes nothing while appearing to succeed.
>
> Why it is needed: the sandbox hosts several projects. Without these keys active, AWS Budgets
> and Cost Explorer cannot separate one project's spend from another's, and every tag-filtered
> budget in the account silently reports $0.
>
> Why we cannot do it ourselves: `ce:UpdateCostAllocationTagsStatus` is denied to linked
> accounts — _"Linked account doesn't have access to cost allocation tags"_.
>
> Timing matters: cost allocation tags **do not backfill**. They attribute from activation
> forward only, so any spend before activation is permanently unattributable. Our first
> genuinely billable resources (RDS, ECS Fargate) are held until this is done.

Once they confirm, re-run `bash infra-aws/scripts/10-preflight.sh`; §3 should report all six
`Active` and §6 should pass. **`infra-aws/account/` then stays unapplied permanently** — it
exists for an account where we do hold the permission, and applying it after the platform team
has acted would only create a Terraform resource claiming ownership of something we do not own.

---

**Original Phase 1 description follows.**

Created before anything billable exists, per rule 4. Everything lives in
[`../infra-aws/`](../infra-aws/) — see its [`README.md`](../infra-aws/README.md) for the
executable order of operations and [`CONVENTIONS.md`](../infra-aws/CONVENTIONS.md) for the
cross-repo standard this account now follows.

| Deliverable                                                                   | Where                                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Mandatory tags as provider defaults — a resource _cannot_ be created untagged | `infra-aws/*/versions.tf`, `default_tags`                           |
| Account guard — aborts before the first API call on the wrong account         | `allowed_account_ids`, plus `stack/guard.tf` for a readable message |
| Name prefix `psignal-dev-*`, single-sourced                                   | `stack/locals.tf`                                                   |
| Cost allocation tag activation — **account-global, separate state**           | `account/`                                                          |
| Tag-filtered monthly budget, `ACTUAL` at 50/90/100% and `FORECASTED` at 100%  | `stack/budget.tf`                                                   |
| Remote state, S3 native locking, no DynamoDB table                            | `bootstrap/`, `stack/backend.tf`                                    |
| Preflight and teardown scripts                                                | `scripts/10-preflight.sh`, `scripts/99-teardown.sh`                 |

### The failure this phase is really guarding against

**A budget filtered on an inactive cost allocation tag reports $0 forever.** Until a tag key is
`Active`, Cost Explorer and Budgets cannot see it, so the filter matches nothing and the alarm
is decoration. Activation also **does not backfill** — it applies forward only, which is the
reason it happens before the first billable resource rather than after.

`scripts/10-preflight.sh` §3 checks this explicitly, because it is invisible from the budget.

**Activation may be denied, and that is a normal outcome.** In an AWS Organization it is
normally reserved to the management account. If the apply fails on
`ce:UpdateCostAllocationTagsStatus`, **do not work around it** — ask the platform team to
activate the six keys centrally, once, benefiting every project in the account, and never apply
`infra-aws/account/` at all. The budget deploys either way.

> ### ⚠️ Activation is account-global, so it is not part of this project's stack
>
> Corrected 2026-08-08. `aws_ce_cost_allocation_tag` originally sat in `stack/budget.tf`. It is
> **one switch per tag key for the whole account**, so a `terraform destroy` on the stack — which
> `scripts/99-teardown.sh --execute` runs — would have deactivated all six keys **for every
> co-tenant project in the sandbox**. Activation does not backfill, so their lost attribution
> would have been permanent rather than restored on the next apply.
>
> It now lives in [`../infra-aws/account/`](../infra-aws/account/): its own state
> (`account/terraform.tfstate`), `prevent_destroy` on every key, applied deliberately by the
> owner or the platform team, **never by CI and never by a project deploy**. Read that module's
> header before running it, and tell the sandbox's other tenants first — an account-wide change
> is one they can see.

### Decisions taken at Phase 1 (owner, 2026-08-07)

| Question (was HANDOVER §10) | Answer                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account                     | Confirmed still `290304998906`                                                                                                                    |
| `Environment` tag           | `dev`, not `sandbox` — it names _our_ environment, so the stack lifts into a dedicated account later as an account-id change rather than a rename |
| `CostCentre`                | `tesai-dev-sandbox` as a placeholder; no formal code exists yet. **Replace it as soon as one is issued — cost allocation tags do not backfill**   |
| Cross-repo standard         | None existed. One is now proposed in [`../infra-aws/CONVENTIONS.md`](../infra-aws/CONVENTIONS.md)                                                 |

---

## Phases 2+ — not yet written

They land as the code does, and deliberately not before: a runbook written ahead of the code it
provisions is a runbook that drifts. The intended order, for context:

| Phase | What                                                                      | Needs your account?                                  |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| 0     | Discovery                                                                 | ✅ **done 2026-08-07**                               |
| B     | Port the libraries — S3, SQS, Bedrock, config                             | ✅ **done 2026-08-07**, no account needed            |
| 1     | Guardrails: budget alarm, tagging, prefix, teardown script                | ✅ **written 2026-08-07**, apply pending credentials |
| 2     | Foundation: VPC, RDS Postgres, S3, ECR, Secrets Manager                   | Yes                                                  |
| 3     | **Thin vertical slice** — one brand, one RSS feed, one signal, end to end | Yes                                                  |
| 4     | Full stack: ECS Fargate services, SQS + DLQs, EventBridge Scheduler       | Yes                                                  |
| 5     | Cognito, then the browser pass over the views nobody has ever seen        | Yes                                                  |
| 6     | CI/CD via GitHub OIDC                                                     | Yes                                                  |
| 7     | Delete `infra/` and the five GCP dependencies                             | No                                                   |

Phase 3 is deliberately early. **Nothing in this system has ever run in any cloud**, so the
first real end-to-end run is the highest-information moment in the whole plan and should not be
deferred behind a full build-out.
