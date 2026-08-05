project_id     = "REPLACE_ME" # e.g. project-signal-prod
project_number = "REPLACE_ME" # numeric project number
region         = "europe-west2"
environment    = "production"

sql_tier                = "db-g1-small" # upgrade as load grows
sql_deletion_protection = true

# Auth (Identity Platform). Social IdP client IDs/secrets are NOT set here —
# supply them via TF_VAR_auth_social_idps at apply time (see modules/identity_platform).
auth_enable_email_signin = true
auth_authorized_domains  = ["localhost"] # replace with the production domain
