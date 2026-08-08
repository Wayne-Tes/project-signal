locals {
  # THE name prefix. Every resource in this tree derives its name from this and nothing else,
  # so "one prefix, everywhere" (rule 2, docs/AWS-SETUP.md) is enforced by construction rather
  # than by review. Co-tenant projects in this shared account follow the same shape with their
  # own prefix — see infra-aws/CONVENTIONS.md.
  name_prefix = "${var.project_prefix}-${var.environment}"

  # The canonical list of mandatory tag KEYS is NOT here. It lives in
  # `infra-aws/account/variables.tf`, next to the resource that activates them as cost
  # allocation tags, because that is an account-global concern rather than a project one.
  # Keeping a second copy here would be two homes for one fact — the exact pattern
  # KNOWN-GAPS #11 was closed to avoid, and doubly dangerous when the fact is a set of
  # case-sensitive strings that must match character for character.
  #
  # The keys still appear once in this module, as they must: the `default_tags` block in
  # versions.tf, which is what actually applies them.

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
