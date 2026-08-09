# Owner actions — things only Wayne can do

**Purpose.** This is the one sanctioned exception to the zero-technical-debt rule, agreed
2026-08-08 so that autonomous work is not blocked by items requiring the owner's hands. A defect
**I** can fix is fixed on the spot and never lands here. This file holds only what needs the
owner: a console form, a credential, a GitHub setting, a conversation with another team.

**How to use it:** work top to bottom. Item 1 blocks a whole feature; the rest do not block
anything I am building.

---

## 1. ✅ DONE — Anthropic use case form submitted

> **UPDATE 2026-08-09T10:20Z — form submitted, and `agreementAvailability` is NOT trustworthy.**
>
> The Anthropic use case form was submitted for `290304998906` (Tes Global, Education, noting the
> existing enterprise agreement with Anthropic). `get-use-case-for-model-access` now returns the
> submitted form rather than an error.
>
> **Haiku 4.5 and Sonnet 4.5 invoke successfully — while `get-foundation-model-availability`
> still reports `agreementAvailability.status: NOT_AVAILABLE` for both.** That field is either
> lagging or does not mean what its name suggests. It joins `list-inference-profiles` on the list
> of checks that look authoritative and are not.
>
> **There is exactly one reliable test: invoke the model.** That is now the third time a weaker
> signal has been believed here and been wrong. Do not record a model id as verified on the
> strength of anything else.
>
> Opus 4.5, Sonnet 4.6 and Opus 4.6 were still refusing at the time of writing — likely still
> propagating. Re-invoke before assuming either way.
>
> All three model slots now default to `eu.anthropic.claude-haiku-4-5-20251001-v1:0`.
> Sonnet 5 and Opus 5 never required the form and remain available as a fallback.



> **Downgraded from 🔴 BLOCKING on 2026-08-09.** Two profiles — `eu.anthropic.claude-sonnet-5`
> and `eu.anthropic.claude-opus-5` — **do** answer in this account, so nothing is blocked. Every
> service now defaults to Sonnet 5. Submitting the form re-opens the cheaper and faster profiles,
> which matters for the scorer specifically: it runs once per signal, and Sonnet 5 costs
> materially more per call than the Haiku it replaced.
>
> **Diagnosis corrected 2026-08-09.** This was first recorded as access being "tightened
> underneath us" during the working day — a guess, from watching models answer at 22:50 and
> refuse by 23:39. `get-foundation-model-availability` gives the actual reason:
>
> | Model | `agreementAvailability.status` |
> | --- | --- |
> | Sonnet 5, Opus 5 | `AVAILABLE` |
> | Haiku 4.5, Sonnet 4.5, Opus 4.5, Sonnet 4.6, Opus 4.6 | `NOT_AVAILABLE` |
>
> Every one of them is `AUTHORIZED`, `entitlementAvailability: AVAILABLE` and
> `regionAvailability: AVAILABLE`. The single differing field is the **agreement** — the
> Anthropic use case form. The newer models do not require it; the older ones do, and AWS
> appears to have moved them behind it during that evening.
>
> So this is not instability and it will not lapse again on its own: it is one form, unsubmitted.
> `aws bedrock get-use-case-for-model-access --region eu-west-2` returns "You have not filled out
> the request form." Submitting it unblocks all five older models at once.
>
> Verify with:
> `aws bedrock get-foundation-model-availability --region eu-west-2 --model-id <id>`
>
> **Verified 2026-08-08T23:39Z** by invoking each EU Anthropic profile in `290304998906`:
>
> | Profile | Result |
> | --- | --- |
> | `eu.anthropic.claude-sonnet-5`, `eu.anthropic.claude-opus-5` | answered |
> | Haiku 4.5, Sonnet 4.5, Opus 4.5, Sonnet 4.6, Opus 4.6, and the rest | `ResourceNotFoundException` — use case details |
>
> Six of the blocked profiles were still answering at ~22:50 the same evening. **Account-level
> access is being changed while we work**, and this is a shared sandbox, so a co-tenant project
> sees the same change at the same moment.
>
> **`list-inference-profiles` cannot verify this.** Every blocked profile is still listed by it.
> Only an invoke tells you whether this account may use a model — which is why the entry below
> was recorded as blocking on the strength of a listing, and why config comments now name the
> invoke command and its timestamp instead.

