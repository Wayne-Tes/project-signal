import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { keysetBefore } from '../../src/routes/signals.js';

/**
 * Regression cover for the keyset cursor's SQL *serialisation*.
 *
 * The route tests mock `@project-signal/db` entirely, so they can assert that a filter was
 * added but never that the resulting SQL is valid or that its parameters are typed correctly.
 * The first implementation used a raw `sql` row-value comparison, which passed every mocked
 * test and then failed against real Postgres with
 * `params: Thu Jan 01 2026 04:00:00 GMT+0000 (Greenwich Mean Time)` — a JS Date stringified
 * instead of serialised as timestamptz.
 *
 * Rendering the condition through drizzle's real dialect catches that class of bug without a
 * database connection.
 */
describe('keysetBefore', () => {
  const dialect = new PgDialect();
  const publishedAt = new Date('2026-01-01T04:00:00.000Z');
  const id = 'ac85dc3d-e6ea-473c-803f-eac99157a0ec';

  it('serialises the timestamp as ISO-8601, not a JS Date toString', () => {
    const { params } = dialect.sqlToQuery(keysetBefore(publishedAt, id)!);

    expect(params).toContain(id);

    // The bug produced "Thu Jan 01 2026 04:00:00 GMT+0000 (Greenwich Mean Time)", which
    // Postgres cannot parse as timestamptz. Drizzle's typed operators emit ISO-8601.
    const timestamps = params.filter((p) => p !== id);
    expect(timestamps.length).toBeGreaterThan(0);
    for (const t of timestamps) {
      expect(String(t)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('renders a predicate matching ORDER BY published_at DESC, id DESC', () => {
    const { sql: text } = dialect.sqlToQuery(keysetBefore(publishedAt, id)!);
    const normalised = text.toLowerCase();

    expect(normalised).toContain('published_at');
    expect(normalised).toContain('"id"');
    expect(normalised).toContain('or');
    expect(normalised).toContain('<');
  });
});
