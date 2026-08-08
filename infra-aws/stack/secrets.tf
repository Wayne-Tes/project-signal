# Phase 4 — third-party ingestion credentials.
#
# System-level keys, shared across all tenants, merged into the adapter config at runtime by
# getSystemCredentials() in apps/ingestion. They are NEVER written into source_configs.config —
# that column holds placeIds and feed URLs, not secrets (ARCHITECTURE §4).
#
# Terraform creates the secret and deliberately DOES NOT manage its value. The owner pastes the
# real key in the console once; `ignore_changes` on secret_string means no later apply reverts
# it to the placeholder, and the key never enters Terraform state or a tfvars file.
#
# Both are optional. The RSS adapter needs no key at all, which is why it is the source used for
# every end-to-end test — see docs/OWNER-ACTIONS.md item 5.

locals {
  app_secrets = {
    apify   = "Apify API token. Needed by the Google Reviews, App Store and Play Store adapters."
    youtube = "YouTube Data API v3 key. Needed by the YouTube adapter."
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.app_secrets

  name                    = "${local.name_prefix}-${each.key}-api-key"
  description             = each.value
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "app_placeholder" {
  for_each = local.app_secrets

  secret_id = aws_secretsmanager_secret.app[each.key].id

  # A placeholder, not a key. The apps treat these as optional and the adapters that need them
  # simply cannot fetch until a real value is set. That is a better failure than a task which
  # refuses to start, because it isolates the outage to one source rather than the service.
  secret_string = "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