### Original entry, retained

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

## 1b. 🟢 READY FOR YOU — sign in to the dashboard

**The stack is live.** Your owner account exists and Cognito has emailed a temporary password to
`wayne.strydom@tes.com`.

```
http://psignal-dev-alb-459312973.eu-west-2.elb.amazonaws.com
```

Sign in with the temporary password. Cognito will immediately require a new one — that is
expected, not a fault: the pool is admin-create-only, so **every** user meets a forced password
change on first sign-in, and the sign-in form has a step for it. Minimum 12 characters, upper and
lower case, a number and a symbol.

**Your tenant already exists, so there is nothing to set up after that.** Your account carries:

| Claim             | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| `custom:role`     | `admin`                                                 |
| `custom:tenantId` | `44483769-fd65-4c08-a642-1534e66d6c20` — tenant **TES** |
| Owned brand       | **TES** (`301d4aa1-9c94-4118-949d-f2571f345f49`)        |

`admin` manages users and every brand in the tenant, which is what day-to-day use needs. It
cannot create _additional_ tenants — that is `owner`, and if you want a second tenant later,
say so and it is a one-line attribute change.

Your `users` row was written in the same transaction as the tenant and the brand, so the table
and the token agree (KNOWN-GAPS #18).

> ⚠️ **HTTP, not HTTPS.** An ALB's own DNS name cannot carry a TLS certificate. Fine for you to
> test with, **not acceptable for sharing with the team** — the password would cross the network
> in the clear. That is item 6 below, and it is the last thing between here and a URL you can
> circulate.

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

## 5b. 🟠 Browser verification could not be done — Chrome extension not connected

`DEVRULES.md` requires UI work to be exercised in a real browser. I could not: the
claude-in-chrome extension reported **"Browser extension is not connected"**, so no click-through
of the sign-in flow, the forced-password-change step, or any authed view has happened.

**What WAS verified instead, and what it does and does not cover:**

- The auth flow end to end **without a browser** — a real Cognito user authenticated, and the
  resulting ID token was accepted by the live API through the ALB, returning `200` on `/brands`
  and on the owner-only `/admin/users`. So the token path is proven.
- The deployed bundle contains the correct pool id, client id and API URL, confirmed by grepping
  inside the built image, and contains **no Firebase**.
- The page serves `200` with the right `<title>`.

**Not covered:** anything rendered. The dashboard is a client-side SPA behind `AuthGate`
(`ssr: false`), so no view's markup exists until JavaScript runs — which means the 79 CSS token
conversions from KNOWN-GAPS #19 and the users UI from #12 remain visually unverified, exactly as
they were.

**When you are back**, either reconnect the extension and tell me, or click through it yourself:
sign in, set a password, and confirm the Dashboard, Trends, Brand impact and Competitors views
render. This is the checkpoint those two gaps have been waiting on since before AWS existed.

---

## 6. 🟡 Decide the hostname for the shared URL

**What:** whether the team-facing URL is the raw ALB DNS name, or a proper hostname under a TES
domain (which needs a Route 53 zone or a DNS record from whoever runs the domain, plus an ACM
certificate).

**Why it matters:** an ALB's own DNS name only serves **HTTP**, and browsers will flag the
sign-in page as insecure. HTTPS needs a certificate, and a certificate needs a domain you
control. I will stand the stack up on the ALB name so it is testable immediately; moving to a
real hostname later is a certificate plus a listener rule, not a rebuild.
