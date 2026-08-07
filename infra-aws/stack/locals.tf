locals {
  # THE name prefix. Every resource in this tree derives its name from this and nothing else,
  # so "one prefix, everywhere" (rule 2, docs/AWS-SETUP.md) is enforced by construction rather
  # than by review. Co-tenant projects in this shared account follow the same shape with their
  # own prefix — see infra-aws/CONVENTIONS.md.
  name_prefix = "${var.project_prefix}-${var.environment}"

  # The mandatory tag KEYS, single-sourced here and consumed by both the cost allocation tag
  # activation and the teardown script's documentation. These must match the keys in the
  # provider's default_tags block in versions.tf exactly — AWS tag keys are case-sensitive.
  mandatory_tag_keys = [
    "Project",
    "Owner",
    "CostCentre",
    "Environment",
    "ManagedBy",
    "Expires",
  ]

  # AWS Budgets expresses a tag filter as "user:<Key>$<Value>" for customer-defined tags
  # ("aws:" is reserved for AWS-generated ones). Verified against the provider documentation
  # for aws_budgets_budget, which gives "user:business-unit$human_resources" as its example.
  #
  # format() rather than interpolation on purpose: the separator is a literal "$", and in HCL
  # "$${" is the ESCAPE for a literal "${" — so "user:Project$${var.project}" silently produces
  # the string "user:Project${var.project}" instead of interpolating. The budget would then
  # filter on a tag value nothing carries and cheerfully report $0 spend forever.
  budget_tag_filter = format("user:Project$%s", var.project)
}
