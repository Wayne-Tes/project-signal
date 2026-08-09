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
    { name = "SCORER_MODEL", value = var.scorer_model },
    { name = "REPORTER_MODEL", value = var.reporter_model },
    { name = "ASSISTANT_MODEL", value = var.assistant_model },
    # Cognito replaces Firebase. Neither value is a secret: the pool id is an identifier and the
    # client id is shipped in the browser bundle by design. The API needs them to verify a
    # token's issuer and audience against the pool's JWKS.
    { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.main.id },
    { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.web.id },
  ]
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    # Per-service CPU/memory/task metrics. Costs a few dollars a month and is the difference
    # between "the worker is slow" and knowing which resource it is short of.
    name  = "containerInsights"
    value = "enhanced"
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
        local.common_env,
        [{ name = "PORT", value = tostring(each.value.port) }],
      )

      # Resolved by the ECS agent from Secrets Manager before the container starts, so the value
      # never appears in the task definition, in Terraform state as plaintext, or in the console.
      # The `:url::` suffix selects one JSON key out of the secret.
      secrets = concat(
        [{ name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.db.arn}:url::" }],
        each.key == "ingestion" ? [
          { name = "APIFY_API_KEY", valueFrom = aws_secretsmanager_secret.app["apify"].arn },
          { name = "YOUTUBE_API_KEY", valueFrom = aws_secretsmanager_secret.app["youtube"].arn },
        ] : [],
      )

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
    security_groups  = [aws_security_group.app.id]
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

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${local.name_prefix}-${each.key}" }
}
