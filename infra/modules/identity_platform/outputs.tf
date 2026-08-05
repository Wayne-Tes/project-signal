output "enabled_social_idps" {
  description = "IdP IDs enabled as default-supported social providers (e.g. microsoft.com)."
  # IdP ids are not secret; unwrap them from the sensitive social_idps map.
  value = nonsensitive(keys(var.social_idps))
}

output "authorized_domains" {
  description = "Domains permitted to complete sign-in redirects."
  value       = google_identity_platform_config.default.authorized_domains
}
