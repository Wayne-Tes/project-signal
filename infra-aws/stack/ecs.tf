# Phase 4 — the running services.
#
# Fargate, per the owner's locked decision. The property to keep in mind throughout: FARGATE DOES
# NOT SCALE TO ZERO. The GCP costing this replaces (~$13-15/month) rested entirely on Cloud Run
# doing so. Every task below bills continuously whether or not anything calls it, which is why
# the budget's FORECASTED alarm matters more than the ACTUAL one.

locals {
  # One place describing every deployable service. Adding a service means adding a row here and
  # an ECR repository in ecr.tf — everything else (task definition, role, target group, listener
  # rule, log stream) derives from it.
  #
  # `public` means "reachable through the ALB". ingestion and sentiment-worker are private by
  # design: ingestion is invoked by EventBridge Scheduler, and the worker polls SQS.
  services = {
    api = {
      port        = 8080
      cpu         = 512 # The API applies migrations on boot and serves the dashboard's reads.
      memory      = 1024
      public      = true
      health_path = "/health"
      desired     = 1
    }
    web = {
      port        = 3000
      cpu         = 256
      memory      = 512
      public      = true
      health_path = "/"
      desired     = 1
    }
    ingestion = {
      port        = 8081
      cpu         = 256
      memory      = 512
      public      = false
      health_path = "/health"
      desired     = 1
    }
    sentiment-worker = {
      port        = 8082
      cpu         = 256
      memory      = 512
      public      = false
      health_path = "/health"
      desired     = 1
    }
  }

  # Environment shared by every backend service. Queue URLs and bucket names come from the
  # resources themselves rather than being written down twice — KNOWN-GAPS #7 was exactly the
  # defect where a hardcoded topic name existed in no deployed environment and failed silently.
  common_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "RAW_BUCKET", value = aws_s3_bucket.raw.id },
    { name = "REPORTS_BUCKET", value = aws_s3_bucket.reports.id },
    { name = "ITEM_QUEUE_URL", value = aws_sqs_queue.main["item"].url },
    { name = "REPORT_QUEUE_URL", value = aws_sqs_queue.main["report"].url },
    { name = "SCAN_QUEUE_URL", value = aws_sqs_queue.main["scan"].url },
    { name = "SCORER_MODEL", value = var.scorer_model },
    { name = "REPORTER_MODEL", value = var.reporter_model },
    { name = "ASSISTANT_MODEL", value = var.assistant_model },
    # Cognito replaces Firebase. Neither value is a secret: the pool id is an identifier and the
    # client id is shipped in the browser bundle by design. The API needs them to verify a
    # token's issuer and audience against the pool's JWKS.
    { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.main.id },
    { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.web.id },
    # Name prefix for per-tenant CRM token secrets. An identifier, not a secret — and it must
    # match the IAM prefix grant in iam.tf exactly, or every connect attempt fails with
    # AccessDenied at the point a customer is watching.
    { name = "CRM_SECRET_PREFIX", value = "${local.name_prefix}-crm" },
    # The stack's mandatory tags, for resources the API creates at runtime (CRM token secrets),
    # which default_tags cannot reach. Same variables as versions.tf default_tags, so the two
    # cannot drift; the API adds ManagedBy=api. iam.tf requires the Project tag on CreateSecret.
    { name = "RESOURCE_TAGS", value = jsonencode({
      Project     = var.project
      Owner       = var.owner
      CostCentre  = var.cost_centre
      Environment = var.environment
      Expires     = var.expires
    }) },
  ]

  # The web container is a Next.js server delivering a client-side SPA: every NEXT_PUBLIC_* value
  # is inlined at BUILD time (apps/web/Dockerfile), and the server process itself reads nothing
  # but its port. It therefore gets no queue URLs, no model ids and — above all — no
  # DATABASE_URL. Before 2026-11-16 it received the full backend environment and the database
  # secret it never used, so a compromise of the one internet-facing Node process would have
  # handed over the database password for free.
  web_env = [
    { name = "NODE_ENV", value = "production" },
  ]

  # In-container health probe. The ALB health-checks the two public services from outside, but
  # ingestion and the sentiment worker have no target group, so before this nothing noticed a
  # worker whose process was alive and wedged. ECS replaces a task whose probe fails `retries`
  # times in a row. busybox `wget` ships in node:*-alpine, so no extra package is needed.
  # startPeriod is generous for the API, which runs migrations before it listens.
  container_health = {
    for k, v in local.services : k => {
      command     = ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:${v.port}${v.health_path} || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = k == "api" ? 120 : 30
    }
  }
}

