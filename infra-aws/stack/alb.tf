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
# ⚠️ HTTP ONLY for now. An ALB's own DNS name cannot carry a TLS certificate — ACM needs a domain
# you control. Sign-in over plain HTTP is fine for an internal test but is NOT acceptable for
# real credentials, so the hostname decision (docs/OWNER-ACTIONS.md item 6) gates sharing this
# widely. Adding HTTPS later is a certificate plus a listener, not a rebuild.

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Public load balancer. The only thing in this stack reachable from the internet."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "To the application tasks"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-alb-sg" }
}

# Added as a separate rule rather than inside the app security group's own block, because the app
# group is defined in rds.tf and referencing the ALB group there would create a dependency cycle
# (app -> alb -> vpc -> ... ). Separate rule resources are the standard way out of that.
resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  for_each = { for k, v in local.services : k => v if v.public }

  security_group_id            = aws_security_group.app.id
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

  # Off in dev. On in anything real: it is the only record of who called what, and it cannot be
  # reconstructed after the fact.
  enable_deletion_protection = false

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

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  # The web app is the default destination: anything not claimed by an API rule below is a page,
  # not an endpoint. Until the web service is deployed this returns 503, which is correct and
  # honest — there is no page yet.
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["web"].arn
  }
}

# API routes, listed explicitly from ARCHITECTURE §6. A new top-level API route prefix must be
# added here or it will be served by the web app and return a 404 that looks like a routing bug.
#
# ⚠️ AWS caps a listener rule at FIVE condition values. Split across two rules rather than packed
# into one at exactly the limit, so adding a route later is an edit rather than a refactor —
# the first attempt used eight values and failed the apply with "A rule can only have '5'
# condition values".
#
# The trailing `*` covers both the bare path and its children: `/brands*` matches `/brands` and
# `/brands/<id>/signals` alike, which is why these are wildcards rather than pairs.
resource "aws_lb_listener_rule" "api_app" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app["api"].arn
  }

  condition {
    path_pattern {
      values = ["/admin*", "/brands*", "/docs*"]
    }
  }
}

# Health and readiness kept in their own rule: they are the endpoints most likely to be probed
# by something other than the dashboard, and separating them keeps the app-route rule free to
# grow.
resource "aws_lb_listener_rule" "api_health" {
  listener_arn = aws_lb_listener.http.arn
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
