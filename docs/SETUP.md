# Project Signal — Environment Setup

End-to-end instructions for standing up a Project Signal environment from nothing. Written
for **staging first**; production is the same procedure with different names (§13).

Console locations and procedures here were verified against vendor documentation in
**August 2026**. Where a step depends on something that changes often — Gemini model IDs,
regional model availability — the doc says how to check rather than asserting a value.

> **Related reading:** [`../infra/README.md`](../infra/README.md) is the Terraform reference;
> [`KNOWN-GAPS.md`](KNOWN-GAPS.md) lists what still doesn't work end-to-end once deployed.
> Read gap #16's list before you start — this document is its executable form.

---

## 0. What you need before you start

| Thing                                                            | Why                               | Notes                                        |
| ---------------------------------------------------------------- | --------------------------------- | -------------------------------------------- |
| A Google account with rights to create projects and link billing | Steps 2–4                         | Needs Owner on the new project.              |
| A payment method                                                 | Bootstrap enables paid APIs       | Free-trial credit works.                     |
| An Apify account                                                 | 3 of 5 source adapters            | Paid; the free tier is enough to smoke-test. |
| Admin on the GitHub repo                                         | Steps 5, 10                       | `LokimotiveUK/project-signal`.               |
| Microsoft Entra tenant                                           | Optional — Microsoft sign-in only | Skip if email/password is enough.            |

### Local tooling

```powershell
winget install --id Hashicorp.Terraform --exact      # Terraform ~> 1.9
winget install --id Google.CloudSDK --exact          # gcloud CLI
node --version                                        # 20.x, for the bootstrap-owner script
```

The gcloud installer bundles its own Python and runs `gcloud init` at the end. If you prefer
the interactive `.exe`, tick **Cloud Tools for PowerShell** during the wizard. Terraform ships
as a bare binary — winget or Chocolatey both put it on `PATH`; a manual download means
extracting the zip and adding the folder to `PATH` yourself.

Then authenticate twice — once for the CLI, once for Application Default Credentials (the
`bootstrap-owner` script in §11 uses ADC, not your gcloud login):

```powershell
gcloud auth login
gcloud auth application-default login
```

---

## 1. Choose your names

Fix these before you start; several appear in more than one place and a mismatch is the most
common cause of a failed first run.

| Name         | Example                          | Constraint                                                                                    |
| ------------ | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Project ID   | `project-signal-staging`         | Globally unique, 6–30 chars, immutable once created.                                          |
| State bucket | `project-signal-staging-tfstate` | Globally unique across all of GCS.                                                            |
| Region       | `europe-west2`                   | London. **See §8 before committing to this** — it constrains which Gemini models you can use. |
| Environment  | `staging`                        | Prefixes every resource name (`staging-api`, `staging-item`, …).                              |

---

## 2. Create the GCP project and link billing

Cloud Console → project dropdown in the top bar → **New Project**. Or:

```powershell
gcloud projects create project-signal-staging --name="Project Signal Staging"
gcloud billing accounts list
gcloud billing projects link project-signal-staging --billing-account=<ACCOUNT_ID>
gcloud config set project project-signal-staging
```

**Billing must be linked before bootstrap.** Bootstrap enables paid APIs and creates billable
resources; without an active billing link `terraform apply` fails partway through, leaving
some APIs enabled and nothing else.

Now capture both identifiers — you need the number as well as the id:

```powershell
gcloud projects describe project-signal-staging --format='value(projectId,projectNumber)'
```

---

## 3. Fill in the environment tfvars

Edit `infra/envs/staging.tfvars` — both fields ship as `REPLACE_ME`:

```hcl
project_id     = "project-signal-staging"
project_number = "123456789012"
region         = "europe-west2"
environment    = "staging"

sql_tier                = "db-f1-micro"
sql_deletion_protection = true

auth_enable_email_signin = true
auth_authorized_domains  = ["localhost"]   # add the web Cloud Run URL in §12
```

`db-f1-micro` is a shared-core tier — Enterprise-edition only (which is why the module pins
ENTERPRISE), excluded from the Cloud SQL SLA, and not eligible for committed-use discounts.
It is intended for test and development instances, which is what staging is. Move production
to `db-g1-small` or a dedicated-core tier.

---

## 4. Run bootstrap (once per project)

Bootstrap is the only Terraform that runs from your machine with your own credentials.
Everything after it runs in CI as the service account bootstrap creates.

