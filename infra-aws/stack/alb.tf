# Phase 4 — the public entry point.
#
# ONE load balancer fronting both the web app and the API, on one hostname. That is a deliberate
# design choice, not a shortcut: same-origin means the browser sends no cross-origin preflight,
# CORS_ORIGINS never has to be maintained, and NEXT_PUBLIC_API_URL can point at the same host the
# page was served from. Two hostnames would need two DNS names and a CORS allowlist to match.
#
# Routing is path-based. The API's routes are known and finite (ARCHITECTURE §6), so they are
# listed explicitly and everything else falls through to the web app.
#
# ── TLS ─────────────────────────────────────────────────────────────────────────────────────
#
# HTTPS is READY BUT OFF until `var.certificate_arn` is set. An ALB's own *.elb.amazonaws.com name
# cannot carry a certificate — ACM needs a domain we control, and none has been chosen
# (docs/OWNER-ACTIONS.md, hostname item). Until then the stack serves HTTP, which means Cognito ID
# tokens cross the internet in cleartext: acceptable for a sandbox nobody outside the team uses,
# NOT acceptable for real credentials or customer data.
#
# Setting the variable is the whole change: a 443 listener appears, every API rule attaches to it,
# and port 80 becomes a permanent redirect. No resource is replaced, so the DNS name the team
# already uses keeps working (over HTTPS once a CNAME points the chosen domain at it).

locals {
  https_enabled = var.certificate_arn != null

  # Every routing rule hangs off whichever listener actually serves traffic. With HTTPS on, the
  # HTTP listener only redirects — attaching rules to it as well would serve the API in cleartext
  # beside the encrypted copy.
  app_listener_arn = local.https_enabled ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Public load balancer. The only thing in this stack reachable from the internet."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from anywhere (serves the app, or redirects to HTTPS once a certificate exists)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = local.https_enabled ? [1] : []
    content {
      description = "HTTPS from anywhere"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  # Egress confined to the VPC. The ALB only ever talks to its targets, which live in this VPC's
  # private subnets; allow-all egress would let a misconfigured target group point anywhere.
  egress {
    description = "To the application tasks, inside the VPC only"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${local.name_prefix}-alb-sg" }
}

# Added as separate rule resources rather than inside the task security groups' own blocks,
# because those groups are defined elsewhere and referencing the ALB group there would create a
# dependency cycle (app -> alb -> vpc -> ...). Separate rule resources are the standard way out.
#
# The web app has its OWN security group (see web_security_group in ecs.tf): it never talks to the
# database, so it must not share the group the database's ingress rule trusts.
resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  for_each = { for k, v in local.services : k => v if v.public }

  security_group_id            = each.key == "web" ? aws_security_group.web.id : aws_security_group.app.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = each.value.port
  to_port                      = each.value.port
  ip_protocol                  = "tcp"
  description                  = "ALB to ${each.key}"
}

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # Off in dev, so 99-teardown.sh genuinely tears down. On in anything real.
  enable_deletion_protection = var.protect_stateful_resources

  # Reject requests whose header names are not valid HTTP. Closes a class of request-smuggling
  # and header-injection tricks against the targets behind it, at no cost to a real browser.
  drop_invalid_header_fields = true

  # The only record of who called what, from where — it cannot be reconstructed after the fact,
  # and CloudWatch metrics carry counts, not callers. Bucket in alb_logs.tf.
  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "alb"
    enabled = true
  }

  # The bucket policy must exist before the ALB validates delivery, or the apply fails with
  # "Access Denied for bucket".
  depends_on = [aws_s3_bucket_policy.alb_logs]

  tags = { Name = "${local.name_prefix}-alb" }
}

