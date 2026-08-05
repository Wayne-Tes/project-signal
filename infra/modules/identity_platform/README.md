# Identity Platform module

Configures Google Cloud Identity Platform for user authentication: email/password
fallback plus social sign-in providers (Microsoft, Google) via the `social_idps` map.

User auth is fully decoupled from where Project Signal is hosted (GCP). The only footprint in
Microsoft Entra is a single **multi-tenant app registration** — a free directory object
that lets any Microsoft work/school account sign in without per-customer setup.

## Sign in with Microsoft — Entra app registration (one-time)

Do this once in the [Microsoft Entra admin center](https://entra.microsoft.com) →
**Identity → Applications → App registrations**:

1. **New registration.**
   - Name: `Project Signal`.
   - Supported account types: **Accounts in any organizational directory (multitenant)** —
     this is what lets any customer's Microsoft users sign in without you registering an
     app per customer.
   - Redirect URI: **Web** →
     `https://<PROJECT_ID>.firebaseapp.com/__/auth/handler`
     (the Identity Platform callback handler; add custom-domain handlers later if used).
2. **Register**, then copy the **Application (client) ID**.
3. **Certificates & secrets → New client secret** → copy the secret **Value** (not the ID).
4. **API permissions**: the default Microsoft Graph `User.Read` (delegated) plus `openid`,
   `profile`, `email` is sufficient. Tenants that lock down third-party app consent may need
   their IT admin to grant admin consent once on first sign-in.

> Sign in with Google follows the same pattern using OAuth credentials from the GCP
> **APIs & Services → Credentials** console; add it under key `google.com`.

## Supplying credentials to Terraform (never commit secrets)

Client IDs/secrets are passed via the sensitive `social_idps` variable at apply time —
never written to a `.tfvars` file in git. Set the `TF_VAR_auth_social_idps` environment
variable (CI sources it from a secret store):

```bash
export TF_VAR_auth_social_idps='{
  "microsoft.com": { "client_id": "<entra-app-client-id>", "client_secret": "<entra-secret-value>" }
}'

terraform plan  -var-file=../envs/staging.tfvars
terraform apply -var-file=../envs/staging.tfvars
```

Non-secret settings (`authorized_domains`, `enable_email_signin`) live in the
environment's `.tfvars` file as usual.

## Inputs

| Variable              | Description                                                        | Default         |
| --------------------- | ------------------------------------------------------------------ | --------------- |
| `project_id`          | GCP project ID.                                                    | —               |
| `authorized_domains`  | Domains allowed to complete sign-in redirects.                     | `["localhost"]` |
| `enable_email_signin` | Enable email/password sign-in alongside social providers.          | `true`          |
| `social_idps`         | Map of default-supported social IdPs (sensitive), keyed by idp_id. | `{}`            |

## Note: first-time enablement

If Identity Platform has never been enabled on the project, the first apply may require a
one-time acceptance in **Cloud Console → Identity Platform**. The `identitytoolkit`
API itself is already enabled in `bootstrap/`.
