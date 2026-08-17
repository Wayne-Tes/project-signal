import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_OWNER, DEFAULT_PINNED_USER } from '../helpers/app.js';

/**
 * Recovering the readable text of signals collected before `signals.content` existed.
 *
 * WHY THE BACKFILL MATTERS. 383 signals were collected with their verbatim text written to S3 and
 * nothing but a pointer kept on the row, so the drill-down could show a source name, a date and a
 * link — and a marketing manager had to open every one in a new tab to find out what was actually
 * said. The new column fixes that for future collection; this endpoint is the only thing that
 * fixes it for everything already gathered.
 *
 * The properties worth pinning are the ones that make it safe to run against a live database
 * unattended: it is idempotent, it is resumable, and one unreadable object cannot abort the run
 * for every other row.
 */

const _rowQueue: unknown[][] = [];
let _updates: Record<string, unknown>[] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  ['select', 'from', 'where', 'update', 'limit', 'orderBy'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  /* `set` records what would be written, which is the only way to assert the normalisation
     without a database — a mock that swallows it would let a backfill writing nulls pass. */
  chain['set'] = vi.fn((values: Record<string, unknown>) => {
    _updates.push(values);
    return chain;
  });
  const nextRows = () => (_rowQueue.length ? _rowQueue.shift()! : []);
  chain['then'] = (r: unknown, j?: unknown) =>
    Promise.resolve(nextRows()).then(r as never, j as never);
  return { db: { get: vi.fn(() => chain) }, signals: {}, client: { get: vi.fn() } };
});

const _objects = new Map<string, string>();
let _getCalls: string[] = [];

vi.mock('@project-signal/storage', () => ({
  getObjectStore: () => ({
    get: async (key: string) => {
      _getCalls.push(key);
      const body = _objects.get(key);
      if (body === undefined) throw new Error(`NoSuchKey: ${key}`);
      return body;
    },
    put: async () => 's3://bucket/x',
  }),
  keyFromRef: (ref: string) => {
    const m = /^(?:gs|s3):\/\/[^/]+\/(.+)$/.exec(ref);
    if (!m?.[1]) throw new Error(`Unrecognised raw_storage_ref: ${ref}`);
    return m[1];
  },
}));

import backfillRoutes from '../../src/routes/backfill.js';

beforeEach(() => {
  _rowQueue.length = 0;
  _updates = [];
  _getCalls = [];
  _objects.clear();
});

/**
 * Queues what the mocked database will return, in the order the route asks for it.
 *
 * Three stages, not two: the batch of rows, then ONE awaited result per row that gets updated
 * (the `update().set().where()` chain is awaited and consumes a result), then the remaining-count
 * row. Getting this wrong reads as a routing bug rather than a harness bug — the first version
 * of this helper omitted the update stage and the remaining count came back as 0.
 */
function queue(rows: unknown[], remaining = 0, succeeding = rows.length) {
  _rowQueue.push(rows);
  for (let i = 0; i < succeeding; i += 1) _rowQueue.push([]);
  _rowQueue.push([{ remaining }]);
}

async function run(app: Awaited<ReturnType<typeof buildTestApp>>) {
  return app.inject({ method: 'POST', url: '/admin/backfill/content' });
}

