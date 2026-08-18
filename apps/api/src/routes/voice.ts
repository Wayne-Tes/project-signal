import type { FastifyPluginAsync } from 'fastify';
import { accounts, attributedTo, db, sentimentResults, signals } from '@project-signal/db';
import { corroborate, rankByExposure, type ExposureItem } from '@project-signal/scoring';
import type { ArrBand } from '@project-signal/shared-types';
import { and, eq, gte } from 'drizzle-orm';
import { requireBrandAccess } from '../plugins/auth.js';

/**
 * Voice of the customer — what Sales and Customer Success hear directly.
 *
 * ## Its own area, because it is its own measurement
 *
 * This is not the dashboard filtered to a source. A CSM writes a note BECAUSE something needs
 * attention, so the channel is a work queue rather than a sample and is negative-biased by
 * design. Its numbers are therefore never mixed into the Brand Perception Index — see
 * `signals.voice` and the default inside `attributedTo`.
 *
 * ## And its own ranking
 *
 * Every other view ranks by volume. Here that would bury one renewal-risk note from a 250k+
 * account under a subject fifty small accounts mentioned in passing, and it would partly rank the
 * note-taking diligence of individual account managers. Ranking is by distinct accounts and their
 * commercial bands — see `rankByExposure`.
 *
 * ## Empty until a connector exists, and it says so
 *
 * No CRM connector is written yet, deliberately: a field mapping guessed at rather than built
 * against a real sandbox produces plausible commercial data attributed to the wrong account. So
 * this returns empty for every brand today. The empty state distinguishes "no CRM connected" from
 * "connected and nothing found", because those need opposite responses.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 90;

const RANK_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    accounts: { type: 'integer' },
    mentions: { type: 'integer' },
    exposure: { type: 'number' },
    sentiment: { type: 'number' },
    topBand: { type: 'string', nullable: true },
  },
};

const voiceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/brands/:id/voice-of-customer',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'What customers tell Sales and Customer Success directly. Ranked by distinct accounts and their commercial bands rather than by volume, and never mixed into the Brand Perception Index.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 365, default: DEFAULT_WINDOW_DAYS },
            territory: { type: 'string' },
            arrBand: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              connected: { type: 'boolean' },
              interactions: { type: 'integer' },
              accountsHeard: { type: 'integer' },
              themes: { type: 'array', items: RANK_SCHEMA },
              corroborated: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    topic: { type: 'string' },
                    accounts: { type: 'integer' },
                    publicVolume: { type: 'integer' },
                    publicSentiment: { type: 'number' },
                    reportedSentiment: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const {
        days = DEFAULT_WINDOW_DAYS,
        territory,
        arrBand,
      } = request.query as { days?: number; territory?: string; arrBand?: string };

      const tenantId = request.user.tenantId;
      const since = new Date(Date.now() - days * MS_PER_DAY);
      const database = db.get();

      /* `reported` explicitly. The default is `direct` precisely so the index cannot pick this up
         by accident; this is the one view that asks for the other side. */
      const reportedRows = await database
        .select({
          topic: sentimentResults.topics,
          score: sentimentResults.score,
          accountId: signals.accountId,
          arrBand: accounts.arrBand,
          territory: signals.territory,
        })
        .from(signals)
        .innerJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
        /* LEFT join: an interaction not yet matched to an account record is still something a
           customer said, and dropping it would quietly shrink the totals. */
        .leftJoin(accounts, eq(accounts.id, signals.accountId))
        .where(
          and(
            attributedTo(id, tenantId, 'reported'),
            gte(signals.publishedAt, since),
            territory ? eq(signals.territory, territory) : undefined,
            arrBand ? eq(accounts.arrBand, arrBand) : undefined,
          ),
        );

      const items: ExposureItem[] = reportedRows.flatMap((r) =>
        (r.topic ?? []).map((t) => ({
          topic: t,
          accountId: r.accountId,
          arrBand: (r.arrBand ?? null) as ArrBand | null,
          score: r.score ?? 0,
        })),
      );

      const themes = rankByExposure(items);

      /* The public side, for corroboration. Read only when there is a private side to compare it
         against — with no CRM data the join is guaranteed empty and the query is waste. */
      let corroborated: ReturnType<typeof corroborate> = [];
      if (items.length > 0) {
        const publicRows = await database
          .select({ topics: sentimentResults.topics, score: sentimentResults.score })
          .from(signals)
          .innerJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
          .where(and(attributedTo(id, tenantId, 'direct'), gte(signals.publishedAt, since)));

        corroborated = corroborate(
          publicRows.flatMap((r) => (r.topics ?? []).map((t) => ({ topic: t, score: r.score ?? 0 }))),
          items,
        );
      }

      return {
        /* Whether anything has ever arrived through this channel, which is what separates "no CRM
           connected" from "connected and quiet". The two need opposite responses and an empty
           list alone cannot tell them apart. */
        connected: reportedRows.length > 0,
        interactions: reportedRows.length,
        accountsHeard: new Set(reportedRows.map((r) => r.accountId).filter(Boolean)).size,
        themes,
        corroborated,
      };
    },
  );
};

export default voiceRoutes;
