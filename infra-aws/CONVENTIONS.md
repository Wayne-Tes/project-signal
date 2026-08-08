# Shared-account conventions — `tesai-dev-sandbox` (290304998906)

**Status:** proposed standard, 2026-08-07. Written because no cross-repo convention exists yet
and several repositories are expected to be hosted in this one account.
**Scope:** every workload deployed into the shared sandbox, not only Project Signal.

> **Why this document exists.** The account is shared and cannot be split — the owner is admin
> inside it but cannot create accounts outside it. So the goal is not "make it work", it is
> **make each project separable later**. Done properly, lifting a project into its own account
> is a `terraform apply` against a new account id rather than a rewrite. Done badly, it is an
> archaeology exercise across resources nobody can attribute.
>
> Project Signal implements all of this in `infra-aws/`. Where a rule below sounds abstract,
> that tree is the worked example.

---

## 0. ⛔ The sandbox boundary — read before anything else

**This account sits inside a TES enterprise organisation under active scrutiny. The sandbox
`290304998906` is the ONLY account any tooling, script, agent or human following this document
may touch.**

A mistake here is not a broken deploy that gets rolled back — it is an incident in someone
else's production environment, attributed to the account owner.

- Confirm `aws sts get-caller-identity` resolves to `290304998906` before every session, and
  again after any profile, role or credential change.
- **Read-only counts.** A `describe` or `list` against a sibling or production account is still
  unauthorised access to that account. There is no safe reconnaissance outside the sandbox.
- **Never** add a provider alias, `assume_role` block, or second profile that reaches another
  account. Every root module pins `allowed_account_ids`; **do not remove or widen it.**
- **Never** touch Organizations, SCPs, root-level IAM, or billing settings. Those belong to the
  organisation. The account-wide budget `monthly_tesai-dev-sandbox` is **read-only to us**.
- **If credentials resolve anywhere else: stop, change nothing, and tell the account owner.**
  Do not improvise a fix and do not retry with different credentials.

This is enforced, not merely asked for: `infra-aws/scripts/_guard.sh` aborts before the first
API call and is sourced by every script that talks to AWS. Its wrong-account and
no-credential paths are both tested. Any new script must source it too.

---

## 1. The five rules

Inherited from [`docs/AWS-SETUP.md`](../docs/AWS-SETUP.md) and generalised to any project.

1. **Prove the account first.** Every root module pins `allowed_account_ids`; every script
   resolves `sts get-caller-identity` and aborts on a mismatch. Nobody should be one mistyped
   profile away from provisioning into a colleague's workload.
2. **One prefix, everywhere.** Every resource is `<prefix>-<env>-<resource>`. No generic names.
3. **Tags are mandatory, not decorative.** Applied as Terraform provider defaults, so a resource
   _cannot_ be created without them.
4. **Cost controls precede spend.** A tag-filtered budget exists before the first billable
   resource.
5. **Teardown is written before build-up**, and it verifies by independent inventory rather
   than trusting Terraform state.

---

## 2. Naming

```
<prefix>-<environment>-<resource>[-<qualifier>]
```

- `prefix` — 2–12 lower-case alphanumerics identifying the **project**. Registered in §6.
- `environment` — the project's _own_ environment (`local`, `dev`, `staging`, `prod`).
  **Not the account's nature.** Do not use `sandbox`: it encodes which account you happen to be
  in today into resource names that are immutable once created, which is precisely what breaks
  the separability goal.
- Lower-case throughout, because S3 bucket names forbid upper case and a split convention is
  worse than a lower-case one.

Examples from Project Signal: `psignal-dev-tfstate-290304998906`, `psignal-dev-monthly`,
`psignal-local-raw` (the LocalStack bucket, already shipping in `scripts/localstack-init.sh`).

Keep the prefix short. Several AWS names are length-limited — ALB target groups cap at 32
characters, IAM roles at 64 — and a long prefix is discovered to be a problem only once you are
deep into a stack.

---

## 3. Tags

Six keys, **PascalCase**, on every resource, applied as provider `default_tags`:

| Key           | Value                      | Why                                                                   |
| ------------- | -------------------------- | --------------------------------------------------------------------- |
| `Project`     | e.g. `project-signal`      | The discriminator between co-tenant workloads. What budgets filter on |
| `Owner`       | a reachable person or team | Answers "whose is this" without a ticket                              |
| `CostCentre`  | the charge code            | What makes spend attributable to a budget holder                      |
| `Environment` | `dev`, `staging`, `prod`   | The project's own environment                                         |
| `ManagedBy`   | `terraform`                | Distinguishes managed resources from console experiments              |
| `Expires`     | ISO-8601 date              | What makes a teardown sweep safe to point at stale resources          |

**Casing is load-bearing.** AWS tag keys are case-sensitive and cost allocation tags are
activated by exact key, so `Project` and `project` are two different tags and only one of them
will be attributed.

