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
        Resource = "${aws_cloudwatch_log_group.app.arn}:*"
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

# API: reads the reports bucket to serve generated reports (Epic 12), and invokes Bedrock for the
# in-product assistant. Still no queue — the API neither produces nor consumes messages.
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
        # The assistant. Same scoping as the sentiment worker's grant and for the same reason:
        # an inference profile fans out to foundation models across EU regions, so both the
        # profile and the underlying models must be permitted, and confining the model arn to
        # `anthropic.*` stops this becoming a blanket bedrock:* grant in a shared account.
        #
        # The assistant is READ-ONLY over tenant data by design, and this grant does not change
        # that: it lets the API talk to a model, not the model reach the database. Every tool the
        # assistant can call runs through the API's own authenticated routes — see
        # apps/api/src/assistant/tools.ts.
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = [
          "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/eu.anthropic.*",
          "arn:aws:bedrock:*::foundation-model/anthropic.*",
        ]
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
        # An inference profile fans out to foundation models across EU regions, so BOTH the
        # profile and the underlying models must be permitted. Scoping the model arn to
        # `anthropic.*` keeps this from becoming a blanket bedrock:* grant in a shared account.
        Resource = [
          "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/eu.anthropic.*",
          "arn:aws:bedrock:*::foundation-model/anthropic.*",
        ]
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