```powershell
cd infra/bootstrap
copy bootstrap.tfvars.example bootstrap.tfvars
# edit bootstrap.tfvars: project_id + state_bucket_name
terraform init
terraform apply -var-file=bootstrap.tfvars
```

This creates:

- **19 enabled APIs** — Run, Cloud SQL, Pub/Sub, Scheduler, Tasks, Secret Manager, Artifact
  Registry, Vertex AI, Storage, IAM/STS, Identity Toolkit, Firebase, YouTube Data, monitoring
  and logging.
- **The Terraform state bucket** — versioned, uniform access, `prevent_destroy`.
- **`project-signal-ci-deployer`** — the CI service account, with 13 admin roles.
- **Workload Identity Federation** — pool `github-pool`, provider `github-provider`. GitHub's
  runner exchanges its built-in OIDC token for a short-lived GCP token; no service-account JSON
  key exists anywhere in this setup.

Record the three outputs:

```powershell
terraform output
# state_bucket_name, workload_identity_provider, ci_service_account_email
```

> **The WIF provider is pinned to one repository.** `attribute_condition` is
> `assertion.repository == "LokimotiveUK/project-signal"`. If the repo is renamed, moved or
> forked, change `github_repository` in `infra/bootstrap/variables.tf` and re-apply bootstrap,
> or CI auth fails with an error that does not name the cause.

---

## 5. Create the GitHub environment and secrets

Repo → **Settings** → **Environments** (left sidebar) → **New environment** → `staging`.
Then **Add secret** under _Environment secrets_ for each of:

| Secret                             | Value                                         |
| ---------------------------------- | --------------------------------------------- |
| `WIF_PROVIDER`                     | bootstrap output `workload_identity_provider` |
| `WIF_SERVICE_ACCOUNT`              | bootstrap output `ci_service_account_email`   |
| `GCP_PROJECT_ID`                   | `project-signal-staging`                      |
| `TF_STATE_BUCKET`                  | bootstrap output `state_bucket_name`          |
| `NEXT_PUBLIC_FIREBASE_API_KEY`     | from §7                                       |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `project-signal-staging.firebaseapp.com`      |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`  | `project-signal-staging`                      |
| `NEXT_PUBLIC_API_URL`              | leave unset for now — filled in §12           |

For production, also set **required reviewers** on the environment (up to six users or teams,
who need at least read access; one approval releases the job). A job cannot read the
environment's secrets until an approver releases it, so this gates credentials as well as the
deploy. Consider enabling **prevent self-review** so the person who triggered a deploy cannot
approve their own.

---

## 6. Create the source-API secrets

**Do this before the first stack apply.** `infra/stack/main.tf` grants the ingestion service
account `secretAccessor` on both secrets by full resource name, so the apply fails outright if
either is missing. Values are created out-of-band so they never enter Terraform state.

### YouTube Data API key

`youtube.googleapis.com` is enabled by bootstrap. Cloud Console → **APIs & Services** →
**Credentials** → **Create credentials** → **API key**. Restrict it to the YouTube Data API v3
under _API restrictions_. The default quota is 10,000 units/day.

### Apify token

Apify Console → **Settings** → **API & Integrations**
(`console.apify.com/settings/integrations`) → **Create new token**. You can tick _Limit token
permissions_ to scope it.

### Store both

```powershell
gcloud secrets create staging-youtube-api-key --replication-policy=automatic
gcloud secrets create staging-apify-api-key   --replication-policy=automatic

