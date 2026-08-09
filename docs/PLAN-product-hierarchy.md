# Product hierarchy, mention attribution, and on-demand scanning

**Written:** 2026-08-09. **Owner decisions recorded below were taken the same day.**

Tes is a global EdTech group with roughly twenty products under one brand, assembled through
acquisition and in-house build. The requirement is to see sentiment **at brand level** and
**at product level**, because people talk about the products by name — and to be able to
**trigger a scan on demand** rather than waiting for a schedule.

---

## 0. What is true before this work starts

Verified by reading the code on 2026-08-09, not assumed. Each of these invalidates part of the
brief as originally framed.

| Claim | Reality |
| --- | --- |
| "It scans periodically" | **Nothing scans, ever.** There is no scheduler in `infra-aws` — no EventBridge rule, no schedule expression. That existed only in the GCP tree, which was never deployed. |
| "We could trigger ingestion" | **Ingestion is unreachable.** It has no ALB target group and no listener rule. `POST /ingest/dispatch` exists and nothing can call it from outside the VPC. |
| "Signals are matched to a brand by name" | **False.** `brand_aliases` has a table, an API, an Admin UI and a seed script, and **nothing in ingestion or scoring reads it**. A signal's brand comes from the source config it arrived through: every item in a feed is attributed to whichever brand that feed is pointed at. |
| "Brands can be grouped" | `brand_entities` is flat — no parent, no type. |

The third is the most consequential: product-level attribution is precisely the content-matching
problem the alias table was built for and which was never wired up. `docs/KNOWN-GAPS.md` #26
records it.

---

## 1. Decisions

Taken by the owner, 2026-08-09.

**Hierarchy: products are `brand_entities` with a parent.** Not a new table.

Every downstream table already keys off `brand_entity_id` — `signals`, `dimension_scores`,
`source_configs`, `brand_aliases` — and so does every API route and every view. Making a product
a brand entity means each product gets, with no new logic: its own Brand Perception Index, its
five dimensions, its Brand impact ranking, its drill-down to verbatim signals, its report, and
inclusion in the assistant's tools. Twenty products inherit the entire product surface for the
cost of one migration. A separate `products` table would duplicate the whole scoring path.

**Scores: brand AND portfolio, as two distinct numbers.**

- **Brand index** — signals attributed to the brand entity itself. Corporate and brand-level
  coverage. This is "how is Tes seen".
- **Portfolio index** — a volume-weighted roll-up across all descendant products. This is "how is
  what Tes sells seen".

They measure different things and a single blended number would hide both. Volume-weighted
rather than equal-weighted: a product with two thousand signals and one with nine should not move
the portfolio equally.

**Attribution: two mechanisms, because there are two cases.**

1. **Owned sources.** A product with its own App Store listing or Trustpilot page gets its own
   `source_configs` row pointing at the product entity. Works the moment the hierarchy lands,
   with no new code.
2. **Mention detection.** For shared sources — news, RSS, YouTube, forums discussing "Tes" while
   naming a product — the scorer identifies which known products a signal mentions, given the
   tenant's product names and aliases as candidates.

**Detection happens in the scorer**, as an additional field on the forced-tool call it already
makes per signal. No extra model call; extra input tokens on a call that already happens. On
Haiku 4.5 that is cheap, and it catches paraphrase, abbreviation and misspelling in a way string
matching across global territories will not.

**Sequencing: hierarchy first, then scanning.**

Nothing is collecting today, so there is no backfill pressure — but the reverse is a real trap.
Signals collected before attribution exists are attributed wholesale to the parent brand, and
with a **90-day half-life** that mis-attribution would keep distorting scores for a quarter.
Build the attribution, then turn on collection.

---

## 2. Schema

### 2.1 `brand_entities` gains hierarchy

```
parent_id  uuid null references brand_entities(id)
kind       varchar(16) not null default 'brand'   -- 'brand' | 'product'
```

Arbitrary depth, so brand → division → product works without a further migration. A `null`
parent is a root brand. `is_owned` keeps its existing meaning and is orthogonal: a competitor can
have products too, which is exactly how you compare portfolios.

**Cycle safety.** A self-referencing parent admits cycles, and a cycle turns every recursive
query into an infinite loop. Enforced in the API on write — a node may not be its own ancestor —
because Postgres cannot express that as a simple constraint.

### 2.2 `signal_mentions` — the many-to-many attribution

```
signal_id         uuid not null references signals(id) on delete cascade
brand_entity_id   uuid not null references brand_entities(id)
tenant_id         uuid not null references tenants(id)
confidence        real null
unique (signal_id, brand_entity_id)
```

`signals.brand_entity_id` stays as the **hard** attribution — where the signal came from. Mentions
are the **soft** attribution — what it talks about. A single news article can mention three
products, which a single foreign key cannot express, and collapsing the two would lose the
distinction between "this review is of product X" and "this article about Tes mentions X".

`tenant_id` is denormalised here for the same reason it is on `conversation_messages`: this
product has no row-level security, so the safe query must not require a join to be safe.

### 2.3 No table for portfolio scores

The portfolio index is **computed on read** from the children's existing `dimension_scores` rows,
weighted by `signal_count`. Those are already daily rollups, so the aggregate is cheap, and it
cannot drift from the children the way a separately-stored copy would.

---

## 3. Phases and gates

Each phase gates on `lint`, `typecheck`, `check:deps`, unit and integration tests, and — where it
touches a surface — Playwright against the deployed environment. CI must be green before merge.

| Phase | Contents |
| --- | --- |
| **1. Hierarchy** | Migration; brand CRUD for parent/kind with cycle prevention; tree endpoint; Admin UI to create and re-parent products; brand switcher shows the tree. |
| **2. Mention attribution** | `signal_mentions`; candidate products passed to the scorer; new field on the forced-tool schema; write path; tests including "mentions three products". |
| **3. Portfolio scoring** | Volume-weighted roll-up computed on read; API surfaces brand index and portfolio index; dashboard shows both. |
| **4. Scanning** | `scan_runs` for status; `POST /brands/:id/scan`; a route from API to ingestion (which is currently unreachable); debounce; EventBridge schedule for the periodic path that has never existed. |

**Phase 4 note.** Ingestion has no queue consumer and no ingress. The cleaner of the two options
is SQS — the API publishes a scan request, ingestion consumes — because it is retryable, it
decouples a slow third-party fetch from an HTTP request, and ingestion already has queue
plumbing on the publish side. An internal ALB rule is the alternative and is simpler but couples
request latency to third-party APIs that can block for minutes.

A scan button with no visible result is the failure mode this codebase keeps hitting, so
`scan_runs` is not optional: the user must see *queued → running → 47 signals collected*.

---

## 4. What this deliberately does not do

- **No re-scoring of historical signals.** Nothing is collected yet, so there is nothing to
  re-attribute. If that changes before Phase 2 ships, a backfill becomes necessary and should be
  its own change.
- **No per-product dimension weights.** `dimension_weights` already exists per entity and will
  work for products for free; tuning them per product is a product decision, not this change.
- **No automatic product discovery.** The candidate list is what an admin has configured. The
  scorer identifies mentions of known products; it does not invent new ones from the text. That
  keeps the taxonomy under human control, which for twenty acquired brands matters more than
  coverage.
