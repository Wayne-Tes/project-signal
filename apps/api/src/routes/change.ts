import type { FastifyPluginAsync } from 'fastify';
import { attributedTo, db, signals, sentimentResults, territoryFilter } from '@project-signal/db';
import {
  summariseChange,
  type ChangeBasis,
  type ChangeItem,
  type ChangeSummary,
} from '@project-signal/scoring';
import type { SentimentLabel } from '@project-signal/shared-types';
import { and, eq, gte, sql } from 'drizzle-orm';
import { requireBrandAccess } from '../plugins/auth.js';

/**
 * What changed — the endpoint behind "what is new this week, and are we making it better".
 *
 * The product could say what perception IS and never what it DID. Everything here is computed on
 * read; see `libs/scoring/src/change.ts` for why no snapshot table exists and the measurement
 * that would justify one.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

const TOPIC_CHANGE = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    volume: { type: 'integer' },
    previousVolume: { type: 'integer' },
    sentiment: { type: 'number' },
    previousSentiment: { type: 'number', nullable: true },
    volumeDelta: { type: 'integer' },
    sentimentDelta: { type: 'number', nullable: true },
    firstSeenAt: { type: 'string', nullable: true },
    isNew: { type: 'boolean' },
    sampleSignalIds: { type: 'array', items: { type: 'string' } },
  },
};

const SOURCE_CHANGE = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    volume: { type: 'integer' },
    previousVolume: { type: 'integer' },
    sentiment: { type: 'number', nullable: true },
    previousSentiment: { type: 'number', nullable: true },
    sentimentDelta: { type: 'number', nullable: true },
  },
};

/**
 * When each topic was FIRST seen for this brand, across its whole history.
 *
 * Read separately from the window query and deliberately unbounded in time, because "new" is a
 * claim about all of history: a topic discussed in March, quiet in July and back this week is
 * RETURNING, and calling it new sends whoever acts on it hunting a cause that is months old.
 * Bounding this to the same 360-day window as the rollup would quietly convert "new" into "not
 * seen recently", which is a different and much weaker statement.
 *
 * It stays cheap because it returns one row per distinct topic — tens of rows — rather than one
 * per signal. `unnest` in a lateral join rather than reading arrays into the app for the same
 * reason.
 *
 * Both dates are aggregated so `basis` can pick without a second query.
 *
 * **SCOPED TO THE SAME TERRITORY AS THE WINDOW, and that is not cosmetic.** "New" means new *to
 * the thing you are looking at*. A topic that has been running in the US for a year and has just
 * appeared in the UK is genuinely new to a UK channel manager, and an unscoped first-seen lookup
 * would suppress it — the one row on the page they most needed to see, hidden by data about a
 * market they were not asking about.
 */
async function readFirstSeen(
  brandEntityId: string,
  tenantId: string,
  basis: ChangeBasis,
  territory?: string,
): Promise<Map<string, Date>> {
  const column = basis === 'ingested' ? signals.ingestedAt : signals.publishedAt;

  /* Raw SQL because drizzle has no lateral-unnest builder. The predicate is embedded rather than
     rebuilt by hand so it cannot drift from every other read path, and the topic is normalised in
     the database with the same rule `normaliseTopic` applies in the app — lower, trimmed — so the
     two sides of the comparison cannot disagree. */
  const rows = await db.get().execute<{ topic: string; first_at: string }>(sql`
    SELECT lower(btrim(t.topic)) AS topic, MIN(${column}) AS first_at
    FROM ${signals}
    INNER JOIN ${sentimentResults} ON ${sentimentResults.signalId} = ${signals.id}
    CROSS JOIN LATERAL unnest(${sentimentResults.topics}) AS t(topic)
    WHERE ${and(attributedTo(brandEntityId, tenantId), territoryFilter(territory))}
      AND btrim(t.topic) <> ''
    GROUP BY 1
  `);

  const out = new Map<string, Date>();
  for (const row of rows) {
    if (!row.topic) continue;
    out.set(row.topic, new Date(row.first_at));
  }
  return out;
}

const changeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/brands/:id/whats-new',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'What changed over the last `days`, against the equal-length period before it: topics never seen before, topics more and less discussed, topics whose sentiment moved, and the same movement per source.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: {
            days: {
              type: 'integer',
              minimum: 1,
              maximum: MAX_WINDOW_DAYS,
              default: DEFAULT_WINDOW_DAYS,
            },
            basis: {
              type: 'string',
              enum: ['ingested', 'published'],
              default: 'ingested',
              description:
                '`ingested` is what WE learned in the window — the honest basis for "what is new since the last scans", because a newly connected feed surfaces old material. `published` is what the world said in the window, and is the right basis for trend.',
            },
            source: { type: 'string', description: 'Restrict to one source type.' },
            territory: {
              type: 'string',
              description:
                "Restrict to one territory. Omit, or pass 'all', for every territory combined.",
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              basis: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              signalsThisPeriod: { type: 'integer' },
              signalsPreviousPeriod: { type: 'integer' },
              backfilledThisPeriod: { type: 'integer' },
              sentiment: { type: 'number', nullable: true },
              previousSentiment: { type: 'number', nullable: true },
              sentimentDelta: { type: 'number', nullable: true },
              newTopics: { type: 'array', items: TOPIC_CHANGE },
              risingTopics: { type: 'array', items: TOPIC_CHANGE },
              fallingTopics: { type: 'array', items: TOPIC_CHANGE },
              improvingTopics: { type: 'array', items: TOPIC_CHANGE },
              worseningTopics: { type: 'array', items: TOPIC_CHANGE },
              bySource: { type: 'array', items: SOURCE_CHANGE },
            },
          },
        },
      },
    },
    async (request): Promise<ChangeSummary> => {
      const { id } = request.params as { id: string };
      const {
        days = DEFAULT_WINDOW_DAYS,
        basis = 'ingested',
        source,
        territory,
      } = request.query as {
        days?: number;
        basis?: ChangeBasis;
        source?: string;
        territory?: string;
      };

      const tenantId = request.user.tenantId;
      const asOf = new Date();
      /* Both windows in one read. The comparison period is the same length as the current one —
         seven days against thirty would make every topic look like it is collapsing, and that is
         the direction of error nobody questions. */
      const since = new Date(asOf.getTime() - 2 * days * MS_PER_DAY);
      const dateColumn = basis === 'ingested' ? signals.ingestedAt : signals.publishedAt;

      const filters = [attributedTo(id, tenantId), gte(dateColumn, since)];
      if (source) filters.push(eq(signals.source, source));
      const byTerritory = territoryFilter(territory);
      if (byTerritory) filters.push(byTerritory);

      const rows = await db
        .get()
        .select({
          signalId: signals.id,
          publishedAt: signals.publishedAt,
          ingestedAt: signals.ingestedAt,
          source: signals.source,
          score: sentimentResults.score,
          label: sentimentResults.label,
          topics: sentimentResults.topics,
        })
        .from(signals)
        /* INNER, unlike `/signals`: an unscored signal has no sentiment and no topics, so it
           cannot contribute to any comparison here. It is still counted by `/stats`, which is
           where "collected but not yet scored" belongs. */
        .innerJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
        .where(and(...filters));

      const items: ChangeItem[] = rows.map((r) => ({
        signalId: r.signalId,
        publishedAt: r.publishedAt,
        ingestedAt: r.ingestedAt,
        source: r.source,
        // A missing score is neutral, not zero-confidence-weighted — this endpoint reports means,
        // not the index, and has no confidence weighting to apply.
        score: r.score ?? 0,
        label: (r.label ?? 'neutral') as SentimentLabel,
        topics: r.topics ?? [],
      }));

      const firstSeen = await readFirstSeen(id, tenantId, basis, territory);
      return summariseChange(items, firstSeen, { asOf, days, basis });
    },
  );
};

export default changeRoutes;