# PowerShell: -NoNewline matters, a trailing newline corrupts the key
[IO.File]::WriteAllText("$env:TEMP\k.txt", "<youtube-key>")
gcloud secrets versions add staging-youtube-api-key --data-file="$env:TEMP\k.txt"
[IO.File]::WriteAllText("$env:TEMP\k.txt", "<apify-token>")
gcloud secrets versions add staging-apify-api-key --data-file="$env:TEMP\k.txt"
Remove-Item "$env:TEMP\k.txt"
```

---

## 7. Firebase and Identity Platform

The web app authenticates through Identity Platform using the Firebase Auth SDK, so the
project needs a Firebase web app registered to it.

1. **Add Firebase to the project.** [Firebase console](https://console.firebase.google.com) →
   **Add project** → pick the _existing_ Google Cloud project from the dropdown rather than
   creating a new one. (Adding Identity Platform to a Cloud project also creates the Firebase
   project automatically; either order works.)
2. **Register a web app.** Project overview → the **Web** (`</>`) icon, or **Add app** if one
   already exists. Give it a nickname; you do not need Firebase Hosting.
3. **Copy the SDK config.** Available any time under **Project settings → Your apps → SDK setup
   and configuration**. You need three values:
   - `apiKey` → `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `authDomain` → `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `projectId` → `NEXT_PUBLIC_FIREBASE_PROJECT_ID`

   These are public by design — they identify the project, they don't authorise anything — but
   they are **required with no fallback**: `apps/web/src/lib/firebase.ts` throws at startup if
   any is empty. Put them in the GitHub environment secrets from §5, and in
   `apps/web/.env.local` for local development.

4. **Identity Platform first-run.** If Identity Platform has never been enabled on the project,
   open Cloud Console → **Identity Platform** once and accept the enablement prompt. Terraform
   manages the config after that, but the first apply can fail without this click.

---

## 8. Gemini model and location

**Decision: stay in `europe-west2`, use `gemini-2.5-flash`.** Data residency in London wins
over model currency. `libs/config/src/index.ts` now defaults both `SCORER_MODEL` and
`REPORTER_MODEL` to `gemini-2.5-flash`, so there is nothing to configure — but understand the
expiry you have accepted.

### Why the previous defaults had to change

The repo shipped with `gemini-2.0-flash-001` and `gemini-2.0-pro-001`. Google's deprecation
table gives `gemini-2.0-flash-001` a **June 1, 2026 shutdown**, alongside `gemini-2.0-flash`,
`gemini-2.0-flash-lite` and `gemini-2.0-flash-lite-001` — that date has passed. No
`gemini-2.0-pro-001` appears to have ever existed; Gemini 2.0 Pro shipped experimental-only.
Both defaults would have failed at the first scoring call.

### The expiry you have accepted

**`gemini-2.5-flash` is scheduled for shutdown on October 16, 2026**, along with 2.5 Pro and
2.5 Flash-Lite. That is roughly two months out. When it lands you cannot simply bump the model
ID, because europe-west2 is the constraint: as of mid-2026 2.5 Flash is the only Gemini model
reported available there. The Gemini 3.x line (`gemini-3.5-flash`, May 2026;
`gemini-3.6-flash`, July 2026 — neither with an announced shutdown) has appeared on the EU
multi-region endpoint and in `europe-west1` / `europe-west4` first, all still inside the EEA.

So the October migration is a _location_ change, not a model change, and it needs a code edit:
`infra/stack/main.tf` hardcodes `VERTEX_AI_LOCATION = var.region` in `common_env`, so
decoupling inference from the London region means adding a `vertex_ai_location` variable.
Storage stays in London either way — only inference moves.

Model availability moves month to month, so **check your own project before assuming**:

```powershell
gcloud ai models list --region=europe-west2
```

or open **Vertex AI → Model Garden**, which is usually updated before the docs.

Both use-case slots point at Flash because Flash is what the region has. `REPORTER_MODEL` would
normally be a higher-quality model, but the report worker is a health-check skeleton
(reporting is Epic 12), so nothing reads it today.

---

## 9. Microsoft sign-in — optional

Skip this if email/password is enough; `auth_enable_email_signin = true` covers it.

In the [Microsoft Entra admin center](https://entra.microsoft.com) → **Identity** →
**Applications** → **App registrations** → **New registration**:

- **Name:** `Project Signal`
- **Supported account types:** _Accounts in any organizational directory (multitenant)_ — this
  is what lets any customer's Microsoft users sign in without registering an app per customer.
- **Redirect URI:** platform **Web**, value
  `https://project-signal-staging.firebaseapp.com/__/auth/handler`

Then **Certificates & secrets → New client secret** and copy the **Value** (not the Secret ID —
the value is shown once). Redirect URIs are edited later under **Manage → Authentication**; a
mismatch produces `AADSTS50011`, and each URI is capped at 256 characters.

Supply the credentials at apply time so they never touch state or git:

```powershell
$env:TF_VAR_auth_social_idps = '{"microsoft.com":{"client_id":"<id>","client_secret":"<value>"}}'
```

CI must source this from a secret store the same way if you want social sign-in in a
CI-driven deploy.

---

## 10. First deploy

Push to the `staging` branch, or run **Actions → Deploy — Staging → Run workflow**. The
workflow builds and pushes all five images, then runs one `terraform apply` that deploys image
and infrastructure atomically.

```powershell
git push origin main:staging
```

To do it by hand instead:

```powershell
cd infra/stack
terraform init -backend-config="bucket=<state_bucket_name>" -backend-config="prefix=env/staging"
terraform plan  -var-file=../envs/staging.tfvars -var="image_tag=staging-<short-sha>"
terraform apply -var-file=../envs/staging.tfvars -var="image_tag=staging-<short-sha>"
```