# The web service's own security group. It accepts traffic from the ALB only (alb.tf) and is NOT
# referenced by the database's ingress rule, so a web task cannot open a connection to Postgres
# even if something inside it tried. Egress is HTTPS only: image pull and log delivery through the
# NAT gateway — the server makes no other outbound call.
resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web-sg"
  description = "Web (Next.js) tasks. Reachable from the ALB only; no database access."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "HTTPS out (ECR image pull, CloudWatch Logs) via the NAT gateway"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-web-sg" }
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    # Per-service CPU/memory/task metrics. Costs a few dollars a month and is the difference
    # between "the worker is slow" and knowing which resource it is short of.
    name  = "containerInsights"
    value = "enhanced"
  }

  # ECS Exec is enabled on every service (below). A shell in a task exposes DATABASE_URL, so
  # every session's commands and output are recorded to their own log group, which outlives the
  # task. Without this block the only trace of an exec session is the CloudTrail ExecuteCommand
  # event — that someone connected, not what they did.
  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.exec.name
        cloud_watch_encryption_enabled = false # AWS-managed at-rest encryption applies regardless; a CMK is not provisioned in this stack.
      }
    }
  }

  tags = { Name = "${local.name_prefix}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── Task definitions ─────────────────────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "app" {
  for_each = local.services

  family                   = "${local.name_prefix}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory

  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.task[each.key].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name  = each.key
      image = "${aws_ecr_repository.app[each.key].repository_url}:${var.image_tag}"

      essential = true
      portMappings = [{
        containerPort = each.value.port
        protocol      = "tcp"
      }]

      environment = concat(
        each.key == "web" ? local.web_env : local.common_env,
        [{ name = "PORT", value = tostring(each.value.port) }],
      )

      # Resolved by the ECS agent from Secrets Manager before the container starts, so the value
      # never appears in the task definition, in Terraform state as plaintext, or in the console.
      # The `:url::` suffix selects one JSON key out of the secret. Web gets none (see web_env).
      secrets = concat(
        each.key == "web" ? [] : [{ name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db.arn}:url::" }],
        each.key == "ingestion" ? [
          { name = "APIFY_API_KEY", valueFrom = aws_secretsmanager_secret.app["apify"].arn },
          { name = "YOUTUBE_API_KEY", valueFrom = aws_secretsmanager_secret.app["youtube"].arn },
        ] : [],
      )

      healthCheck = local.container_health[each.key]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = each.key
        }
      }
    }
  ])

  tags = { Name = "${local.name_prefix}-${each.key}" }
}

# ── Services ─────────────────────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "app" {
  for_each = local.services

  name            = "${local.name_prefix}-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app[each.key].arn
  desired_count   = each.value.desired
  launch_type     = "FARGATE"

  # ECS Exec. The tasks run in private subnets with no bastion, so this is the only way to get a
  # shell into one — and the difference between diagnosing a failed migration in a minute and
  # standing up an EC2 instance to do it.
  enable_execute_command = true

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [each.key == "web" ? aws_security_group.web.id : aws_security_group.app.id]
    assign_public_ip = false # Egress is via the NAT gateway; see nat.tf.
  }

  dynamic "load_balancer" {
    for_each = each.value.public ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.app[each.key].arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  # Give a public service time to boot before the ALB starts failing it. The API runs migrations
  # on startup, which on a cold database is the slowest thing it will ever do.
  health_check_grace_period_seconds = each.value.public ? 120 : null

  # Roll forward safely: keep the old task serving until the new one is healthy, and roll back
  # automatically if it never becomes healthy rather than leaving a broken deploy in place.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # `desired_count` is managed here rather than by autoscaling today. If autoscaling is added in
  # a later phase, add it to ignore_changes or Terraform will fight the scaler on every apply.

  depends_on = [aws_lb_listener.http, aws_lb_listener.https]

  tags = { Name = "${local.name_prefix}-${each.key}" }
}
