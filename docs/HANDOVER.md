# Handover — read this first

**Written:** 2026-08-07
**Audience:** the next agent, in a fresh repository, with no memory of how any of this came to be.
**Status:** authoritative on current state. Where this disagrees with any other document, this wins.

You are picking up a system that is **code-complete on AWS libraries, verified end to end
locally, and not yet deployed anywhere.** This document tells you what exists, what is proven,
what is assumed, and what to do next. Read it in full before writing code.

Then read, in order: [`../DEVRULES.md`](../DEVRULES.md),
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`KNOWN-GAPS.md`](KNOWN-GAPS.md),
[`AWS-SETUP.md`](AWS-SETUP.md).

---

## 0. If you are reading this in a newly created repository

This codebase was developed in a personal GitHub repo (`LokimotiveUK/project-signal`) and
**moved to `Wayne-Tes/project-signal` on 2026-08-07 by pushing, not by export** — so the full
32-commit history came with it. Read the commit messages; they carry the reasoning for every
change and are a first-class part of this handover.

Things that the move made stale, or that still need doing:

| What                              | Where                                  | Status                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Git remote                        | `.git/config`                          | ✅ Done. `origin` → `https://Wayne-Tes@github.com/Wayne-Tes/project-signal.git` is now the **only** remote. `old-origin` (the contractor's personal repo) was **removed 2026-08-08** — a `git push old-origin` would have sent TES code to a personal GitHub account                                                                                                                             |
| Commit identity                   | `.git/config` (local)                  | ✅ Set 2026-08-08 to `Wayne Strydom <wayne.strydom@tes.com>`. The machine's **global** config is still the contractor's `LokimotiveUK`, so a repo without local config commits as them. **Verify `git config user.email` before your first commit.** Commits 1–36 are authored as `LokimotiveUK` and 11 carry a `Co-Authored-By: Claude` trailer; that is history and is **not** to be rewritten |
| GitHub OIDC trust policy          | not yet written (Phase 6)              | **The IAM role's trust policy must name `repo:Wayne-Tes/project-signal:*`.** Get this right first time — a mismatch fails with an error that does not name the cause                                                                                                                                                                                                                             |
| `github_repository`               | `infra/bootstrap/variables.tf`         | Updated to the new path for accuracy, but it is GCP WIF and **will never be applied** — see §8                                                                                                                                                                                                                                                                                                   |
| Repo is user-owned, not org-owned | GitHub                                 | `Wayne-Tes` is a **user account**, so there are no teams — access is per-individual collaborator. A repo can be transferred into an organisation later without losing history or issues; do that if the team needs shared ownership                                                                                                                                                              |
| Branch protection                 | GitHub settings                        | **Still not configured — owner action.** Require a PR, require `CI` and `Terraform Check — infra-aws` to pass, and **block force-pushes and branch deletion on `main`**. Nothing in the repo can enforce this; it is a settings change only you can make                                                                                                                                         |
| GCP deploy workflows              | `.github/workflows/`                   | **Removed 2026-08-08.** `deploy-staging.yml` and `deploy-production.yml` targeted a GCP project that will never exist, could not have succeeded (no `WIF_PROVIDER`), and both remained `workflow_dispatch`-triggerable. Phase 6 writes AWS ones fresh — do not resurrect these from history                                                                                                      |
| `infra-aws/` CI coverage          | `.github/workflows/terraform-plan.yml` | **Added 2026-08-08.** The file previously filtered on the dead `infra/**` GCP tree, so the AWS tree had none. Now runs `fmt`/`validate` on all three root modules plus `shellcheck`, and **asserts every AWS-calling script sources `_guard.sh`** — the check that would have caught the `00-discover.sh` gap. Makes **zero AWS API calls**; a real `plan` job waits for Phase 6 OIDC            |
| GitHub Actions on a private repo  | GitHub settings                        | Verify Actions are enabled and that GitHub-hosted runners are permitted. The workflows target `ubuntu-latest`; a self-hosted-only policy means they need editing                                                                                                                                                                                                                                 |

**Everything verified below was verified in AWS account `290304998906` (`tesai-dev-sandbox`).
If the enterprise account is a different one, every account-specific fact in §3 is unverified
again** — model availability, IAM permissions, quotas, the lot. Re-run the discovery script
(§3.5). It is read-only and takes two minutes. Do not carry these values forward on faith; that
is precisely the failure mode DEVRULES exists to prevent.

---

## 1. What this system is

An **agency-managed, multi-tenant brand-intelligence SaaS**. It ingests public brand signals
(Google/App Store/Play reviews, YouTube comments, RSS), scores each with an LLM for sentiment
across five fixed dimensions — **trust, quality, service, value, experience** — and surfaces a
composite Brand Perception Index, an "Achilles Heel" weakness ranking, and competitor
benchmarking.

One `tenant` per customer. A tenant owns `brand_entities` (its own brands, plus competitors it
tracks). Users are `owner` / `admin` / `user`, with `user` optionally pinned to one brand.

**Isolation is enforced in application code, not by the database.** There is no Postgres RLS.
Every query filters `tenant_id`; brand-scoped routes additionally carry the `requireBrandAccess`
preHandler. This has produced two real security defects already (see §7) and is the single most
important invariant to preserve.

---

## 2. The decision history, briefly

You need this because half the repo still describes GCP and you will otherwise assume that is
current.

1. The system was built for **GCP** — Cloud Run, Cloud SQL, Pub/Sub, GCS, Vertex AI, Identity
   Platform — by a contractor. Terraform for all of it exists in `infra/`.
2. That environment was **abandoned at handover** and every reference to it stripped. No GCP
   project was ever created by this team. **The system has never run in any cloud.**
3. **2026-08-06, owner decision:** do not stand up GCP at all. Go straight to AWS. A migration
   plan written before that decision survives at
   `docs/superpowers/plans/2026-08-06-aws-migration.md`, marked superseded — mine it for
   task-level detail, do not execute it.
4. **2026-08-07 (this session):** AWS discovery completed against a live account, and the three
   cloud-coupled libraries ported. That is where you are joining.

**Consequence to internalise:** `infra/`, and parts of `PLAN.md` and `SETUP.md`, accurately
describe a deployment that will never be built. They are kept because the GCP stack is the
clearest available specification of what each service needs. Do not treat them as the plan.

---

## 3. AWS: what was verified, and how

All of this was executed live on **2026-08-07** via CloudShell, and **re-verified on 2026-08-08
from the local machine** through the `psignal-dev` SSO profile. Commands and outputs are
reproducible; the discovery script in §3.5 re-runs them.

### 3.1 Account and identity

```
Account       290304998906
Principal     arn:aws:sts::290304998906:assumed-role/
              AWSReservedSSO_TesAiDevSandboxAdmin_31fa68d9bd45f53c/Wayne.Strydom@tes.com
Client region eu-west-2 (London)   — where our resources live
SSO region    eu-west-1            — where IAM Identity Center itself runs
```

**The client region and the SSO region are different, and both are correct.** `eu-west-1` is
only where Identity Center is hosted; storage, database and queues stay in `eu-west-2`. Getting
this wrong during `aws configure sso` fails harmlessly at client registration without contacting
any account.

> **Correction (2026-08-08): there is no IAM account alias.** This block previously read
> `290304998906 (alias: tesai-dev-sandbox)`. `aws iam list-account-aliases` returns `[]` —
> `tesai-dev-sandbox` is the **Organizations account name**, not an IAM alias. Nothing depends
> on this, but the guard's abort message prints the label, so it should be understood as a
> human name rather than something resolvable from the account.

Access is via **IAM Identity Center (SSO)**, so the working credential is a temporary session
role. Three consequences:

- Sessions expire. Re-authenticate with `aws sso login --profile psignal-dev`.
- **This role cannot be reused for CI** — GitHub Actions needs its own IAM role (Phase 6).
- **The session ARN is not an IAM principal ARN.** `iam:SimulatePrincipalPolicy` rejects it with
  `InvalidInput`, which silently broke §5 of the discovery script until 2026-08-08. Resolve the
  real role with `aws iam get-role --role-name AWSReservedSSO_…`; the SSO path embeds the
  **SSO** region and cannot be reconstructed by string manipulation.

#### The permission set is scoped to this account alone

`aws configure sso` reported, verbatim:

```
The only AWS account available to you is: 290304998906
The only role available to you is: TesAiDevSandboxAdmin
```

**This is a stronger guarantee than anything in this repository.** The sandbox rule is enforced
in our tooling by `_guard.sh`, `allowed_account_ids` and `check` blocks — but the permission set
means no other account is _offered_ in the first place. The risk the rule exists to prevent is
structurally closed at the identity layer, not merely policed.

The tooling still earns its place: it catches a stale `AWS_PROFILE`, credentials injected
through environment variables from somewhere else, and any future widening of the permission
set. Defence in depth, not redundancy — and **do not relax the guards on the strength of this**,
because a permission set is a configuration somebody else controls and can change without
telling us.

### 3.2 The account is shared — this shapes the design

> #### ⛔ `290304998906` is the ONLY account anything here may touch
>
> This sandbox sits inside a **TES enterprise AWS organisation under active scrutiny**. A stray
> command in a sibling or production account is not a recoverable mistake; it is an incident
> attributed to the owner. **Read-only counts** — a `describe`/`list` elsewhere in the
> organisation is still unauthorised access to that account.
>
> Never widen `allowed_account_ids`, add a provider alias or `assume_role` reaching another
> account, or touch Organizations, SCPs, root-level IAM or billing. If credentials resolve
> anywhere else: **stop, change nothing, tell the owner.**
>
> Enforced by [`../infra-aws/scripts/_guard.sh`](../infra-aws/scripts/_guard.sh), sourced by
> every script that calls AWS — read-only ones included. Its wrong-account, no-credential and
> override paths are covered by
> [`../infra-aws/scripts/test/guard.test.sh`](../infra-aws/scripts/test/guard.test.sh), which
> stubs the AWS CLI so the tests make no real call and need no credentials. CI fails a pull
> request if an AWS-calling script does not source the guard. Full rule in
> [`../DEVRULES.md`](../DEVRULES.md) and
> [`../infra-aws/CONVENTIONS.md`](../infra-aws/CONVENTIONS.md) §0.

`tesai-dev-sandbox` hosts several projects. The owner has full control inside it but **cannot
create accounts outside it.** So the design goal is not "make it work", it is **"make it
separable later"**. Concretely:

- Every resource named `psignal-<env>-*`. Nothing generic, nothing that could collide.
- **Our own VPC.** There is no default VPC in `eu-west-2` (verified: `describe-vpcs` returns
  nothing), so there is no CIDR to collide with and no shared default to land in by accident.
- Mandatory tags on everything, applied as Terraform defaults so a resource _cannot_ be created
  without them: `Project`, `Owner`, `CostCentre`, `Environment`, `ManagedBy=terraform`,
  `Expires`.
- **Activate those as cost allocation tags in Billing.** Without that, spend is not attributable
  and Fargate's continuous billing becomes an argument nobody can settle. **That activation is
  ACCOUNT-GLOBAL and therefore lives in its own root module, `infra-aws/account/`, not in
  `stack/`** — it is one switch per key for the whole account, so a project `terraform destroy`
  owning it would have deactivated the keys for every co-tenant workload, permanently, since
  activation does not backfill. Corrected 2026-08-08; the teardown script never touches it.
- IAM roles scoped by resource tag, so a bug in this system cannot reach another project's data.

Done properly, lifting Project Signal into a dedicated account later is a `terraform apply`
against a new account id, not a rewrite. **That is the highest-value property to protect and it
costs nothing now.**

**Two shared-account risks tagging does not solve.** Say them out loud rather than discovering
them: **service quotas are account-wide** (Fargate task limits, Bedrock TPM, VPC count — another
project's load test can throttle us and vice versa), and **Bedrock model access is account-wide**
(enabling a model is additive and harmless, but it is a change others see — do it deliberately,
not silently).

### 3.3 Existing state in the account

| Fact | Value | Why it matters |
| ---- | ----- | -------------- |

Re-verified 2026-08-08. Unchanged from the 2026-08-07 survey except where noted.

| Fact                                                     | Value                                                                               | Why it matters                                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPCs in `eu-west-2`                                      | **none**, not even a default                                                        | We create our own, no collisions. Region caps at 5                                                                                                                  |
| ECS clusters / RDS instances / Cognito pools / ECR repos | **none**                                                                            | Nothing of ours, and nothing of anybody else's, to collide with                                                                                                     |
| SQS queues                                               | **none**                                                                            | Same                                                                                                                                                                |
| S3 buckets                                               | **two, not ours** — `bedrock-bda-eu-west-2-…` and `bedrock-bda-eu-west-2-logging-…` | **New finding, 2026-08-08.** Bedrock Data Automation, belonging to another tenant of the sandbox. Confirms the account is shared _in practice_, and see spend below |
| OIDC providers                                           | **`gitlab.com` only**                                                               | GitHub's does not exist — we can create it. **An account allows only one provider per URL**, so if one appears later, reference it rather than creating a duplicate |
| IAM account alias                                        | **none** (`list-account-aliases` → `[]`)                                            | `tesai-dev-sandbox` is the Organizations account _name_, not an IAM alias — see §3.1                                                                                |
| Budgets                                                  | `monthly_tesai-dev-sandbox`, **$1,600/month**                                       | Do not touch it. Add a **tag-filtered** budget alongside. The limit was not recorded before; our $150 project budget is ~9% of it                                   |
| Spend at time of survey                                  | ~$44 month-to-date, ~$182 forecast, both rising                                     | Not compute — there are no VPCs. **The Bedrock buckets above confirm the earlier guess that this is Bedrock.** Our Fargate would be the first persistent compute    |

The presence of a `gitlab.com` OIDC provider suggests the department's CI standard is GitLab
while this repo is on GitHub. **Owner has confirmed: stay on GitHub.** Phase 6 therefore creates
GitHub's OIDC provider in the account.

#### Organisation context — new, 2026-08-08

The 2026-08-07 survey expected `AccessDenied` here. `describe-organization` in fact **succeeds**:

```
Organization        o-czz6h8lnm0
Management account  857154590661  (awsbillingroot@tesglobal.com)
Feature set         ALL
Policy types        SERVICE_CONTROL_POLICY — ENABLED
```

`describe-account` and `list-parents` remain `AccessDenied`, which is normal and expected from a
member account.

**Two things follow, and both matter.**

**SCPs are enabled above us.** That is the concrete reason `iam:SimulatePrincipalPolicy` is
necessary-but-not-sufficient: the simulator evaluates identity policies and does **not** evaluate
SCPs, so an `allowed` verdict can still be denied at runtime. The reversible IAM probe in §3.5 is
the only trustworthy test, and any Phase 2+ permission surprise should be read as a possible SCP
before it is read as a bug in our Terraform.

**The management account `857154590661` is the billing root for the whole of TES.** It is
categorically out of bounds — it is not merely another account, it is _the_ account. Nothing in
this repository may reference it, and the account-wide budget and cost allocation tag activation
both ultimately belong to whoever operates it.

### 3.4 Bedrock — verified working, and the ID is not obvious

```
$ aws bedrock-runtime converse --region eu-west-2 \
    --model-id eu.anthropic.claude-haiku-4-5-20251001-v1:0 \
    --messages '[{"role":"user","content":[{"text":"Reply with exactly: OK"}]}]'
→ "OK"   16 tokens   752 ms
```

**Three properties of that model id are load-bearing.** Get any of them wrong and it fails in a
way the error does not explain:

1. **It is an inference profile, not a model id.** The bare
   `anthropic.claude-haiku-4-5-20251001-v1:0` is rejected with _"Invocation of model ID … with
   on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference
   profile."_ Newer models are profile-only.
2. **`eu.` scopes routing to the EU.** Verified via `get-inference-profile`: it routes to
   `eu-west-2, eu-west-1, eu-west-3, eu-central-1, eu-north-1, eu-south-1, eu-south-2`.
   `global.` profiles also exist for the same models and route anywhere. **Note this is EU, not
   UK** — worth confirming against your residency requirement, though what crosses a border is
   public review text, not personal data. Storage, database and queues stay in `eu-west-2`
   regardless; the profile governs inference only.
3. **Model availability decays and is account-specific.** This project has already shipped a
   retired model id (`gemini-2.0-flash-001`) and one that never existed
   (`gemini-2.0-pro-001`). **Never write a model id from memory.** Re-run
   `aws bedrock list-inference-profiles` in the target account.

`REPORTER_MODEL` is deliberately left on Haiku rather than upgraded to something stronger:
nothing reads it until Epic 12, and shipping an unverified default is exactly how the two bad
Gemini ids got in.

#### Re-verified live, 2026-08-08

`aws bedrock list-inference-profiles --region eu-west-2` confirms the configured profile is real
and usable — not merely listed in a document:

```
eu.anthropic.claude-haiku-4-5-20251001-v1:0   EU Anthropic Claude Haiku 4.5   ACTIVE  SYSTEM_DEFINED
```

**Nine EU Anthropic profiles are ACTIVE in this account**, including materially stronger models
than the one configured:

```
eu.anthropic.claude-haiku-4-5-20251001-v1:0     <- SCORER_MODEL and REPORTER_MODEL today
eu.anthropic.claude-sonnet-4-5-20250929-v1:0
eu.anthropic.claude-sonnet-4-6
eu.anthropic.claude-sonnet-5
eu.anthropic.claude-opus-4-5-20251101-v1:0
eu.anthropic.claude-opus-4-6-v1
eu.anthropic.claude-opus-4-7
eu.anthropic.claude-opus-4-8
eu.anthropic.claude-opus-5
```

**This does not license changing either model id.** Haiku is the right choice for `SCORER_MODEL`:
it runs once per signal, so it is the cost-sensitive slot, and the scoring task is
classification against a fixed schema rather than reasoning. `REPORTER_MODEL` is the slot that
would benefit from a stronger model, and it is still read by nothing until Epic 12 — so the
decision belongs to whoever builds reporting, made against measured output quality rather than a
list of what happens to be available. Recording the options here is the point; acting on them
now would be exactly the unverified-default habit that shipped two bad Gemini ids.

Note also that `list-foundation-models` shows `anthropic.claude-haiku-4-5-20251001-v1:0` without
the `eu.` prefix. **That is the bare model id and it will be rejected at invoke time.** Being
listed there is not the same as being usable; the inference profile list above is the one to
copy from.

### 3.5 IAM — role creation is permitted

Probed for real, because the IAM policy simulator does not reliably account for
Service Control Policies:

```
aws iam create-role --role-name psignal-probe-delete-me --tags ... \
  --assume-role-policy-document '{"...":"Effect":"Deny"...}'   → succeeded
aws iam delete-role --role-name psignal-probe-delete-me        → succeeded
```

Role creation and tagging both work; no SCP blocks them. **CI can therefore use GitHub OIDC →
IAM role with no long-lived keys** — the direct equivalent of the Workload Identity Federation
design the GCP side used.

**The probe was NOT re-run on 2026-08-08, deliberately.** It is the one write in the discovery
script, role creation was already proven in this same account, and re-running it would put two
more IAM events in CloudTrail for no new information. Re-run it only when something changes that
could plausibly have altered the answer — an SCP change, a new permission set — or immediately
before Phase 6 needs the CI role.

#### The simulator in §5 never worked from an SSO session — fixed 2026-08-08

`iam:SimulatePrincipalPolicy` requires an IAM **principal** ARN. `sts:GetCallerIdentity` under
Identity Center returns a **session** ARN
(`arn:aws:sts::…:assumed-role/AWSReservedSSO_…/user@…`), which the API rejects outright with
`InvalidInput`. The section therefore produced nothing but an error on every run — including the
original Phase 0 run — and it went unnoticed because the script prints errors as findings rather
than aborting.

The script now resolves the real role with `aws iam get-role --role-name`, which works for SSO
permission sets and ordinary roles alike. String surgery on the session ARN is not sufficient:
the SSO role path is `role/aws-reserved/sso.amazonaws.com/<sso-region>/<name>` and embeds the
**Identity Center** region (`eu-west-1`), not the client region.

Result, 2026-08-08 — all twelve actions `allowed`:

```
iam:CreateRole  iam:AttachRolePolicy  iam:CreateOpenIDConnectProvider  ec2:CreateVpc
ecs:CreateCluster  rds:CreateDBInstance  s3:CreateBucket  sqs:CreateQueue
cognito-idp:CreateUserPool  ecr:CreateRepository  secretsmanager:CreateSecret
bedrock:InvokeModel
```

**Treat that as necessary, not sufficient.** §3.3 confirms SCPs are enabled in `o-czz6h8lnm0`,
and the simulator does not evaluate them. Every permission Phases 2–6 need is _identity-policy_
clear; whether an SCP denies one is only knowable by attempting it.

**To re-verify all of the above in a different account**, run
[`infra-aws/scripts/00-discover.sh`](../infra-aws/scripts/00-discover.sh). It is read-only apart
from one explicitly fenced, self-cleaning IAM probe behind `--test-iam`, and it now aborts before
its first call if the credentials are not the sandbox.

---

## 4. What the code looks like now

### 4.1 The three library ports are done

| Library                        | Was       | Is                                              | Notes                                                                          |
| ------------------------------ | --------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `libs/storage`                 | GCS       | **S3** (`@aws-sdk/client-s3`)                   | Was already split types/impl/factory, so this was one file plus a factory line |
| `libs/messaging`               | Pub/Sub   | **SQS** (`@aws-sdk/client-sqs`)                 | Publish side only — see §5                                                     |
| `libs/gemini` → **`libs/llm`** | Vertex AI | **Bedrock** (`@aws-sdk/client-bedrock-runtime`) | Renamed by use case, not provider                                              |

**There is deliberately no `CLOUD_PROVIDER` switch.** GCP was never provisioned and is
abandoned, so a factory with one live branch would be dead code that still had to clear the 80%
coverage gate. The _interfaces_ were kept — they are what made each swap a single-file change —
and the GCP implementations were deleted, not parked.

**All three take `AWS_ENDPOINT_URL` when set**, which points them at LocalStack, and nothing
otherwise, so the SDK's default chain resolves the real endpoint. Credentials and region always
come from that chain — the ECS task role in a deployed environment. **No code holds a key.**

### 4.2 The scoring rewrite is a correctness change, not a port

The Gemini scorer asked for "ONLY valid JSON", stripped ` ```json ` fences, and called
`JSON.parse`. When a model wrapped its answer in a sentence, that raised `PermanentScoringError`
— **which acks the message.** The signal was dropped permanently and silently.

The Bedrock client uses **forced tool use**: the model is given exactly one tool whose input
schema _is_ the shape we want, with `toolChoice` forcing it, so the provider returns a parsed
object. The fence-stripper and the `JSON.parse` are gone. **That failure class no longer
exists** — it is not handled, it is absent.

If you change `libs/llm`, preserve that property. Reintroducing prose-then-parse reintroduces
silent data loss.

### 4.3 Config is the authority on environment

`libs/config/src/index.ts` is the single source of truth for env vars — **not** `.env.example`,
which is documentation of it and is allowed to drift. Notable current state:

- `GOOGLE_CLOUD_PROJECT` is now **optional**. It was required, which meant _every app in the
  monorepo refused to boot without it_, including the four that never touched GCP. That would
  have been the first thing to stop an AWS container, with an error naming the variable but not
  the reason. It is still read by `firebase-admin` in `apps/api`; delete the line in the same
  change that removes the last firebase import.
- `ITEM_QUEUE_URL` / `REPORT_QUEUE_URL` have **no defaults and throw when unset**. An SQS URL
  embeds the account id and region, so no constant could stand in for one. This is the AWS form
  of the fix for gap #7, where publishing to a hardcoded topic that existed in no environment
  failed silently.
- `SCORER_MODEL` / `REPORTER_MODEL` default to the verified inference profile (§3.4).
- `DB_SOCKET_PATH` still exists and is Cloud-SQL-proxy-only. **It simplifies away on RDS** —
  delete it when the database lands.

### 4.4 Auth is still Firebase — the only remaining Google dependency

Five files: `apps/api/src/plugins/auth.ts`, `apps/api/src/lib/claims.ts`,
`apps/api/scripts/bootstrap-owner.ts`, `apps/web/src/lib/firebase.ts`, `apps/web/src/lib/auth.tsx`.

This is Phase 5 and it is the deepest change in the plan. **The invariant that must survive:**
`setUserClaims()` is called **inside the database transaction** that writes the `users` row, so
a claims failure rolls the row back. That atomicity was a fixed defect (gap #18). A Cognito port
that writes the row, commits, then calls the identity provider **silently reintroduces it, and
no existing test will fail.**

Authorisation reads **identity-provider custom claims, not the `users` table**. Whatever
replaces Firebase must populate `request.user.{role, tenantId, brandEntityId}` identically —
`requireRole` and `requireBrandAccess` both depend on it.

---

## 5. What is proven, and what is not

Be precise about this, because the distinction is where projects lie to themselves.

### Proven end to end, against real services (2026-08-07, local, LocalStack + Postgres)

| Step                                       | Evidence                                                        |
| ------------------------------------------ | --------------------------------------------------------------- |
| Ingest 52 items from the live BBC RSS feed | `{"signalsCreated":52,"signalsPublished":52}`                   |
| Raw payloads → S3                          | 52 objects, correct `tenant/brand/source/externalId` key layout |
| Read back out of S3                        | Real article text recovered                                     |
| Publish → SQS                              | 52 messages, body is a bare signal UUID                         |
| DB rows                                    | 52, all carrying `s3://…` refs                                  |
| Dedup                                      | Identical re-run created **0**                                  |
| Reconcile sweep                            | Found all 52 unscored, re-published                             |
| Rollup                                     | `{"brands":4,"rows":0}` — correct, nothing scored yet           |
| Logs                                       | Zero error-level lines, no 5xx                                  |

**This mattered.** There was never a GCS emulator, so `libs/storage`'s write path had only ever
met a mock and gap #4 was closed on faith. The reconcile sweep had never run against a real
queue. Both work.

### NOT proven — do not claim otherwise

- **Nothing has run in any cloud.** Not one line.
- **Scoring has never executed against a real model.** Local LocalStack does not emulate
  Bedrock. The `converse` smoke test proves the _account and model_ work; it does not prove
  `libs/llm` + `scorer.ts` produce a usable `sentiment_results` row. **That is the single most
  valuable thing for you to prove first.**
- **The SQS consumer does not exist.** `libs/messaging` covers the **publish** side only.
  `apps/sentiment-worker` still serves an HTTP route at `POST /pubsub/item` shaped like a
  Pub/Sub push envelope. Push→pull is a real model change, not a driver swap, and it is Phase 4.
- **Everything behind `AuthGate` has never been seen rendered.** That includes 63 of the 79 CSS
  token conversions done this session. A browser pass is a required checkpoint once sign-in
  works, not an optional follow-up.
- **No Terraform for AWS exists** beyond the discovery script.

---

## 6. The remaining plan

Locked decisions (owner, 2026-08-06/07): **ECS Fargate** compute, **Cognito** auth, **RDS
Postgres single instance**, **`eu-west-2`**, **GitHub** CI.

| Phase | Work                                                                                  | Needs the account?                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~0~~ | ~~Discovery~~                                                                         | ✅ **done** — §3                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ~~B~~ | ~~Port libraries behind interfaces~~                                                  | ✅ **done** — §4.1                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ~~1~~ | ~~Guardrails: tag defaults, name prefix, tag-filtered budget, teardown script~~       | ✅ **APPLIED 2026-08-08.** State bucket `psignal-dev-tfstate-290304998906` and budget `psignal-dev-monthly` ($150) both live and verified by reading AWS back, not state. ⚠️ **Cost allocation tag activation is impossible from this linked account** (payer-only). Owner decision 2026-08-08: tags are a nice-to-have and **gate nothing** — `10-preflight.sh` warns rather than fails. See `AWS-SETUP.md` for the platform-team request |
| ~~2~~ | ~~Foundation: VPC, RDS, S3, ECR, Secrets Manager~~                                    | ✅ **APPLIED 2026-08-08.** 39 resources. VPC `10.20.0.0/16`, 2 AZs, public + private subnets, **no NAT** (see `stack/vpc.tf` — the decision belongs to Phase 4). RDS `psignal-dev-postgres` 16.14, `db.t4g.micro`, encrypted, **not publicly accessible**, reachable only from the app security group. S3 `raw` + `reports`. ECR for api/web/ingestion/sentiment-worker, IMMUTABLE tags. DB credentials in Secrets Manager                 |
| 3     | **Thin vertical slice** — one brand, one RSS feed, one signal, ingest → score → read  | Yes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4     | Full stack: Fargate services, SQS + DLQs, EventBridge Scheduler, **the SQS consumer** | Yes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5     | Cognito, then the browser pass over views nobody has ever seen                        | Yes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6     | CI/CD: GitHub OIDC → IAM role                                                         | Yes                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7     | Delete `infra/` and the last Google dependencies                                      | No                                                                                                                                                                                                                                                                                                                                                                                                                                         |

> ### Cost allocation tags gate nothing — owner decision, 2026-08-08
>
> An earlier revision made the inactive-tag condition a hard `FAIL` in `10-preflight.sh` and
> declared Phase 2 blocked on it. **The owner overruled that, and the reasoning is sound:**
> activation is impossible from this linked account (payer-only), so failing on it would have
> blocked every apply indefinitely on something we cannot fix. Tags are a nice-to-have.
> Delivery does not wait on them.
>
> The check is now a **WARN**. The account guard is untouched and remains a hard abort — that
> distinction is the point: one is a cost-reporting convenience, the other is the sandbox
> boundary, and only one of them is allowed to be softened.
>
> **Attribution is not actually lost meanwhile.** The sandbox contains no VPC, RDS, ECS or ECR
> outside this project, so Cost Explorer's `SERVICE` grouping attributes all of it to us with no
> tags at all — and those are the expensive things. Only S3, SQS, Secrets Manager and Bedrock are
> shared with the co-tenant Bedrock Data Automation workload:
>
> ```bash
> aws ce get-cost-and-usage --granularity MONTHLY --metrics UnblendedCost \
>   --group-by Type=DIMENSION,Key=SERVICE --time-period Start=<date>,End=<date>
> ```
>
> The platform-team request in [`AWS-SETUP.md`](AWS-SETUP.md) § Phase 1 still stands and is still
> worth sending — it is the only way to split the shared services — but it is a background
> errand, not a dependency.

**Phase 3 is deliberately early and you should resist the urge to defer it.** The superseded
plan put the first true end-to-end run at Phase 5 of 7. That is indefensible when nothing has
ever executed in a cloud: the first real run is the highest-information moment in the whole
project, and everything built before it rests on assumptions.

**Fix gap #3 during Phase 4.** `/ingest/dispatch` fans out in-process via `Promise.allSettled`.
SQS was supposed to dissolve that gap — it only does if the dispatcher actually enqueues per
`(brand × source)`. Two properties outlive the choice of queue: a dispatch across many brands
runs inside one HTTP request and can exceed the platform timeout, and a failed source is counted
in `failed` and dropped rather than retried.

**Cost reality:** Fargate does not scale to zero. The GCP costing (~$13–15/mo) rested entirely
on Cloud Run doing so. Five idle services bill continuously, in an account whose spend is
already visible to others. The budget alarm in Phase 1 is not ceremony.

---

## 7. What must not be regressed

Fifteen defects were closed to reach this point, several found by running the system rather than
testing it. A re-platform is exactly the change that silently undoes them.

| Property                                                                      | Note                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand-scoped routes enforce `brandEntityId`                                   | Via `requireBrandAccess`. **It is opt-in per route and nothing fails when a new route omits it** — that is how `GET /brands/:id` kept the hole until 2026-08-07. Add it to every new `/brands/:id...` route |
| User row and identity-provider claim are atomic                               | §4.4. The Cognito trap                                                                                                                                                                                      |
| `PATCH /admin/users/:id` reads the target first and 404s for a foreign tenant | Not confirming a row's existence is deliberate                                                                                                                                                              |
| Cursor pagination has deterministic `ORDER BY` + composite keyset             | `(published_at, id)`; neither is a stable sort key alone                                                                                                                                                    |
| Raw payloads written to object storage **before** the row insert              | So `raw_storage_ref` can never point at a missing object                                                                                                                                                    |
| Queue/topic names come from the environment, never a constant                 | Gap #7                                                                                                                                                                                                      |
| Worker failures classified permanent vs transient                             | So the DLQ can fire. **Do not swallow errors in the SQS consumer**                                                                                                                                          |
| `dimension_scores` written by the rollup; `libs/scoring` stays pure           | It needs no AWS changes at all                                                                                                                                                                              |
| `NEXT_PUBLIC_*` supplied as Docker **build args**                             | Inlined by `next build`; a runtime env var can never reach the client                                                                                                                                       |
| Node 20 everywhere                                                            | On Node 24, `next build` fails with a null React dispatcher three layers from the cause                                                                                                                     |

Two traps that are not defects but have each cost real time:

- **Never interpolate a JS `Date` into a raw drizzle `sql` fragment.** It bypasses the
  timestamptz serialiser and Postgres rejects the value at runtime. Shipped twice; every mocked
  test passed both times because a mocked database never renders SQL. Copy
  `apps/api/test/routes/keyset.test.ts`, which renders through the real `PgDialect`.
- **Fastify strips undeclared response fields.** `fast-json-stringify` silently removes any
  property the response schema does not declare. `GET /brands/:id/signals` returned
  `items: [{}, {}]` for exactly this reason and no unit test caught it.

---

## 8. Repository disposition

- **`infra/`** — the GCP Terraform. Keep read-only until `infra-aws/` reaches parity, then
  delete in one commit. It is the clearest available specification of what each service needs
  and re-deriving it from prose would be wasteful. It will never be applied.
- **`docs/superpowers/plans/2026-08-06-aws-migration.md`** — superseded, marked as such. Mine
  the Terraform module breakdowns and the Cognito task; do not execute the phase order.
- **`docs/SETUP.md`** — GCP setup, superseded, banner at the top. Kept for the same reason as
  `infra/`.
- **`apps/web/src/lib/data.ts`** — 588 lines of mock data for a fictional bank, still rendering
  in the Roadmap and Report views. Deferred by owner decision until AWS is running. **No new
  code may depend on it.**

---

## 9. How to verify anything

**The gate, required before any completion claim:**

```bash
corepack yarn lint && corepack yarn typecheck && corepack yarn test
```

**Baseline, verified 2026-08-07:** lint green across **13 projects**, typecheck across **12**,
**309 tests across 11 projects** — api 105, source-adapters 52, scoring 43, web 23, ingestion 22,
sentiment-worker 15, storage 13, messaging 12, config 11, llm 10, report-worker 3.
(`@project-signal/db` has only a `build` target, hence 13/12/11.)

> ### ⚠️ A green gate can be a hollow one — check the task count, not the exit code
>
> Nx infers `lint` and `test` targets from `@nx/eslint` / `@nx/vite`. If it computes its project
> graph while `node_modules` is incomplete — a fresh clone where something ran before
> `yarn install` finished — those plugins cannot load and **Nx caches a graph with zero `lint`
> and `test` targets.** `yarn lint` then prints `No tasks were run` and **exits 0**. The entire
> gate passes having checked nothing.
>
> The tell is the summary line: **13 projects** for lint, **12** for typecheck. The fix is
> `nx reset` (on Windows it reports `EPERM` on `.nx/workspace-data` while the daemon holds the
> directory, and still clears enough to work).

> ### ⚠️ `nx run-many -t test` is unreliable here
>
> Documented as finishing in ~2 minutes with `--parallel=1`. On this machine it ran **35+
> minutes with no output and 57 node processes** before being killed. What works, reliably and
> in well under a minute total, is driving vitest per project and skipping Nx orchestration:
>
> ```bash
> cd apps/api && corepack yarn vitest run --coverage    # 105 tests, ~12s
> ```
>
> The tests are fast; the orchestration is the problem. Do not "fix" this by weakening the gate.

**The local stack** — this is how the end-to-end run in §5 was performed:

```bash
docker compose up -d                 # Postgres 16 (:5432) + LocalStack (:4566, s3+sqs)
cp .env.example .env
corepack yarn nx run api:dev         # MIGRATIONS APPLY ON API STARTUP — boot this before seeding
corepack yarn db:seed
corepack yarn nx run ingestion:dev
curl -X POST localhost:8081/ingest -H 'Content-Type: application/json' \
     -d '{"sourceConfigId":"<the rss one>"}'
```

`scripts/localstack-init.sh` creates the bucket, both queues and both DLQs on boot, with
`maxReceiveCount: 5` matching the intended deployed redrive policy — so the local stack fails
the same way the real one will.

**Three environment traps that have each burned time here:**

- **`yarn` is not on `PATH`** in this environment; it resolves through `corepack yarn` (Yarn
  4.9.2). Node on `PATH` may be v24 — fine for tests, **fatal for `next build`** (gap #17). Build
  the web app in Docker (`node:20-alpine`) if your host Node is newer.
- **Port 5432 and 8080 have both been found occupied** by unrelated applications on a developer
  machine. Always assert on the **body shape** of a health check, not the status code — an
  "API is up" check once hit a different app entirely and was only caught because a 403 body
  turned out to be an HTML SPA.
- **`corepack yarn install` fails under `CI=1`** after any `package.json` change, because that
  implies `--immutable`.

---

## 10. Open questions for the owner — ANSWERED 2026-08-07

All five were put to the owner at the start of Phase 1. Recorded here with their answers, since
the reasoning matters more than the choice.

| #   | Question                                                  | Answer                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cost centre code, and `Environment` = `dev` or `sandbox`? | **`CostCentre = tesai-dev-sandbox`** as a placeholder — no formal code exists yet. **`Environment = dev`**, giving `psignal-dev-*`. The tag names _our_ environment, not the account, so the stack lifts into a dedicated account later as an account-id change rather than a rename — the property §3.2 calls the highest-value one to protect           |
| 2   | Same account as `290304998906`?                           | **Yes, confirmed.** Every fact in §3 stands. Model ids are still re-verified at the moment of use                                                                                                                                                                                                                                                         |
| 3   | EU-wide inference acceptable?                             | **Yes.** What crosses a border is public review text; storage, database and queues stay in `eu-west-2`                                                                                                                                                                                                                                                    |
| 4   | `report-worker` on Fargate?                               | **Omit it** until Epic 12. A health-check skeleton as a permanently-running task is pure cost. Adding it back is a one-file change                                                                                                                                                                                                                        |
| 5   | Postgres RLS?                                             | **Add it in Phase 2 as defence-in-depth, keeping every existing `tenant_id` filter in place.** Belt and braces — no query is deleted, so a wrong policy cannot silently widen access, and the greenfield database is the only cheap moment to do it. Two defects of this class are already in the register (#5, #5b) plus the cross-tenant `PATCH` in #12 |

#### `CostCentre = tesai-dev-sandbox` is the settled answer — owner, 2026-08-08

An earlier revision of this section called the placeholder "a live debt, not a decision", on the
assumption that a real charge code existed somewhere and simply had not been issued to us. **The
owner has confirmed that is not the case, and the value is correct as it stands.**

The reasoning, which is what matters if someone later thinks this needs fixing: `290304998906`
is the account where the department's **canary projects, prototypes and spikes** all live. There
is no per-project charge code because these workloads are not charged per project — they share
one sandbox. `tesai-dev-sandbox` therefore names the thing actually paying, which is precisely
what a cost centre is for.

**This does not weaken attribution, because `CostCentre` was never the tag doing that work.**
Separating this project's spend from its co-tenants' is the `Project` tag's job, and that is the
one the budget filters on (`user:Project$project-signal`). All six keys are activated so every
dimension is queryable in Cost Explorer, but `Project` is the discriminator.

Revisit only if the department introduces real per-project charge codes, or if Project Signal
moves out of the shared sandbox into a dedicated account — at which point the account id changes
anyway and this value is reviewed with it.

#### Budget headroom — owner, 2026-08-08

The account budget reads **$1,600/month** (§3.3). The owner puts the working ceiling at "around
two thousand" and can raise it on request, and does not expect this project to approach it: our
steady state is costed at ~$109 with a $150 alarm, roughly 9% of the account limit.

**The point of that headroom is that it buys room to do this properly**, including a
deliberately torn-down test run if one is needed, rather than pressure to get everything right
on a single attempt. It is not licence to leave things running — `Expires` tags and
`scripts/99-teardown.sh` exist exactly so that a test can be proven gone afterwards.

### New question, raised by Phase 1

**No cross-repo convention existed for the shared account**, and the owner has confirmed several
repositories will be hosted in it. One is now proposed in
[`../infra-aws/CONVENTIONS.md`](../infra-aws/CONVENTIONS.md): prefix and CIDR registry, the six
PascalCase tags, one budget and one VPC per project, and the two risks tagging does not solve.

**The sharpest constraint it surfaces: the default VPC quota is 5 per region.** §3.3 records
this as a footnote to "we create our own"; with several projects each taking a VPC it is a real
ceiling, and reaching it is a quota-increase request rather than a config change.

---

## 11. Standing rules you will be held to

Summarised from [`DEVRULES.md`](../DEVRULES.md) — read the original; this is a pointer.

- **Verify, never assume.** Every factual claim names the file, command or query that produced
  it. This overrides everything else in this repo, including this document.
- **No fabricated columns, env vars, APIs or behaviours.** The Drizzle schema in
  `libs/db/src/schema/*.ts` is the source of truth for the database; `libs/config/src/index.ts`
  for the environment.
- **Model ids and cloud service availability decay.** They are the single most common source of
  confidently-wrong output in this repo. Verify against the live API at the moment of use.
- **Definition of done** is proven working end to end, to production-release standard, with the
  proof stated. Not "tests pass". Not "should work".
- **Zero technical debt.** A defect found is a defect fixed, not appended to a register.
- **Work autonomously** once underway; ask everything you need upfront.
- **Migrations are generated, never hand-written.** Edit `libs/db/src/schema/*.ts`, run
  `corepack yarn db:generate`; the `.sql`, the `meta/` snapshot and the `_journal.json` entry all
  commit together. Never edit an applied migration.
- **`commitlint` enforces a closed scope list** in `commitlint.config.js`. It currently includes
  `llm` and `storage`; a new lib needs its scope added in the same change or the commit is
  rejected by the hook.
