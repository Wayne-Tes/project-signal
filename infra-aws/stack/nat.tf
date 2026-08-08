# Phase 4 — egress for the private subnets.
#
# THE DECISION vpc.tf DEFERRED, now taken. Fargate needs outbound reach for three separate
# reasons, and only one of them can be solved with VPC endpoints:
#
#   1. Pulling images from ECR, and writing logs to CloudWatch — VPC endpoints could cover this.
#   2. Reading Secrets Manager and S3, and calling Bedrock — endpoints could cover this too.
#   3. **Ingestion fetching RSS feeds, Apify and the YouTube Data API.** Arbitrary third-party
#      HTTPS on the public internet. No VPC endpoint exists for "the rest of the web".
#
# Reason 3 is the whole product. Without egress there is no ingestion, and without ingestion
# there are no signals to score. So a NAT gateway is not the expensive option here — it is the
# only complete one, and the endpoint-only design would still need it.
#
# Cost: roughly $33/month plus data processing. Against a $2,000 account ceiling and an owner
# instruction not to optimise pennies, that is the right trade. A single gateway, not one per
# AZ: a second would double the fixed cost to protect against a single-AZ outage in a dev
# environment whose database is already single-AZ.
#
# If egress cost ever matters, add S3 and ECR endpoints ALONGSIDE this — they cut NAT data
# processing for the highest-volume traffic (image pulls, raw payload writes) without removing
# the general-purpose route ingestion depends on.

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${local.name_prefix}-nat-eip" }

  # The gateway needs the IGW to exist before it can be reachable.
  depends_on = [aws_internet_gateway.main]
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id

  # Lives in a PUBLIC subnet — that is how a NAT gateway works, and it is the one thing people
  # get backwards. It sits in public and is routed to from private.
  subnet_id = aws_subnet.public[0].id

  tags = { Name = "${local.name_prefix}-nat" }

  depends_on = [aws_internet_gateway.main]
}

# The default route vpc.tf deliberately left out. Private subnets now reach the internet
# outbound only: nothing on the internet can initiate a connection back through a NAT gateway.
resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main.id
}
