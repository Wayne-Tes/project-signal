# Phase 2 — the database.
#
# Single Postgres instance, per the owner's locked decision (HANDOVER §6). It replaces Cloud SQL,
# and the connection model simplifies with it: RDS is plain TCP, so DATABASE_URL covers it and
# DB_SOCKET_PATH — which exists only for the Cloud SQL Auth Proxy's colon-bearing socket path —
# becomes dead weight in libs/config the moment this is wired up (HANDOVER §4.3).

# --- Security groups --------------------------------------------------------------------------
#
# Two groups, referencing each other, so access is expressed as "the app may reach the database"
# rather than as a CIDR that has to be maintained. Nothing else can reach 5432 at all.

resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-app-sg"
  description = "Application tasks. Attached to Fargate services in Phase 4."
  vpc_id      = aws_vpc.main.id

  # No inbound rules yet, deliberately. Phase 4 adds exactly one: the ALB on the API's port.
  # An empty ingress set is the correct starting position, not an unfinished one.

  egress {
    description = "All outbound. Ingestion must reach RSS, Apify and the YouTube API."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-app-sg" }
}

resource "aws_security_group" "db" {
  name        = "${local.name_prefix}-db-sg"
  description = "RDS Postgres. Reachable only from the application security group."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from application tasks only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  # No egress rule at all: the database initiates nothing. Terraform's default for a bare
  # security group is no egress, which is what we want. Note this differs from the AWS console
  # default, which helpfully adds allow-all.

  tags = { Name = "${local.name_prefix}-db-sg" }
}

# --- Credentials ------------------------------------------------------------------------------
#
# Generated here and never seen by a human. The value lands in Terraform state — which is why
# the state bucket is encrypted, versioned and TLS-only (infra-aws/bootstrap) — and in Secrets
# Manager, which is where the ECS task role reads it from at runtime in Phase 4.

resource "random_password" "db" {
  length = 32
  # RDS rejects '/', '@', '"' and space in a master password. Excluding the wider punctuation set
  # avoids a class of shell- and URL-quoting bugs for the sake of a few bits of entropy that
  # 32 characters already provides in abundance.
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "db" {
  name        = "${local.name_prefix}-db-password"
  description = "Master password for ${local.name_prefix}-postgres. Read by the ECS task role."

  # Dev: allow immediate deletion so teardown genuinely tears down. Secrets Manager otherwise
  # holds a name for 7-30 days and a re-apply then collides with the scheduled-for-deletion
  # secret, which is a confusing failure to hit while iterating.
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db.result
    dbname   = var.db_name
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    # Ready to drop straight into DATABASE_URL, so no service has to assemble it and get the
    # escaping wrong. libs/config takes DATABASE_URL or nothing on RDS.
    #
    # ⚠️ `sslmode=require` IS NOT OPTIONAL. RDS Postgres 15+ ships with rds.force_ssl = 1, so an
    # unencrypted connection is refused — and the error names neither TLS nor the parameter:
    #
    #   PostgresError: no pg_hba.conf entry for host "10.20.11.181",
    #   user "project_signal_app", database "project_signal", no encryption
    #
    # which reads like a network or credentials problem. It cost a deploy cycle to diagnose.
    # **This cannot be caught locally**: the docker-compose Postgres does not force TLS, so
    # every local run and every test passes without it. It is a deployed-only failure.
    #
    # `require` encrypts without verifying the server certificate. Verifying (`verify-full`)
    # additionally needs the RDS CA bundle baked into each image — worth doing when the data is
    # real, and noted in KNOWN-GAPS rather than done silently here.
    url = "postgresql://${var.db_username}:${urlencode(random_password.db.result)}@${aws_db_instance.main.endpoint}/${var.db_name}?sslmode=require"
  })
}

# --- The instance -----------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db-subnets"
  description = "Private subnets for ${local.name_prefix}-postgres"
  subnet_ids  = aws_subnet.private[*].id

  tags = { Name = "${local.name_prefix}-db-subnets" }
}

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgres"

  engine = "postgres"
  # Pinned to a minor version verified available in eu-west-2 on 2026-08-08 with
  # `aws rds describe-db-engine-versions`. Do not write an RDS version from memory — the same
  # rule that applies to Bedrock model ids applies here, and a wrong one fails the apply.
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true # AWS-managed key. A CMK buys nothing here and costs per request.

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  # The private subnets have no route to the internet gateway, so this is belt and braces —
  # which is exactly what it should be for the one setting that could expose the database.
  publicly_accessible = false

  multi_az = var.db_multi_az

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "02:00-03:00" # UTC, before the 06:00 Monday ingestion run
  maintenance_window      = "sun:03:30-sun:04:30"

  auto_minor_version_upgrade = true
  apply_immediately          = var.db_apply_immediately

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${local.name_prefix}-postgres-final"

  # Postgres logs to CloudWatch so a failed migration on API startup is diagnosable without
  # shell access to the instance. This is the cheap half of observability (Epic 9).
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = { Name = "${local.name_prefix}-postgres" }
}
