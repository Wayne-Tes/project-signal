import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { attributedTo } from '@project-signal/db';

/**
 * Cover for the one predicate that defines *which signals belong to a brand*.
 *
 * ## Why this test exists
 *
 * `attributedTo` used to live in `apps/ingestion/src/rollup.ts` and be used only there. Every
 * read path in the API — `/brand-impact`, `/topics`, `/strengths`, `/stats`, `/signals`,
 * `/sentiment-summary` — filtered on `signals.brand_entity_id` alone. So the Brand Perception
 * Index counted signals that merely MENTION a product, while the evidence lists explaining that
 * index did not, and a product discussed in group-level coverage scored on the dashboard with a
 * drill-down that showed fewer contributing signals than the number above it.
 *
 * That is KNOWN-GAPS #26's failure — a number contradicting its own evidence — through a
 * different door. There is now one definition, in `@project-signal/db`, imported by both.
 *
 * ## Why it lives in `apps/api` rather than `libs/db`
 *
 * `libs/db` has no test target: it is a Drizzle schema and a client singleton, and standing up
 * an 80%-coverage gate over declarative table definitions would buy nothing. The API is the
 * predicate's largest consumer — four of the five call sites — and it is where the divergence
 * did its damage, so the cover lives with the consumer.
 *
 * ## Why it renders SQL rather than mocking
 *
 * The route tests mock `@project-signal/db` wholesale, so they can prove a filter was applied but
 * never that the SQL is valid or its parameters correctly typed. This repo has shipped that exact
 * class of bug twice — a JS `Date` interpolated into a raw fragment, passing every mocked test
 * and rejected by Postgres at runtime. Rendering through drizzle's real dialect catches it with
 * no database connection. Same technique as `keyset.test.ts`.
 */
describe('attributedTo', () => {
  const dialect = new PgDialect();
  const brandId = '3f1d4c2a-1111-4a3b-8c1d-000000000001';
  const tenantId = '9a2e7b5c-2222-4d6e-9f0a-000000000002';

  const render = () => dialect.sqlToQuery(attributedTo(brandId, tenantId));

  it('covers both attribution mechanisms — the foreign key OR a mention', () => {
    const { sql } = render();
    const normalised = sql.toLowerCase();

    expect(normalised).toContain('brand_entity_id');
    expect(normalised).toContain('exists');
    expect(normalised).toContain('signal_mentions');
    /* The two mechanisms are alternatives, not both-required. An AND here would silently return
       only signals that are BOTH owned by and mentioned by the brand — which the scorer's
       candidate exclusion makes an empty set, so every list would go blank. */
    expect(normalised).toContain(' or ');
  });

  it('filters the tenant on the signals table AND inside the mention subquery', () => {
    const { sql } = render();
    const normalised = sql.toLowerCase();

    /* Two occurrences: one on `signals`, one on `signal_mentions`. Filtering only the outer
       table would leave cross-tenant rows reachable through the subquery. This product has no
       row-level security, so a predicate that is safe only when the caller remembers to add
       something is not safe. */
    const occurrences = normalised.split('tenant_id').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('binds both ids as parameters rather than interpolating them', () => {
    const { sql, params } = render();

    expect(params).toContain(brandId);
    expect(params).toContain(tenantId);
    /* Neither id may appear in the SQL text. `brandEntityId` reaches this function from a URL
       path and, through the assistant's tools, can be chosen by a language model. */
    expect(sql).not.toContain(brandId);
    expect(sql).not.toContain(tenantId);
  });

  it('binds the tenant twice — once per table it constrains', () => {
    const { params } = render();
    expect(params.filter((p) => p === tenantId)).toHaveLength(2);
  });

  it('renders deterministically, so every call site produces the same population', () => {
    /* The whole point of moving this out of the rollup. If two renders of the same arguments
       could differ, "the API and the rollup agree" would be an assumption rather than a fact. */
    const a = render();
    const b = render();
    expect(a.sql).toBe(b.sql);
    expect(a.params).toEqual(b.params);
  });
});
