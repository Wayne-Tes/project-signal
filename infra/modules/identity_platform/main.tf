# Google Cloud Identity Platform — user authentication for Project Signal.
#
# Initialises Identity Platform on the project and configures sign-in methods:
# email/password as a fallback, plus social IdPs (e.g. Sign in with Microsoft,
# Sign in with Google) driven by the `social_idps` map.
#
# The identitytoolkit.googleapis.com API is enabled in bootstrap/. Applying this
# config initialises Identity Platform; if the project has never had it enabled,
# a one-time acceptance in the Cloud Console may be required first (see README).

resource "google_identity_platform_config" "default" {
  project = var.project_id

  authorized_domains = var.authorized_domains

  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = var.enable_email_signin
      password_required = true
    }
  }
}

# One default-supported IdP config per entry in social_idps (microsoft.com, google.com, …).
# Iterate over the IdP IDs (not secret) and look up the sensitive credentials inside —
# for_each cannot consume a sensitive value directly.
resource "google_identity_platform_default_supported_idp_config" "social" {
  for_each = nonsensitive(toset(keys(var.social_idps)))

  project       = var.project_id
  idp_id        = each.key
  client_id     = var.social_idps[each.key].client_id
  client_secret = var.social_idps[each.key].client_secret
  enabled       = true

  depends_on = [google_identity_platform_config.default]
}
