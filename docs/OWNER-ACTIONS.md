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

## 4b. 🔴 The Apify account is a FREE plan, and it belongs to the former contractor

**Both halves of that sentence are a problem, and the first one is now silently corrupting data.**

**Verified 2026-08-10** against the live Apify API with the token now deployed:

```bash
curl -s "https://api.apify.com/v2/users/me?token=$APIFY_API_KEY"
#  → { "username": "LokimotiveUK", "plan": { "id": "FREE", "monthlyUsageCreditsUsd": 5 } }
```

### Why this is urgent: runs report SUCCESS and collect nothing

A free-tier actor that has exhausted its quota does **not** fail. It finishes `SUCCEEDED` with an
empty dataset, or writes placeholder `{"noResults": true}` rows. Nothing in our pipeline can tell
that apart from "there was genuinely nothing new to collect", so the scan is recorded as a success
and the feed shows a green timestamp.

Read out of the last 25 runs on the account, 2026-08-10:

| Actor | Used by | What the runs actually return |
| --- | --- | --- |
| `neatrat/google-play-store-reviews-scraper` | Play Store | **0 items on every run since the 5th.** Log: `[FREE USER] Quota: 54/500 reviews used; 5/5 runs used, 0 remaining` → `Free tier limit reached (5 total runs)` |
| `apidojo/tweet-scraper` | (evaluated for X) | **10 × `{"noResults": true}` per run.** Log: `The developer of this actor doesn't allow the use of API in the Free Plan` |
| `trudax/reddit-scraper-lite` | Reddit | 1 real item per run — working |
| `compass/Google-Maps-Reviews-Scraper` | Google reviews | `FAILED` — see item 4c, a separate and unrelated defect |

**So the Play Store gave us 54 reviews, once, and has collected nothing since — while reporting
success.** Any earlier statement that ClassCharts was collecting from "6 of 6 sources" counted
sources that ran without throwing, not sources that returned data. That was wrong, and this is
the correction.

### Why it blocks the social channels

The marketing team's channel list (`Tes Social Channels.md`) is 90 accounts across 11 platforms.
Every platform on it except YouTube needs a paid Apify actor, and the popular ones explicitly
refuse API access on the Free plan — that is a policy the actor's author sets, not a quota we can
work around. Verified live prices per item, if the plan is upgraded:

| Platform | Actor | Price per item |
| --- | --- | --- |
| X (Twitter) | `apidojo/tweet-scraper` | $0.0004 |
| TikTok comments | `clockworks/tiktok-comments-scraper` | $0.00125 |
| Facebook comments | `apify/facebook-comments-scraper` | $0.0025 |
| Instagram comments | `apify/instagram-comment-scraper` | $0.0026 |

Those are the **comment** scrapers deliberately, not the post scrapers. Signal scores what the
audience says; the brand's own marketing posts would score uniformly positive and pollute the
index. The existing YouTube adapter already works this way — it collects comment threads, not
videos — and any new social adapter must match it.

### Why it is also a governance problem

`LokimotiveUK` is the **previous contractor's** account — the same identity `CLAUDE.md` flags on
the `old-origin` remote. TES brand-intelligence collection currently depends on a departed
contractor's personal free-tier account: outside TES billing, outside TES audit, and revocable by
someone who no longer works here. That is worth fixing regardless of the plan tier.

### What to do

1. **Create a TES-owned Apify account** and subscribe it to a paid plan. Their entry paid tier is
   the one that lifts both the run cap and the "no API on Free" restriction.
2. Put its token into `psignal-dev-apify-api-key` and force a new ingestion deployment — the same
   two commands as item 5 below.
3. Tell me the plan is live and I will build and wire the X, Facebook, Instagram and TikTok
   comment adapters, and add the 90 channels.

**Why an agent did not do this for you.** Creating accounts and entering payment details are
prohibited actions under `CLAUDE.md`, and the spend is yours to authorise.

**Until then**, the honest position is: Play Store is dead, Reddit works, and no other social
platform can be added. I have not built adapters I cannot prove against real data — that is the
`DEVRULES.md` "wire to real services only" rule, and a scraper mapper written against a guessed
payload is exactly the fabrication it forbids.

