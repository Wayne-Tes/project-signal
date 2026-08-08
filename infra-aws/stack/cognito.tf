# Phase 5 — authentication, replacing Firebase / GCP Identity Platform.
#
# This is the last Google dependency and the gate on sharing a URL with anyone: every view sits
# behind AuthGate, so without a working identity provider the dashboard cannot be seen at all.
#
# ── THE INVARIANT THAT MUST SURVIVE THE PORT ─────────────────────────────────────────────────
#
# Authorisation reads the IDENTITY PROVIDER'S CLAIMS, not the `users` table. The table is a
# mirror for the admin UI; the token is what is enforced. Two consequences carried over from the
# Firebase design, both of which were defects that had to be fixed once already:
#
#   * The claim write happens INSIDE the database transaction that writes the users row
#     (KNOWN-GAPS #18). A Cognito port that writes the row, commits, then updates attributes
#     silently reintroduces the orphan-row bug, and no existing test would fail.
#   * A role change takes effect only when the token is refreshed. Same as Firebase's ~1 hour.
#
# Custom attributes carry what `request.user` needs: tenantId, role, brandEntityId. They are the
# direct equivalent of Firebase custom claims and land in the ID token the same way.

resource "aws_cognito_user_pool" "main" {
  name = "${local.name_prefix}-users"

  # Email is the username. The users table keys on the provider's subject id, not the email, so
  # an address can change without orphaning the row.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # Admin-created users only. This is an agency-managed product — tenants are onboarded through
  # POST /admin/tenants, not by strangers signing themselves up.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # ⚠️ Custom attributes are IMMUTABLE ONCE CREATED. Name, type and size cannot be changed and
  # an attribute cannot be removed — altering one means a new user pool and migrating every
  # user. Get these right the first time; that is why they are documented rather than terse.
  schema {
    name                     = "tenantId" # -> custom:tenantId. A uuid.
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  schema {
    name                     = "role" # -> custom:role. owner | admin | user.
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 16
    }
  }

  schema {
    name                = "brandEntityId" # -> custom:brandEntityId. Optional: pins a `user`.
    attribute_data_type = "String"
    mutable             = true
    # NOT required, and that is load-bearing: an unpinned `user` sees the whole tenant, which is
    # the documented behaviour of GET /brands and requireBrandAccess.
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 0
      max_length = 64
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = { Name = "${local.name_prefix}-users" }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  # PUBLIC client — no secret. The client runs in a browser, where a secret cannot be kept, and
  # Cognito's SRP/password flows do not need one.
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH", # email + password, matching the existing SignIn form
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  access_token_validity  = 60 # minutes
  id_token_validity      = 60 # minutes — this is the window a stale role survives
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Return a generic error for a bad username as well as a bad password, so the endpoint cannot
  # be used to enumerate which email addresses have accounts.
  prevent_user_existence_errors = "ENABLED"

  read_attributes  = ["email", "email_verified", "custom:tenantId", "custom:role", "custom:brandEntityId"]
  write_attributes = ["email"] # Custom attributes are written by the API's admin path, never by the user.
}
