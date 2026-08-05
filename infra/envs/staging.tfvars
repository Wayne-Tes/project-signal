# Staging environment. Provisioned from scratch — fill these in before the first apply.
# Get both values with:  gcloud projects describe <project-id> --format='value(projectId,projectNumber)'
project_id     = "REPLACE_ME" # e.g. project-signal-staging
project_number = "REPLACE_ME" # numeric project number
region         = "europe-west2"
environment    = "staging"

sql_tier                = "db-f1-micro" # ~$10/mo, adequate for staging
sql_deletion_protection = true

# Auth (Identity Platform). Social IdP client IDs/secrets are NOT set here —
# supply them via TF_VAR_auth_social_idps at apply time (see modules/identity_platform).
auth_enable_email_signin = true
auth_authorized_domains  = ["localhost"] # add the Cloud Run URL / custom domain once known