---

## 4c. 🟠 One Google reviews feed holds an App Store URL

**Verified 2026-08-10** from the Apify run log for `compass/Google-Maps-Reviews-Scraper`:

```
WARN  Unsupported place ID format "https://apps.apple.com/gb/app/tes-magazine/id6743850634",
      skipping it. Expected e.g. ChIJreV9aqYWdkgROM_boL6YbwA
ERROR [Status message]: INVALID INPUT: "startUrls" don't contain any valid URLs.
```

A `google_reviews` feed on **Tes Magazine** has an App Store URL where a Google Place ID belongs.
**This was my error**, made while adding feeds on 2026-08-10, and it is the reason that source
FAILS on every scan rather than returning nothing.

**I could not fix it in this session** — the AWS SSO token expired (`Token has expired and refresh
failed`) and the fix is a call against the deployed API. Run `! aws sso login --profile
psignal-dev` and I will correct it immediately; it is a two-minute change, not an owner action.
It is recorded here only so it is not lost.

Worth deciding at the same time: whether Tes Magazine should have a Google reviews feed at all.
A magazine has no premises, so there may be no Google Place to review — in which case the feed
should be deleted rather than corrected.

---

## 5. 🔴 Ingestion API keys — NOW BLOCKING, and both are still the placeholder

**Verified 2026-08-10** by reading the deployed values:

```
aws secretsmanager get-secret-value --region eu-west-2 --secret-id psignal-dev-apify-api-key
aws secretsmanager get-secret-value --region eu-west-2 --secret-id psignal-dev-youtube-api-key
```

Both return the literal string `REPLACE_ME`. Neither has ever been set, and the Apify token in
the local `.env` — which authenticates fine, `GET /v2/users/me` returns 200 — was never copied
into the deployed environment.

**This is why the scan history reads `Apify start run failed: 401` on every run.** Four of the six
adapters go through Apify: Google Reviews, App Store, Play Store and now **Reddit**. Not one of
them has ever collected a signal in the deployed environment. Every signal the system holds came
from the RSS feed, which needs no key — which is exactly why "80 signals from 1/1 source"
succeeded while "0 signals from 1/5 sources" is what a full sweep now reports.

**Raised from 🟡 to 🔴** because Reddit was specifically asked for and cannot collect until this is
done. Nothing else is required — the adapter, the UI, the queue path and the tests are all in
place and deployed.

**What to do**, once each, in the console or the CLI:

```bash
aws secretsmanager put-secret-value --region eu-west-2   --secret-id psignal-dev-apify-api-key --secret-string '<the token from .env>'

aws secretsmanager put-secret-value --region eu-west-2   --secret-id psignal-dev-youtube-api-key --secret-string '<a YouTube Data API v3 key>'
```

Then restart the ingestion service so it picks the values up — ECS reads secrets at task start:

```bash
aws ecs update-service --region eu-west-2 --cluster psignal-dev-cluster   --service psignal-dev-ingestion --force-new-deployment
```

**Why an agent did not do this for you.** `infra-aws/stack/secrets.tf` says in its own header that
Terraform creates the secret and deliberately does not manage its value, so the key never enters
Terraform state or a tfvars file — and `CLAUDE.md` forbids an agent from committing or moving a
credential anywhere, ever. Pasting a live token into an audited enterprise account is yours to do.

**Separately: the YouTube feed is misconfigured.** It holds
`https://www.youtube.com/@TesForTeachers` where the adapter expects a channel id
(`UCxxxxxxxxxxxx`), which is why that source reports `YouTube search failed: 400` rather than a
credential error. Fix it in Admin → Feeds → YouTube → Edit once the key is set.

**The channel ids are already resolved.** YouTube is the one platform on the marketing team's
list that needs no Apify plan — the adapter uses the YouTube Data API directly, and it collects
**comment threads**, which is audience voice rather than our own marketing. So the moment the key
above is set, these eight feeds can be added. Resolved 2026-08-10 by reading each channel page and
requiring its `<link rel="canonical">` and `<meta itemprop="identifier">` to agree:

| Channel | Channel id |
| --- | --- |
| Tes Magazine | `UC-gOKwgu5_g9Pm1YBMb5G_A` |
| The Safeguarding Company | `UCxOS7SpDGlNX8IQwNzPe4hA` |
| Tes for Teachers | `UCow2vbkIRCom36dG0iUJhFA` |
| Tes Recruitment Services | `UCvKPtBxPwXmuB5QTZ_gnckA` |
| Teach Starter | `UCOJA1gGG0E10GQ9FDg7eu_w` |
| Tes Recommends | `UCLCIz0tyPD4c_7k1MCE1Nog` |
| Education Horizons | `UC8JaDzRfJPS0fSOorbXkL1A` |

**`UCow2vbkIRCom36dG0iUJhFA` is Tes for Teachers** — that answers the question asked on 2026-08-10
about whether it was the right id to paste. It is, for that channel and no other.

**`@TesWorld` is missing.** `https://www.youtube.com/@TesWorld` returns **404**, so either the
handle in `Tes Social Channels.md` is wrong or the channel has gone. Worth checking with whoever
maintains that sheet; I have not guessed at a replacement.

**Requiring the two markers to agree was not pedantry.** A first pass matched the first
`"channelId"` in the page source and returned the SAME id for three different channels — the page
embeds related channels too. Three of the eight would have been wrong, pointing at Tes for
Teachers, and each would have collected real comments from the wrong channel: plausible data,
silently misattributed, which is worse than an error.

---

## 5b. ✅ Browser verification — DONE (2026-08-10)

Superseded. The Chrome extension is connected via **Edge**, and the deployed app at
`7728a97` was driven directly: signed in, Admin opened, a **second** Google News RSS feed added
alongside the first (the panel went from "1 feed" to "2 feeds"), the duplicate guard confirmed
with a real 409, a **Reddit** feed added, the dashboard's active-source count seen rising 5/5 → 7/7,
and the drill-down opened two levels deep to confirm the **`01 INDEX` stacked step column**
renders and navigates back when clicked. Console and network were clean throughout.

The historical note below is kept because it records what was and was not covered before that.

### Original entry — Chrome extension not connected

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

## 5c. 🟠 Classify the feeds by territory

**Territory reporting shipped 2026-08-17 and works — but it can only report what is classified,
and almost nothing is.** Verified live the same day:

| Territory | Signals | Index |
| --- | ---: | --- |
| All | 337 | 51.6 |
| United Kingdom | 1 | 92.5 |
| Global | 0 | not scored |
| **Not set** | **336** | 48.4 |

Two feeds are classified: the App Store feed is **GB** (its own config said `country=UK`, which
the API corrected to the ISO code) and the "Tes for Teachers" YouTube channel is **GLOBAL**,
because `Tes Social Channels.md` says so. **I classified only what that sheet or the feed's own
configuration justified**, and left the other eight at *Not set* rather than guessing — a feed
filed under the wrong territory produces reporting that is confidently wrong and that nobody ever
finds.

**What is needed:** someone who knows the feeds sets a territory on each, in Admin → Feeds. The
Google News searches ("Tes MyConcern", "Tes Jobs", "Tes Institute", "TES full name") are the
ambiguous ones — they are our own RSS searches rather than channels on the sheet, so whether they
are GB or GLOBAL is a judgement about who the coverage is for.

Then run **`POST /admin/backfill/territory`** (owner or admin) to stamp the existing signals from
their feeds. It is idempotent and set-based; signals collected before `source_config_id` existed
— 80 of them — will stay *Not set*, because there is genuinely nothing to inherit from.

**Six rows in the sheet say `Global?`.** The API refuses that value rather than guessing, so
those need a decision from whoever maintains it before they can be imported.

---

## 6. 🟡 Decide the hostname for the shared URL

**What:** whether the team-facing URL is the raw ALB DNS name, or a proper hostname under a TES
domain (which needs a Route 53 zone or a DNS record from whoever runs the domain, plus an ACM
certificate).

**Why it matters:** an ALB's own DNS name only serves **HTTP**, and browsers will flag the
sign-in page as insecure. HTTPS needs a certificate, and a certificate needs a domain you
control. I will stand the stack up on the ALB name so it is testable immediately; moving to a
real hostname later is a certificate plus a listener rule, not a rebuild.