`image_tag` is required with no default — an apply without it fails on purpose, so a local run
can't silently roll images back. Always read the plan before applying; replacements and
deletions are flagged there.

The API applies database migrations on startup under a Postgres advisory lock. There is no
separate migrate step, and workers must never run one.

---

## 11. Create the first owner

Authorisation reads Firebase **custom claims**, not the `users` table, so the first owner is
created through the Admin SDK rather than SQL:

```powershell
$env:GOOGLE_CLOUD_PROJECT = "project-signal-staging"
npx tsx apps/api/scripts/bootstrap-owner.ts you@example.com
```

This creates the Identity Platform user if absent, sets `role: owner`, and prints a
set-password link. It uses Application Default Credentials — run
`gcloud auth application-default login` first if you skipped it in §0.

> Changing a user's role later means calling `setCustomUserClaims` again. Editing the `users`
> table alone leaves the token stale for up to an hour.

---

## 12. Second pass — point the web app at the API

`NEXT_PUBLIC_*` values are inlined into the client bundle by `next build`, so the API URL has to
be known at **build** time — but the API's Cloud Run URL doesn't exist until the first apply.
Hence two passes:

```powershell
cd infra/stack
terraform output api_url     # https://staging-api-<hash>-nw.a.run.app
terraform output web_url
```

1. Set `NEXT_PUBLIC_API_URL` to the `api_url` value in the `staging` GitHub environment.
2. Add the `web_url` host to `auth_authorized_domains` in `infra/envs/staging.tfvars`, or
   sign-in redirects are rejected.
3. If you set up Microsoft sign-in with a custom domain, add its
   `/__/auth/handler` redirect URI to the Entra app registration too.
4. Re-run the deploy workflow.

---

## 13. Production

Same procedure, separate project — do not share a project between environments.

1. New GCP project with billing; fill `infra/envs/production.tfvars`.
2. Raise `sql_tier` above shared-core and keep `sql_deletion_protection = true`.
3. Run `infra/bootstrap/` against the new project (its own state bucket).
4. Create the `production` GitHub environment **with required reviewers** and its own copy of
   all eight secrets.
5. Create `production-youtube-api-key` and `production-apify-api-key`.
6. Uncomment the `push: branches: [main]` trigger in
   `.github/workflows/deploy-production.yml`.

---

## 14. What "working" looks like — and what won't

After all of the above you have a deployed, authenticating system. **The scoring pipeline will
not produce meaningful output yet**, and that is expected rather than a misconfiguration. From
[`KNOWN-GAPS.md`](KNOWN-GAPS.md):

| Gap | Symptom you will see                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- |
| #7  | Ingestion publishes to `project-signal-item-queue`; Terraform created `staging-item`. Messages go nowhere. |
| #1  | Pub/Sub pushes to `/events`; the sentiment worker serves `/pubsub/item`. 404 → 5 retries → DLQ.            |
| #2  | The hourly sweep POSTs `/reconcile`, which doesn't exist. 404s hourly.                                     |
| #4  | Raw text is never stored; the worker scores the _URL string_. Scores look real and are meaningless.        |
| #9  | The worker swallows errors, so the DLQ never fires and failures are invisible.                             |
| #13 | Six dashboard views render mock data for a fictional bank.                                                 |

Fix order is #7 → #1 → #2 → #4 → #9. Only the Admin view and brand management talk to the live
API today.

### Smoke tests that should pass

```powershell
curl https://<api_url>/health
curl https://<web_url>            # sign-in page renders, no console error about Firebase config
```

Then sign in as the owner from §11 and create a tenant and a brand in the Admin view — that
path is live and exercises auth, the API, and Cloud SQL together.

---

## 15. Cost and teardown

Idle staging is roughly **$15–25/month**: Cloud SQL `db-f1-micro` (~$8–15) is the only
always-on charge, since all five Cloud Run services scale to zero and Pub/Sub, Scheduler and
Tasks are negligible at this volume. On top of that sit Vertex AI per-token charges and your
Apify subscription. The design deliberately avoids a Serverless VPC connector (~$12–15/month
always-on) by reaching Cloud SQL through the Auth Proxy socket.

To tear down, note that `sql_deletion_protection = true` and the state bucket's
`prevent_destroy` will both block a plain `terraform destroy` — clear them deliberately first.
Deleting the whole GCP project is the cleaner option for a throwaway environment.
