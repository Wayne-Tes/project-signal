# Project Signal Infrastructure (Terraform)

GCP infrastructure for Project Signal, structured for multiple isolated environments.

Region is **`europe-west2`** (London).

> **Nothing is provisioned yet.** This stack was originally applied to a contractor-owned
> test project, which was abandoned at handover. Both `envs/staging.tfvars` and
> `envs/production.tfvars` contain `REPLACE_ME` for `project_id` / `project_number`, and
> `bootstrap/` has not been run against a new project. Follow
> [First-time setup](#first-time-setup-run-once-before-any-environment) below to build
> staging from scratch.

For how the infrastructure relates to the application code — and for the list of places where
the two currently disagree — see [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and
[`../docs/KNOWN-GAPS.md`](../docs/KNOWN-GAPS.md).

## Layout

```
infra/
  bootstrap/           # one-time per project: enabled APIs, TF state bucket, WIF + CI service account
  modules/             # reusable building blocks shared across environments
    artifact_registry/ # Docker repository for app images
    cloud_run/         # generic Cloud Run v2 service (scale-to-zero, secrets, Cloud SQL socket)
    cloud_sql/         # Postgres instance + database + user + password in Secret Manager
    cloud_tasks/       # rate-limited ingestion queue
    identity_platform/ # email + social sign-in (Microsoft, Google) — see its own README
    pubsub/            # item/report topics + DLQs + OIDC push subscriptions
    scheduler/         # cron: ingestion, report, pending sweep
    service_accounts/  # one least-privilege SA per service + scheduler + pubsub invoker
    storage/           # raw + reports buckets with scoped IAM
  stack/               # ONE set of .tf files used by every environment (no duplication)
    versions.tf
    backend.tf         # empty backend block — config supplied at `terraform init`
    variables.tf
    main.tf            # composes the modules
    outputs.tf
  envs/                # only .tfvars files live here — one per environment, no .tf files
    staging.tfvars
    production.tfvars
```

## Conventions

- **Region** is the `region` variable (default `europe-west2` — London). Change it in the
  environment's `.tfvars` file; no `.tf` files need editing.
- **One `.tfvars` file per environment** under `envs/`. State is isolated per environment via
  a distinct GCS backend prefix passed at `terraform init`.
- The `.tf` files in `stack/` are **shared and never duplicated**. All environment differences
  live in `.tfvars`.
- **No service-account JSON keys anywhere.** CI authenticates via **Workload Identity
  Federation** created in `bootstrap/`.
- **Secrets never enter Terraform state.** Social IdP credentials are passed at apply time via
  `TF_VAR_auth_social_idps`; source API keys (e.g. the YouTube key) are created out-of-band
  with `gcloud` and referenced by name, with only the IAM grant managed here.
- Resource names are prefixed with `var.environment` (`staging-api`, `staging-item`, …).

## What gets created

| Module | Resources | Notable decisions |
| --- | --- | --- |
| `cloud_sql` | Postgres 16, `project_signal` DB, `project_signal_app` user, random password → Secret Manager | **ENTERPRISE** edition (required for shared-core tiers such as `db-f1-micro`); backups on; **public IP with no authorized networks** — reachable only through the Cloud SQL Auth Proxy, which avoids the ~$12–15/mo always-on Serverless VPC connector |
| `service_accounts` | 5 runtime SAs + scheduler SA + pubsub-invoker SA | `cloudsql.client` only for DB users, `aiplatform.user` only for sentiment/report, log + metric writer for all |
| `artifact_registry` | Docker repo `project-signal` | Provides the `registry_url` used to build image references |
| `storage` | `raw` and `reports` buckets | Uniform bucket-level access, public access prevention enforced, 30-day → NEARLINE lifecycle on `raw`, per-SA scoped IAM |
| `cloud_tasks` | Ingestion queue | 5 dispatches/sec, 10 concurrent — the throttle protects third-party API quotas |
| `cloud_run` ×5 | api, web, ingestion, sentiment-worker, report-worker | Scale to zero (min 0, max 2); api/web public, workers invokable only by their calling SA |
| `pubsub` | `item` + `report` topics, each with a DLQ, push subs, DLQ pull subs | OIDC push auth, 5 delivery attempts, 10s–600s backoff, plus the service-agent IAM that dead-lettering requires |
| `scheduler` | 3 cron jobs | ingestion `0 6 * * 1`, report `0 7 * * 1`, pending sweep hourly, `Etc/UTC` |
| `identity_platform` | Auth config + social IdP configs | See [`modules/identity_platform/README.md`](modules/identity_platform/README.md) |

## First-time setup (run once, before any environment)

```bash
cd infra/bootstrap
terraform init
terraform apply -var-file=bootstrap.tfvars      # creates state bucket, enables APIs, sets up WIF
```

Note the outputs: `state_bucket_name`, `workload_identity_provider`,
`ci_service_account_email` — they become the `TF_STATE_BUCKET`, `WIF_PROVIDER` and
`WIF_SERVICE_ACCOUNT` GitHub environment secrets.

> **Billing must be enabled on the project first** — bootstrap enables paid APIs and
> creates billable resources, so `terraform apply` will fail without an active billing link.

Bootstrap restricts the WIF provider to a single repository via
`attribute_condition = assertion.repository == "<owner/repo>"` (default
`wayne-strydom/project-signal`). Set `github_repository` if the repo moves.

## Container images are owned by Terraform

Every Cloud Run service's image is `"<registry>/<app>:${var.image_tag}"`, and **`image_tag` is
a required variable with no default**. Images are built and pushed *before* the apply, so a
single `terraform apply` deploys code and environment together — there is no separate
image-update step, and no `ignore_changes` on the image.

Practical consequences:

- `terraform apply` without `-var="image_tag=..."` fails. That is intentional: it stops a local
  apply from silently rolling images back.
- To redeploy an existing image, re-apply with the same tag.
- The `cloud_run` module's `image` variable still defaults to `gcr.io/cloudrun/hello` as a
  fallback for standing a service up before any image exists, but `stack/main.tf` always
  passes an explicit value.

## Deploying an environment

Normally CI does this — `deploy-staging.yml` on a push to the `staging` branch builds and
pushes all five images, then runs the apply below. Manually:

```bash
cd infra/stack
terraform init \
  -backend-config="bucket=<state_bucket_name>" \
  -backend-config="prefix=env/staging"          # change to env/production for prod

terraform plan \
  -var-file=../envs/staging.tfvars \
  -var="image_tag=staging-<short-sha>"

terraform apply \
  -var-file=../envs/staging.tfvars \
  -var="image_tag=staging-<short-sha>"
```

Always review `terraform plan` output before apply. Destructive changes (resource
replacement/deletion) are flagged in the plan and must be confirmed. PRs that touch
`infra/**` automatically get the staging plan posted as a comment by `terraform-plan.yml`.

### Enabling production

1. Fill `envs/production.tfvars` with the real `project_id` and `project_number`.
2. Create the `production` GitHub environment with required reviewers and its secrets
   (`WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `TF_STATE_BUCKET`).
3. Uncomment the `push: branches: [main]` trigger in
   `.github/workflows/deploy-production.yml` for full parity with staging.

## Supplying secrets at apply time

```bash
export TF_VAR_auth_social_idps='{
  "microsoft.com": { "client_id": "<entra-app-client-id>", "client_secret": "<entra-secret-value>" }
}'
```

Source API keys are created separately so their values never reach state:

```bash
gcloud secrets create staging-youtube-api-key --replication-policy=automatic
printf '%s' "<key>" | gcloud secrets versions add staging-youtube-api-key --data-file=-
```

`stack/main.tf` then grants the ingestion SA `secretAccessor` on it and injects it as an env
var.
