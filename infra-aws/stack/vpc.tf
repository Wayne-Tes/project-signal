# Phase 2 — network foundation.
#
# Our own VPC, per infra-aws/CONVENTIONS.md §4. There is no default VPC in eu-west-2, so there
# is nothing to land in by accident — but only because each project creates its own. CIDR
# 10.20.0.0/16 is registered in CONVENTIONS.md §6; allocations start at 10.20 so the scheme
# cannot collide with a corporate network occupying 10.0.x.
#
# ⚠️ The VPC quota is 5 per region and this is the account's first. Co-tenant projects will each
# want one, so the ceiling is real — see CONVENTIONS.md §4.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Two AZs, not three. RDS needs a subnet group spanning at least two, and a third buys
  # resilience we are not paying for elsewhere in a dev environment.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  # /24s out of the /16, leaving the rest of the range free for later tiers. Public and private
  # are deliberately far apart numerically so a misread subnet id is obvious in a console.
  public_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]      # 10.20.0.0/24, 10.20.1.0/24
  private_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 10)] # 10.20.10.0/24, 10.20.11.0/24
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  # Both required for RDS to hand out a resolvable endpoint, and for interface VPC endpoints to
  # work if Phase 4 adds them. Cheap to enable now, awkward to discover missing later.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-igw" }
}

# --- Public subnets: ALB in Phase 4, and nothing else unless deliberately placed here ---------
resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = local.public_subnets[count.index]
  availability_zone = local.azs[count.index]

  # Off by default. A task or instance only gets a public IP if its own configuration asks for
  # one, so nothing lands on the internet by accident just by choosing this subnet.
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-public-${local.azs[count.index]}"
    Tier = "public"
  }
}

# --- Private subnets: RDS now, Fargate tasks in Phase 4 ---------------------------------------
resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.name_prefix}-private-${local.azs[count.index]}"
    Tier = "private"
  }
}

# --- Routing ----------------------------------------------------------------------------------
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-public-rt" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The private route table has NO default route, and that is the decision, not an omission.
#
# There is no NAT gateway. One costs roughly $33/month before a byte crosses it — over a fifth
# of this project's $150 budget — and NOTHING IN PHASE 2 NEEDS OUTBOUND INTERNET. RDS does not
# egress, and it is the only thing in these subnets today.
#
# Phase 4 is when the question becomes real, because ingestion must reach RSS feeds, Apify and
# the YouTube API, and Fargate must pull images from ECR. Decide it there, with three options:
#
#   1. VPC endpoints (ECR api + dkr, S3 gateway, Logs, Secrets Manager). Gateway endpoints are
#      free; interface endpoints are ~$7/month each. Covers image pulls and AWS APIs but NOT
#      third-party HTTP, so ingestion still needs egress.
#   2. A single NAT gateway (~$33/month). Covers everything, simplest, most expensive.
#   3. Ingestion tasks in public subnets with a public IP; everything else private. Free, and
#      acceptable when security groups allow no inbound — but it puts a task on a public subnet,
#      which wants a deliberate decision rather than a default.
#
# Deferring costs nothing: adding a route later is a route, not a rebuild.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name_prefix}-private-rt" }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
