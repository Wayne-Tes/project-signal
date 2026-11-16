# Phase 4 — task identities.
#
# Two kinds of role, and conflating them is the classic ECS mistake:
#
#   EXECUTION role — used by the ECS agent BEFORE the container starts, to pull the image, write
#                    to the log group, and resolve `secrets` into environment variables. Shared
#                    by every service, because every service needs exactly the same three things.
#   TASK role      — used by the application code AT RUNTIME. One per service, scoped to only
#                    what that service actually touches, so a bug in the sentiment worker cannot
#                    write to the raw bucket and a bug in ingestion cannot invoke Bedrock.
#
# Least privilege here is not ceremony: this is a SHARED account, and CONVENTIONS.md §4 requires
# that a defect in one project cannot reach another project's data. Every statement below names
# concrete ARNs — no wildcards on resources.

locals {
  # Bedrock, for the two services that invoke a model (API assistant, sentiment worker).
  #
  # An `eu.` inference profile is a resource IN THE CALLING REGION that fans requests out to
  # foundation models in several EU regions, so both halves must be permitted:
  #
  #   * the profile — pinned to this stack's region and to `eu.anthropic.*`, so neither a `us.`
  #     or `global.` profile (inference outside the EU, contrary to HANDOVER §3.4 / owner answer
  #     #3) nor another vendor's model can be invoked;
  #   * the foundation models behind it — pinned to `anthropic.*` in `eu-*` regions. A wildcard
  #     on the region SUFFIX rather than an enumerated list, because the set of regions an EU
  #     profile routes to is AWS's to extend (it was seven on 2026-08-07), and an enumerated list
  #     would turn a routing change into an AccessDenied on the scoring path at runtime.
  #
  # Before 2026-11-16 both ARNs used `arn:aws:bedrock:*:...`, permitting every region.
  bedrock_resources = [
    "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/eu.anthropic.*",
    "arn:aws:bedrock:eu-*::foundation-model/anthropic.*",
  ]
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    # Scope the trust to this account so the role cannot be assumed via a confused-deputy path.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# ── Execution role, shared ────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "execution" {
  name               = "${local.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role = aws_iam_role.execution.name
  # AWS-managed: ECR pull + CloudWatch Logs write. Deliberately the managed policy rather than a
  # hand-rolled copy — it is maintained by AWS and its scope is exactly this job.
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Secret resolution happens in the EXECUTION role, not the task role, because the ECS agent
# reads them before the container exists.
resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = concat([aws_secretsmanager_secret.db.arn], [for s in aws_secretsmanager_secret.app : s.arn])
    }]
  })
}

# ── Task roles, one per service ───────────────────────────────────────────────────────────────

resource "aws_iam_role" "task" {
  for_each = local.ecr_repositories

  name               = "${local.name_prefix}-task-${each.value}"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# Every task may write its own logs and use ECS Exec, which is how you get a shell into a task
# in private subnets without a bastion. Exec is the difference between debugging a failing
# migration in a minute and standing up an EC2 instance to do it.
resource "aws_iam_role_policy" "task_common" {
  for_each = aws_iam_role.task

  name = "common"
  role = each.value.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.app.arn}:*", "${aws_cloudwatch_log_group.exec.arn}:*"]
      },
      {
        # ECS Exec session logging (ecs.tf) runs inside the task and checks the target group
        # exists before streaming to it. DescribeLogGroups takes no resource scope.
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = "*" # ECS Exec's channel API takes no resource scope.
      },
    ]
  })
}

