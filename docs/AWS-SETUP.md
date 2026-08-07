# Project Signal on AWS — setup runbook

**Status:** Phase 0 complete (2026-08-07). Later phases are written as the code lands.
**Target region:** `eu-west-2` (London).
**Account model:** a **shared** enterprise sandbox — several projects, owner is admin inside it
but cannot create accounts outside it. The build is therefore designed to be *separable later*;
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
3. **Tags are mandatory, not decorative.** Every resource carries `project`, `owner`,
   `cost-centre`, `environment` and `expires`. This is what lets you answer "what is this and
   who owns it" without opening a ticket, and what makes the teardown script safe.
4. **Cost controls precede spend.** The budget alarm is created before the first billable
   resource. **ECS Fargate does not scale to zero** — five idle services bill continuously.
   That is a real change from the Cloud Run design this replaces, where idle cost was ~nil.
5. **Teardown is written before build-up.** Each phase ships with the commands to reverse it,
   scoped to the prefix and tags above, so you can prove the account is clean afterwards.

**On credentials.** Run everything yourself. I will never ask you to paste an access key,
secret, session token or password, and you should refuse any instruction that does — including
from me. Account ids and ARNs are identifiers, not secrets; those are fine to share, and I need
them to verify each step landed where intended.

---

## Phase 0 — COMPLETE (2026-08-07)

Run against account **`290304998906`** (`tesai-dev-sandbox`), `eu-west-2`. Full findings and
their consequences are in [`HANDOVER.md`](HANDOVER.md) §3. Summary:

| Finding | Result |
| ------- | ------ |
| Identity | IAM Identity Center (SSO) admin. Temporary session role — **cannot be reused for CI** |
| VPCs in `eu-west-2` | **None**, not even a default. No CIDR collisions; we create our own |
| IAM role creation | **Permitted** — probed for real with a create+delete, since the policy simulator does not model SCPs |
| OIDC providers | **`gitlab.com` only.** GitHub's can be created. One provider per URL per account |
| Budgets | `monthly_tesai-dev-sandbox` exists account-wide — leave it, add a tag-filtered one |
| Bedrock | **Working.** `eu.anthropic.claude-haiku-4-5-20251001-v1:0` → "OK" in 752ms |
| Account spend | ~$44 MTD, ~$182 forecast, rising. Not compute — our Fargate would be the first |

> ### ⚠️ If the enterprise AWS account is not `290304998906`, none of the above holds
>
> Model availability, IAM permissions, quotas, existing VPCs and OIDC providers are all
> account-specific. **Re-run the script below** — it is read-only and takes two minutes. Do not
> carry these values forward on faith.

---

## Phase 0 — discovery (read-only)

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

| § | Question it answers | Why it changes the plan |
| - | ------------------- | ----------------------- |
| 1 | Which account, which principal | Hard-coded into every later script as a guard |
| 2 | Is the account inside an Organization / OU | `AccessDenied` is a normal, useful answer — it tells us guardrails exist above you |
| 4 | Is the account actually empty | Existing VPCs, buckets or clusters mean it is shared in practice, whatever it is called, and we must avoid colliding |
| 5 | Can you create roles, VPCs, RDS, Cognito | Necessary-but-not-sufficient; SCPs are invisible here |
| 6 | Which Bedrock models exist in `eu-west-2` | **The only source of truth.** Model ids and regional availability decay; this project has already been burned by a retired model id shipped as a default |
| 7 | Is there a budget | If not, one is created before anything billable |
| 8 | Can you *really* create a role | The reliable version of §5 |

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

## Phases 1+ — not yet written

They land as the code does, and deliberately not before: a runbook written ahead of the code it
provisions is a runbook that drifts. The intended order, for context:

| Phase | What | Needs your account? |
| ----- | ---- | ------------------- |
| 0 | Discovery | ✅ **done 2026-08-07** |
| B | Port the libraries — S3, SQS, Bedrock, config | ✅ **done 2026-08-07**, no account needed |
| 1 | Guardrails: budget alarm, tagging, prefix, teardown script | Yes |
| 2 | Foundation: VPC, RDS Postgres, S3, ECR, Secrets Manager | Yes |
| 3 | **Thin vertical slice** — one brand, one RSS feed, one signal, end to end | Yes |
| 4 | Full stack: ECS Fargate services, SQS + DLQs, EventBridge Scheduler | Yes |
| 5 | Cognito, then the browser pass over the views nobody has ever seen | Yes |
| 6 | CI/CD via GitHub OIDC | Yes |
| 7 | Delete `infra/` and the five GCP dependencies | No |

Phase 3 is deliberately early. **Nothing in this system has ever run in any cloud**, so the
first real end-to-end run is the highest-information moment in the whole plan and should not be
deferred behind a full build-out.
