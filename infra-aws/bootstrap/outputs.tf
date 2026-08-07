output "state_bucket_name" {
  description = "Feed this to `terraform init -backend-config=\"bucket=...\"` in infra-aws/stack."
  value       = aws_s3_bucket.tfstate.id
}

output "account_id" {
  description = "The account actually provisioned into. Compare against docs/HANDOVER.md §3.1 before trusting any other verified fact in that document."
  value       = data.aws_caller_identity.current.account_id
}

output "backend_config" {
  description = "Copy-paste init command for the stack, so the bucket name is never retyped."
  value       = <<-EOT
    terraform -chdir=infra-aws/stack init \
      -backend-config="bucket=${aws_s3_bucket.tfstate.id}" \
      -backend-config="key=env/${var.environment}/terraform.tfstate" \
      -backend-config="region=${var.aws_region}" \
      -backend-config="use_lockfile=true"
  EOT
}
