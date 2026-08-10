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

describe('topic filter SQL', () => {
  /**
   * The topic filter renders raw `sql`, so — exactly like the keyset predicate above — a mocked
   * database would pass while Postgres rejected it. This renders the fragment through drizzle's
   * real dialect to check both that it is valid and, more importantly, that the topic is a BOUND
   * PARAMETER.
   *
   * That matters more here than anywhere else in this file: the topic arrives from a URL and,
   * via the assistant's tools, can be chosen by a language model. Interpolated into the SQL text
   * it would be an injection point reachable by asking a chatbot nicely.
   */
  it('binds the topic as a parameter rather than interpolating it', async () => {
    const { topicFilter } = await import('../../src/routes/signals.js');
    const dialect = new PgDialect();
    const evil = "delivery'); DROP TABLE signals; --";
    const { sql: text, params } = dialect.sqlToQuery(topicFilter(evil));

    expect(params).toContain(evil);
    expect(text).not.toContain('DROP TABLE');
    expect(text.toLowerCase()).toContain('exists');
    expect(text.toLowerCase()).toContain('any');
  });

  it('matches against the scored row rather than joining it', () => {
    /* A join would multiply the signal row by its topics, silently breaking the page size and
       the keyset cursor, both of which assume one row per signal. */
    const dialect = new PgDialect();
    return import('../../src/routes/signals.js').then(({ topicFilter }) => {
      const { sql: text } = dialect.sqlToQuery(topicFilter('delivery'));
      expect(text.toLowerCase()).toContain('select 1');
      expect(text.toLowerCase()).not.toContain('join');
    });
  });
});

/**
 * The dimension filter.
 *
 * Added so the drill-down can answer "show me the five signals that contributed to Experience".
 * Before it existed there was no way to ask: the only narrowing available was by TOPIC, and a
 * dimension whose signals are positive forms no damaging topic cluster, so the level dead-ended
 * on a message telling the user nothing had been tagged to it — under a row that had just
 * counted five things.
 *
 * Rendered through the real dialect for the same reason as everything else in this file: raw
 * `sql` passes a mocked database and then fails, or worse succeeds, against Postgres.
 */
describe('dimension filter SQL', () => {
  const dialect = new PgDialect();

  it('binds the dimension as a parameter rather than interpolating it', async () => {
    /* Reachable from a URL and, through the assistant's tools, choosable by a language model —
       the same exposure the topic filter has. The route additionally pins it to an enum, but
       defence in depth is the point: the enum is a schema decision one edit away from changing,
       and the binding is what makes that edit safe. */
    const { dimensionFilter } = await import('../../src/routes/signals.js');
    const evil = "trust'); DROP TABLE signals; --";
    const { sql: text, params } = dialect.sqlToQuery(dimensionFilter(evil));

    expect(params).toContain(evil);
    expect(text).not.toContain('DROP TABLE');
    expect(text.toLowerCase()).toContain('exists');
    expect(text.toLowerCase()).toContain('any');
  });

  it('matches against the scored row rather than joining it', async () => {
    /* `dimensions` is a text[] like `topics`; a join would multiply the signal row by its
       dimensions and break both the page size and the keyset cursor. */
    const { dimensionFilter } = await import('../../src/routes/signals.js');
    const { sql: text } = dialect.sqlToQuery(dimensionFilter('experience'));

    expect(text.toLowerCase()).toContain('select 1');
    expect(text.toLowerCase()).not.toContain('join');
  });

  it('reads the dimensions column, not the topics column', async () => {
    /* The two fragments are near-identical and copy-paste between them would be silent: the
       filter would still return rows, just the wrong ones. */
    const { dimensionFilter } = await import('../../src/routes/signals.js');
    const { sql: text } = dialect.sqlToQuery(dimensionFilter('experience'));

    expect(text).toContain('"dimensions"');
    expect(text).not.toContain('"topics"');
  });
});