# API: reads the reports bucket to serve generated reports (Epic 12), reads the raw bucket for the
# content backfill, and invokes Bedrock for the in-product assistant. Still no queue consumption —
# the API produces scan requests but never reads or deletes from a queue.
resource "aws_iam_role_policy" "task_api" {
  name = "app"
  role = aws_iam_role.task["api"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.reports.arn}/*"
      },
      {
        # READ-ONLY on the raw bucket, for `POST /admin/backfill/content`.
        #
        # 383 signals were collected with their verbatim text written here and only a pointer kept
        # on the row, so the drill-down could show a source name and a link and nothing readable.
        # The backfill re-reads each object and populates `signals.content`. Without this grant it
        # fails every row with AccessDenied — which is exactly what happened on the first run, and
        # the route reported it per row rather than corrupting anything.
        #
        # Deliberately GetObject only. The API must never write or delete here: the raw object is
        # the audit trail that proves the stored text was not altered, and a service that can
        # rewrite its own evidence is not an audit trail. Ingestion writes it; the API and the
        # sentiment worker read it.
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.raw.arn}/*"
      },
      {
        # CRM connection tokens, one secret per tenant per provider.
        #
        # SCOPED BY NAME PREFIX, not `*`. These secrets grant standing access to a customer's
        # commercial records, which makes them categorically more sensitive than the Apify or
        # YouTube keys — a wildcard here would let the API read the database password and every
        # other secret in the account, including any a co-tenant project puts there.
        #
        # The API creates them at connect time rather than Terraform, because they are per tenant
        # and the value comes from an OAuth exchange. Terraform cannot pre-create a secret whose
        # name depends on a tenant that does not exist yet — which is why this is a prefix grant
        # rather than an enumerated list like the one above it.
        #
        # `DeleteSecret` is included for disconnect, which schedules deletion with a recovery
        # window. The explicit DENY below makes "never force-delete" a property of the POLICY
        # rather than of the application code — before 2026-11-16 this comment claimed the
        # policy prevented it while the statement allowed it unconditionally.
        Effect = "Allow"
        Action = [
          "secretsmanager:PutSecretValue",
          "secretsmanager:GetSecretValue",
          "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${local.name_prefix}-crm/*"
      },
      {
        # Creation is a separate statement because it carries a CONDITION: the secret must be
        # created carrying this project's `Project` tag. Untagged secrets were invisible to
        # 99-teardown.sh's tag inventory and to the project budget, so a CRM token secret could
        # outlive the stack in a shared account with nothing pointing at it. The API passes the
        # tag set on CreateSecret (apps/api/src/lib/crm-secrets.ts); TagResource is required by
        # Secrets Manager whenever CreateSecret includes Tags.
        Effect   = "Allow"
        Action   = ["secretsmanager:CreateSecret", "secretsmanager:TagResource"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${local.name_prefix}-crm/*"
        Condition = {
          StringEquals = { "aws:RequestTag/Project" = var.project }
        }
      },
      {
        # Force-deletion destroys a customer's CRM credential with no recovery window. No code
        # path needs it; denying it here means a future one cannot add it by accident.
        Effect   = "Deny"
        Action   = ["secretsmanager:DeleteSecret"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${local.name_prefix}-crm/*"
        Condition = {
          Bool = { "secretsmanager:ForceDeleteWithoutRecovery" = "true" }
        }
      },
      {
        # On-demand scans. The API publishes a request and ingestion consumes it — it cannot call
        # ingestion directly, which has no ingress at all. Send only: the API never reads or
        # deletes from this queue.
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
        Resource = [aws_sqs_queue.main["scan"].arn]
      },
      {
        # The assistant. Same scoping as the sentiment worker's grant and for the same reason:
        # an inference profile fans out to foundation models across EU regions, so both the
        # profile and the underlying models must be permitted, and confining the model arn to
        # `anthropic.*` stops this becoming a blanket bedrock:* grant in a shared account.
        #
        # The assistant is READ-ONLY over tenant data by design, and this grant does not change
        # that: it lets the API talk to a model, not the model reach the database. Every tool the
        # assistant can call runs through the API's own authenticated routes — see
        # apps/api/src/assistant/tools.ts.
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = local.bedrock_resources
      },
    ]
  })
}

# Ingestion: writes raw payloads, publishes to the item queue. It must NOT read raw back or
# invoke a model — that is the worker's job, and the split is what keeps a bug contained.
resource "aws_iam_role_policy" "task_ingestion" {
  name = "app"
  role = aws_iam_role.task["ingestion"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.raw.arn}/*"
      },
      {
        # Ingestion also reads raw back during the reconcile sweep's dedup checks.
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.raw.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
        Resource = [aws_sqs_queue.main["item"].arn, aws_sqs_queue.main["report"].arn]
      },
      {
        # Ingestion CONSUMES the scan queue — the on-demand scan path. Deliberately separate from
        # the grant above: it publishes to item and report, and reads from scan. Merging them
        # would let it consume its own output.
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
        ]
        Resource = [aws_sqs_queue.main["scan"].arn]
      },
    ]
  })
}

# Sentiment worker: reads raw, consumes the item queue, invokes Bedrock. It cannot write to S3
# and cannot publish to a queue.
resource "aws_iam_role_policy" "task_sentiment" {
  name = "app"
  role = aws_iam_role.task["sentiment-worker"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.raw.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
        ]
        Resource = [aws_sqs_queue.main["item"].arn]
      },
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        # See local.bedrock_resources for the scoping.
        Resource = local.bedrock_resources
      },
    ]
  })
}

# Web: a Next.js server rendering a client-side SPA. It talks to the API over HTTP and touches
# no AWS service at all, so it gets the common policy and nothing else.

# The API is the only service that administers users: POST /admin/tenants and
# POST|PATCH /admin/users create Cognito users and write their custom attributes inside the same
# database transaction that writes the users row (KNOWN-GAPS #18). Scoped to this pool only.
resource "aws_iam_role_policy" "task_api_cognito" {
  name = "cognito-admin"
  role = aws_iam_role.task["api"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:ListUsers",
      ]
      Resource = aws_cognito_user_pool.main.arn
    }]
  })
}