describe('POST /admin/backfill/content', () => {
  it('recovers the text, headline, author and rating from the stored payload', async () => {
    _objects.set(
      'a.json',
      JSON.stringify({
        text: 'It closes whenever I open a class.',
        title: 'Constant crashes',
        metadata: { author: 'e_keane', rating: 2 },
      }),
    );
    queue([{ id: 's1', ref: 's3://bucket/a.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await run(app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ examined: 1, updated: 1, failed: 0 });
    expect(_updates[0]).toMatchObject({
      content: 'Constant crashes\n\nIt closes whenever I open a class.',
      title: 'Constant crashes',
      author: 'e_keane',
      rating: 2,
    });
  });

  it('strips the markup Google News wraps its headline in', async () => {
    /* The single most common payload in the store: an anchor tag with a tracking URL longer than
       the sentence. Left as-is it would be rendered verbatim to a user. */
    _objects.set(
      'b.json',
      JSON.stringify({
        text: '<a href="https://news.google.com/rss/articles/CBMiqgFBVV95cUxQ?oc=5">A better way to help pupils</a>',
        metadata: {},
      }),
    );
    queue([{ id: 's2', ref: 's3://bucket/b.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    await run(app);

    expect(_updates[0]!['content']).toBe('A better way to help pupils');
    expect(String(_updates[0]!['content'])).not.toContain('href');
  });

  it('understands the author aliases each adapter used at the time', async () => {
    /* `author`, `reviewerName`, `authorName`, `username` — four names for one thing across six
       adapters, which is exactly why the column was normalised. Historic objects still carry
       whichever alias was in use, so the backfill has to know all of them. */
    const aliases = [
      ['reviewerName', 'Jo Pro 1606'],
      ['authorName', 'ClassroomCat'],
      ['username', 'u_teachwell'],
    ] as const;

    for (const [key, value] of aliases) {
      _objects.clear();
      _updates = [];
      _rowQueue.length = 0;
      _objects.set('c.json', JSON.stringify({ text: 'body', metadata: { [key]: value } }));
      queue([{ id: 's3', ref: 's3://bucket/c.json' }]);

      const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
      await run(app);
      expect(_updates[0]!['author'], `alias ${key}`).toBe(value);
    }
  });

  it('reads a Google rating from `stars` as well as `rating`', async () => {
    _objects.set('d.json', JSON.stringify({ text: 'Lovely', metadata: { stars: 5 } }));
    queue([{ id: 's4', ref: 's3://bucket/d.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    await run(app);
    expect(_updates[0]!['rating']).toBe(5);
  });

  it('keeps going when one object is missing, instead of losing the batch', async () => {
    /* An object deleted, or a `raw_storage_ref` written before raw storage worked
       (KNOWN-GAPS #4). One bad row must not cost the other 199. */
    _objects.set('ok.json', JSON.stringify({ text: 'Readable', metadata: {} }));
    queue([
      { id: 'bad', ref: 's3://bucket/gone.json' },
      { id: 'good', ref: 's3://bucket/ok.json' },
    ]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await run(app);

    expect(res.json()).toMatchObject({ examined: 2, updated: 1, failed: 1 });
    expect(res.json().errors.join(' ')).toMatch(/NoSuchKey/);
  });

  it('survives a malformed storage reference', async () => {
    queue([{ id: 'weird', ref: 'https://not-a-bucket/thing' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await run(app);

    expect(res.json()).toMatchObject({ failed: 1, updated: 0 });
    expect(res.json().errors.join(' ')).toMatch(/Unrecognised/);
  });

  it('counts an empty payload as failed rather than writing an empty string', async () => {
    /* Writing '' would satisfy `content IS NOT NULL` and permanently exclude the row from every
       later run — hiding the problem instead of recording it as unrecovered. */
    _objects.set('empty.json', JSON.stringify({ text: '   ', metadata: {} }));
    queue([{ id: 'e', ref: 's3://bucket/empty.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await run(app);

    expect(res.json()).toMatchObject({ updated: 0, failed: 1 });
    expect(_updates).toHaveLength(0);
  });

  it('reports distinct reasons, not one line per failed row', async () => {
    queue([
      { id: 'a', ref: 's3://bucket/missing.json' },
      { id: 'b', ref: 's3://bucket/missing.json' },
      { id: 'c', ref: 's3://bucket/missing.json' },
    ]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await run(app);

    expect(res.json().failed).toBe(3);
    expect(res.json().errors).toHaveLength(1);
  });

  it('reports what is left so a caller knows whether to run again', async () => {
    _objects.set('x.json', JSON.stringify({ text: 'one', metadata: {} }));
    queue([{ id: 'x', ref: 's3://bucket/x.json' }], 182);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    expect((await run(app)).json().remaining).toBe(182);
  });

  it('does nothing at all when there is nothing left', async () => {
    queue([]);
    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await run(app);

    expect(res.json()).toMatchObject({ examined: 0, updated: 0, failed: 0 });
    expect(_getCalls).toHaveLength(0);
  });

  it('is available to an admin, because every query is scoped to their own tenant', async () => {
    /* Gated on `owner` at first, which was wrong twice over. The deployed Cognito pool contains
       no owner at all, so nobody could call it — and the role check existed only to compensate
       for queries that had NO tenant filter, in a database with no RLS. Scoping every query to
       `request.user.tenantId` is the stronger guarantee and makes admin safe. */
    queue([]);
    const app = await buildTestApp(backfillRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/admin/backfill/content' });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a plain user — this rewrites stored evidence', async () => {
    const app = await buildTestApp(backfillRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'POST', url: '/admin/backfill/content' });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * Re-deriving from what the SOURCE said, not from what we last decided it said.
 *
 * KNOWN-GAPS #28. The S3 key is derived from the item's external id, so re-collection overwrites
 * the object — and until `schemaVersion: 2` the payload held only the adapter's processed text.
 * A normalisation change therefore rewrote the whole "audit trail" in its own image, and a fix
 * for duplicated Google News headlines could not repair the rows it was written for: the backfill
 * re-read a payload that had already been rewritten with the duplication baked into it.
 */
describe('preferring the untouched source text', () => {
  it('re-derives from sourceText when the payload carries it', async () => {
    _objects.set(
      'v2.json',
      JSON.stringify({
        schemaVersion: 2,
        /* What a previous, broken normalisation left behind — the headline twice. */
        text: 'Report published - Yahoo Finance UK\n\nReport published Yahoo Finance UK',
        sourceText: '<a href="https://news.google.com/rss/articles/CBM">Report published</a>',
        sourceTitle: 'Report published - Yahoo Finance UK',
      }),
    );
    queue([{ id: 's1', ref: 's3://bucket/v2.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    await run(app);

    /* Recovered from the ORIGINAL, so the corruption in `text` is not carried forward. */
    expect(_updates[0]!['content']).not.toMatch(/Report published.*Report published/s);
    expect(_updates[0]!['content']).not.toContain('<a href');
    expect(_updates[0]!['content']).toContain('Report published');
  });

  /* Objects written before the change have no `sourceText`. Falling back to `text` is the best
     available answer and a real limitation — only a fresh collection produces a recoverable
     payload — but it must not fail. */
  it('falls back to the processed text for payloads written before schemaVersion 2', async () => {
    _objects.set('v1.json', JSON.stringify({ text: 'Only the processed form exists here.' }));
    queue([{ id: 's2', ref: 's3://bucket/v1.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await run(app);

    expect(res.json()).toMatchObject({ updated: 1, failed: 0 });
    expect(_updates[0]!['content']).toBe('Only the processed form exists here.');
  });

  it('prefers sourceTitle over the normalised title', async () => {
    _objects.set(
      'v2b.json',
      JSON.stringify({
        schemaVersion: 2,
        text: 'body',
        sourceText: 'body',
        sourceTitle: 'Original &amp; unescaped',
        title: 'something the adapter rewrote',
      }),
    );
    queue([{ id: 's3', ref: 's3://bucket/v2b.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    await run(app);

    /* Entity decoded on the way out, but derived from the SOURCE's title. */
    expect(_updates[0]!['title']).toBe('Original & unescaped');
  });
});

describe('GET /admin/backfill/content/status', () => {
  it('reports how much is left, so a run is a decision rather than a guess', async () => {
    _rowQueue.push([{ total: 383, withContent: 200 }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/backfill/content/status',
    });

    expect(res.json()).toEqual({ total: 383, withContent: 200, remaining: 183 });
  });

  it('refuses a plain user', async () => {
    const app = await buildTestApp(backfillRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/backfill/content/status',
    });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * Recomputing rows that already have content.
 *
 * The normalisation itself improves. The first pass over these 383 rows joined Google News titles
 * to their descriptions, because `<title>` carries a " - Publisher" suffix the description does
 * not — so the two were not equal, were concatenated, and the drill-down rendered the same
 * headline twice. Found by looking at the deployed page, not by a test.
 *
 * Fixing the rule is worthless unless already-recovered rows can be put back through it.
 */
describe('force: recomputing rows that already have content', () => {
  it('clears content first, so the resumable path can refill it', async () => {
    /* The obvious implementation — widening the selection to include non-null rows — never
       terminates: each call re-selects the same first batch and `remaining` never falls.
       Clearing reuses the existing machinery and keeps `remaining` meaningful. */
    _objects.set('r.json', JSON.stringify({ text: 'Recomputed', metadata: {} }));
    _rowQueue.push([]); // the clearing UPDATE
    queue([{ id: 'r', ref: 's3://bucket/r.json' }]);

    const app = await buildTestApp(backfillRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/backfill/content?force=true',
    });

    expect(res.statusCode).toBe(200);
    /* The clear, then the recovery. Two writes, and the second carries the new text. */
    expect(_updates[0]).toEqual({ content: null });
    expect(_updates[1]).toMatchObject({ content: 'Recomputed' });
  });

  it('does not clear anything on an ordinary run', async () => {
    /* The default must stay safe to call repeatedly against a live database. */
    queue([]);
    const app = await buildTestApp(backfillRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'POST', url: '/admin/backfill/content' });

    expect(_updates).toHaveLength(0);
  });
});