resource "aws_lb_target_group" "app" {
  for_each = { for k, v in local.services : k => v if v.public }

  # ALB target group names cap at 32 characters — one of the length limits CONVENTIONS.md §2
  # warns about when choosing a short prefix. "psignal-dev-api" is 15, so there is headroom.
  name        = "${local.name_prefix}-${each.key}"
  port        = each.value.port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # Fargate with awsvpc networking registers by IP, never by instance.

  health_check {
    enabled             = true
    path                = each.value.health_path
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # The API applies database migrations on startup behind an advisory lock, so a cold task can
  # take noticeably longer than a warm one to serve its first request. Draining fast is still
  # right — a task being replaced has nothing worth waiting for.
  deregistration_delay = 15

  tags = { Name = "${local.name_prefix}-${each.key}-tg" }
}

# Port 80. Serves the app while there is no certificate; once there is, it does nothing but send
# a permanent redirect to the same URL over HTTPS.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # The web app is the default destination: anything not claimed by an API rule below is a page,
  # not an endpoint.
  dynamic "default_action" {
    for_each = local.https_enabled ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.app["web"].arn
    }
  }

  dynamic "default_action" {
    for_each = local.https_enabled ? [1] : []
    content {
      type = "redirect"
      redirect {
        protocol    = "HTTPS"
        port        = "443"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count = local.https_enabled ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn

  # TLS 1.3 preferred, TLS 1.2 floor, no legacy ciphers. AWS's recommended policy for new
  # listeners; nothing this product serves needs to support a pre-2014 client.
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["web"].arn
  }
}

# API routes, listed explicitly from ARCHITECTURE §6. A new top-level API route prefix must be
# added here or it will be served by the web app and return a 404 that looks like a routing bug.
# infra-aws/scripts/test/alb-routes.test.sh fails CI when one is missing — it compares every
# prefix registered under apps/api/src/routes with every path_pattern in this file.
#
# ⚠️ AWS caps a listener rule at FIVE condition values. Split across rules rather than packed into
# one at exactly the limit, so adding a route later is an edit rather than a refactor — the first
# attempt used eight values and failed the apply with "A rule can only have '5' condition values".
#
# The trailing `*` covers both the bare path and its children: `/brands*` matches `/brands` and
# `/brands/<id>/signals` alike, which is why these are wildcards rather than pairs.
resource "aws_lb_listener_rule" "api_app" {
  listener_arn = local.app_listener_arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["api"].arn
  }

  condition {
    path_pattern {
      # `/assistant*` added 2026-08-09 with the in-product assistant. Its absence was exactly the
      # failure the note above predicts: POST /assistant/messages reached the WEB target group,
      # which has no such route, and the dock reported "something went wrong" — a message that
      # points at the API rather than at the load balancer in front of it.
      values = ["/admin*", "/assistant*", "/brands*", "/docs*"]
    }
  }
}

# The growth rule. `/crm*` was added 2026-08-18 with the CRM connection manager; it went in HERE
# rather than alongside `/admin*` because that rule was already carrying four of its five
# permitted values.
#
# `/auth*` added 2026-11-16 for the local sign-in route (`POST /auth/local/sign-in`). The API
# registers that route ONLY when AUTH_MODE=local, which config refuses in production, so in a
# deployed environment this forwards to the API and the API answers 404 — the correct, honest
# answer. Forwarding it anyway keeps the route table and the API's declared prefixes in step, so
# the CI route check stays a hard rule with no exception list to rot.
#
# This class of defect has shipped twice (`/assistant*`, then `/crm*`), each time deploying green
# while every endpoint behind the missing prefix returned 404 from the WEB target group.
#
# ADD NEW TOP-LEVEL API PREFIXES HERE until this rule holds four, then start another.
resource "aws_lb_listener_rule" "api_crm" {
  listener_arn = local.app_listener_arn
  priority     = 105

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["api"].arn
  }

  condition {
    path_pattern {
      values = ["/crm*", "/auth*"]
    }
  }
}

# Health and readiness kept in their own rule: they are the endpoints most likely to be probed
# by something other than the dashboard, and separating them keeps the app-route rule free to
# grow.
resource "aws_lb_listener_rule" "api_health" {
  listener_arn = local.app_listener_arn
  priority     = 110

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["api"].arn
  }

  condition {
    path_pattern {
      values = ["/health", "/ready"]
    }
  }
}
