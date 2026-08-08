# Owner actions — things only Wayne can do

**Purpose.** This is the one sanctioned exception to the zero-technical-debt rule, agreed
2026-08-08 so that autonomous work is not blocked by items requiring the owner's hands. A defect
**I** can fix is fixed on the spot and never lands here. This file holds only what needs the
owner: a console form, a credential, a GitHub setting, a conversation with another team.

**How to use it:** work top to bottom. Item 1 blocks a whole feature; the rest do not block
anything I am building.

---

## 1. 🔴 BLOCKING — Submit the Anthropic use case form in Bedrock

**What:** AWS Console → **Amazon Bedrock** (region **eu-west-2**) → **Model access** → Anthropic
→ submit the **use case details** form. It asks who you are and what you are building; it is a
short form, not an approval process, and access is typically granted within minutes.

**Why it is blocking:** every Anthropic model invocation fails until it is done:

```
$ aws bedrock-runtime converse --region eu-west-2 \
    --model-id eu.anthropic.claude-haiku-4-5-20251001-v1:0 ...
ResourceNotFoundException: Model use case details have not been submitted for this
account. Fill out the Anthropic use case details form before using the model.
```

**There is no way around it and no alternative model.** `eu-west-2` has **nine** EU inference
profiles and all nine are Anthropic. The only other EU profiles in the region are
`eu.cohere.embed-v4:0` (embeddings, not generation) and `eu.twelvelabs.pegasus-1-2-v1:0`
(video). Routing to a different provider would mean leaving the EU, which is a data-residency
decision, not a workaround.

**What it blocks:** sentiment scoring — the step that turns ingested signals into
`sentiment_results`. Everything either side of it (ingestion → S3 → SQS, and the read/rollup/
dashboard path) is unaffected and is being built and tested regardless.

> **This contradicts [`HANDOVER.md`](HANDOVER.md) §3.4**, which records the same `converse` call
> succeeding in this account on 2026-08-07, returning "OK" in 752 ms. As of 2026-08-08 it fails
> with the error above. I cannot establish which of the two is the anomaly — whether access was
> reset, whether the form requirement is new, or whether the original note was recorded from a
> different context. **The current behaviour is what governs**, and §3.4 has been annotated
> rather than deleted, because a doc that claims something works when it does not is worse than
> no doc at all.

**Verify it worked** — this should print `OK`:

```bash
aws bedrock-runtime converse --region eu-west-2 \
  --model-id eu.anthropic.claude-haiku-4-5-20251001-v1:0 \
  --messages '[{"role":"user","content":[{"text":"Reply with exactly: OK"}]}]' \
  --query 'output.message.content[0].text' --output text
```

---

## 2. 🟠 Branch protection on `main`

**What:** GitHub → repo → Settings → Branches → add a rule for `main`:

- Require a pull request before merging
- Require status checks: **`CI`** and **`Terraform Check — infra-aws`**
- **Block force pushes** and **block branch deletion**

**Why:** nothing in the repository can enforce this, and `CLAUDE.md` now forbids force-pushing
and direct commits to `main`. Until the setting exists, that rule is honour-based — which is
precisely the "a control that depends on remembering is not a control" problem that the account
guard was fixed for.

---

## 3. 🟠 Confirm the commit email is verified on GitHub

**What:** GitHub → Settings → Emails → confirm `wayne.strydom@tes.com` is present and verified.

**Why:** commits are authored as `Wayne Strydom <wayne.strydom@tes.com>`. If that address is not
verified on the `Wayne-Tes` account, GitHub will not attribute the commits to you — they will
show as an unlinked author, which defeats the point of setting the identity.

---

## 4. 🟡 Ask the platform team to activate cost allocation tags

**What:** send the ready-written request in [`AWS-SETUP.md`](AWS-SETUP.md) § Phase 1 to whoever
operates management account `857154590661`. Six keys: `Project`, `Owner`, `CostCentre`,
`Environment`, `ManagedBy`, `Expires` — **case-sensitive**.

**Why it is not blocking:** you have ruled tags a nice-to-have (2026-08-08), and Cost Explorer's
`SERVICE` grouping already attributes the expensive resources to this project, because nothing
else in the sandbox uses VPC, RDS, ECS or ECR. Activation only becomes necessary to split the
**shared** services — S3, SQS, Secrets Manager and Bedrock — from the co-tenant Bedrock Data
Automation workload.

---

## 5. 🟡 Ingestion API keys, when real sources are wanted

**What:** an **Apify** API token and a **YouTube Data API v3** key, dropped into the Secrets
Manager entries Terraform creates for them.

**Why it is not blocking:** the **RSS adapter needs no key at all**, which is why it is the
source used for every end-to-end test. Without these two, Google Reviews, App Store, Play Store
and YouTube ingestion cannot fetch — the rest of the system is unaffected.

---

## 6. 🟡 Decide the hostname for the shared URL

**What:** whether the team-facing URL is the raw ALB DNS name, or a proper hostname under a TES
domain (which needs a Route 53 zone or a DNS record from whoever runs the domain, plus an ACM
certificate).

**Why it matters:** an ALB's own DNS name only serves **HTTP**, and browsers will flag the
sign-in page as insecure. HTTPS needs a certificate, and a certificate needs a domain you
control. I will stand the stack up on the ALB name so it is testable immediately; moving to a
real hostname later is a certificate plus a listener rule, not a rebuild.