**Activate all six as cost allocation tags in Billing.** Until a key is `Active`, Cost Explorer
and Budgets cannot see it — a budget filtered on an inactive key matches nothing and reports a
perfectly healthy **$0**. Activation also **does not backfill**: it applies from activation
forward only. Do it before the first billable resource, not after.

> In an AWS Organization, activation is normally reserved to the **management account**. If
> `ce:UpdateCostAllocationTagsStatus` is denied, the platform team must activate the keys
> centrally — once, for all six, benefiting every project in the account.

> ### ⚠️ Activation is ACCOUNT-GLOBAL. No project may own it.
>
> There is one activation switch per tag key **for the whole account**, not one per project.
> A project that manages `aws_ce_cost_allocation_tag` in its own Terraform state creates three
> problems, all of which hit _other_ teams rather than the one that caused them:
>
> - **`terraform destroy` deactivates the keys for everybody.** A project tearing itself down
>   silently breaks cost attribution for every co-tenant workload.
> - **The damage is permanent, not temporary.** Activation applies forward only, so spend
>   incurred while a key was inactive is unattributable for good.
> - **Two projects managing it will fight**, each apply reverting the other's view of reality.
>
> **The rule: an account-scoped resource never lives in a project-scoped state file.** Project
> Signal implements this as a separate root module, `infra-aws/account/`, with its own state
> and `prevent_destroy` on every key. **Reference it; do not copy it** — see §7.

---

## 4. Isolation

- **Own VPC per project.** There is no default VPC in `eu-west-2`, so there is nothing to land
  in by accident — but only if each project creates its own rather than borrowing a neighbour's.
- **Non-overlapping CIDRs**, registered in §6. Two projects that never peer today may need to
  tomorrow, and overlapping ranges make that impossible without renumbering.
- **⚠️ The default VPC quota is 5 per region.** With several repos each taking one, this is a
  real ceiling and not a theoretical one. Reaching it is a quota-increase request, so plan the
  allocation rather than discovering the limit.
- **IAM roles scoped by resource tag**, so a bug in one project cannot reach another's data.
  Role names carry the prefix too.
- **One Terraform state bucket per project**, keyed per environment
  (`env/<environment>/terraform.tfstate`). Use S3 native locking (`use_lockfile = true`);
  DynamoDB-based locking is deprecated upstream and needs no table.

### Two risks tagging does not solve

Say these out loud rather than discovering them:

- **Service quotas are account-wide.** Fargate task limits, Bedrock TPM, VPC count, Elastic IPs.
  Another project's load test can throttle yours, and yours can throttle theirs.
- **Bedrock model access is account-wide.** Enabling a model is additive and harmless, but it is
  a change other tenants see. Do it deliberately, not silently.

---

## 5. Cost

- **One tag-filtered budget per project**, named `<prefix>-<env>-monthly`.
- **Never modify the account-wide budget.** `monthly_tesai-dev-sandbox` belongs to whoever runs
  the sandbox. Add alongside it.
- Alert on **`FORECASTED` as well as `ACTUAL`**. Anything that does not scale to zero — ECS
  Fargate, RDS, NAT gateways, ALBs — bills continuously, so the trajectory tells you about a
  mistake in week one and the total tells you in week four.
- Prefer **VPC endpoints over a NAT gateway** where the traffic allows. A NAT gateway is roughly
  $33/month before a byte crosses it, which on a small stack can exceed the compute it serves.

---

## 6. Registry

Maintained here until something better exists. **Add a row before you apply**, not after.

| Project        | Prefix    | VPC CIDR                             | Repository                 | Owner                 |
| -------------- | --------- | ------------------------------------ | -------------------------- | --------------------- |
| Project Signal | `psignal` | `10.20.0.0/16` _(proposed, Phase 2)_ | `Wayne-Tes/project-signal` | wayne.strydom@tes.com |
| _next project_ | —         | `10.21.0.0/16` suggested             | —                          | —                     |

Allocating `/16`s from `10.20.0.0/16` upward leaves `10.0.0.0/16`–`10.19.0.0/16` clear of the
range, which keeps this scheme from colliding with anything pre-existing or with a corporate
network that commonly occupies `10.0.x`.

---

## 7. Adopting this in a new repo

1. Copy `infra-aws/bootstrap/` and `infra-aws/stack/versions.tf`; change `project`,
   `project_prefix` and the CIDR.
2. **Do NOT copy `infra-aws/account/`.** It is account-global and already applied — copying it
   would give two Terraform states ownership of the same six switches, and they would fight.
   Assume the six keys are already Active and verify with step 4; if they are not, ask, rather
   than activating them from your project.
3. Copy `infra-aws/scripts/` — including `_guard.sh`, which **every** script that calls the AWS
   CLI must source, read-only ones included.
4. Register the prefix and CIDR in §6 above.
5. Run `infra-aws/scripts/10-preflight.sh` — it checks the account, the cost allocation tags and
   prefix collisions before anything is created.
6. Apply bootstrap, then your budget, **then** everything else.
7. Ship the teardown script in the same change as the first billable resource, not later — and
   scope it to your own prefix and state, never to anything account-global.
