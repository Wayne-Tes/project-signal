import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { brandEntities, db, dimensionScores } from '@project-signal/db';
import { requireBrandAccess } from '../plugins/auth.js';

/**
 * The portfolio index — how everything beneath a brand is perceived, as distinct from how the
 * brand itself is.
 *
 * Tes is a group of ~20 products. Two questions are being asked and they are not the same:
 * "how is Tes seen" (corporate coverage, the brand entity's own signals) and "how is what Tes
 * sells seen" (the products). A single blended number answers neither, which is why this is a
 * separate figure rather than a change to the brand's own score.
 *
 * COMPUTED ON READ, from the children's existing daily rollups. Those are already aggregated per
 * entity per day, so this is an average over tens of rows, not a scan of signals. Storing it
 * would buy nothing and introduce a copy that can silently disagree with the children it claims
 * to summarise — the failure mode where a dashboard total and its own breakdown do not add up.
 *
 * WEIGHTED BY SIGNAL COUNT, not equally. A product with two thousand signals and one with nine
 * should not move the portfolio by the same amount; equal weighting would let a barely-discussed
 * product swing the number for the whole group.
 */

interface PortfolioMember {
  id: string;
  name: string;
  kind: string;
  score: number | null;
  signalCount: number;
}

const MEMBER_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    kind: { type: 'string' },
    score: { type: 'number', nullable: true },
    signalCount: { type: 'integer' },
  },
};

/** Depth ceiling on the descendant walk — the same reasoning as the cycle guard in brands.ts. */
const MAX_DEPTH = 20;

/**
 * Every descendant of an entity, breadth-first.
 *
 * Iterative with a visited set rather than recursive: if a cycle ever reaches the table by a
 * path that bypasses the API's guard, this must terminate rather than hang the request.
 */
export async function descendantsOf(tenantId: string, rootId: string): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const children: { id: string }[] = await db
      .get()
      .select({ id: brandEntities.id })
      .from(brandEntities)
      .where(
        and(eq(brandEntities.tenantId, tenantId), inArray(brandEntities.parentId, frontier)),
      );

    frontier = [];
    for (const c of children) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      found.push(c.id);
      frontier.push(c.id);
    }
  }

  return found;
}

export const portfolioRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    '/brands/:id/portfolio',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          "The volume-weighted index across everything beneath this brand, and each member's own score. Distinct from the brand's own index, which measures only signals attributed to the brand itself.",
        params: { type: 'object', properties: { id: { type: 'string' } } },
        response: {
          200: {
            type: 'object',
            properties: {
              score: { type: 'number', nullable: true },
              signalCount: { type: 'integer' },
              memberCount: { type: 'integer' },
              scoredMemberCount: { type: 'integer' },
              members: { type: 'array', items: MEMBER_SCHEMA },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const tenantId = request.user.tenantId;

      const descendantIds = await descendantsOf(tenantId, id);
      if (descendantIds.length === 0) {
        /* A brand with no products has no portfolio. Reported as an empty one rather than as a
           score of zero — "nothing beneath this" and "everything beneath this is terrible" are
           very different statements. */
        return reply.send({
          score: null,
          signalCount: 0,
          memberCount: 0,
          scoredMemberCount: 0,
          members: [],
        });
      }

      const entities = await db
        .get()
        .select({ id: brandEntities.id, name: brandEntities.name, kind: brandEntities.kind })
        .from(brandEntities)
        .where(and(eq(brandEntities.tenantId, tenantId), inArray(brandEntities.id, descendantIds)));

      /* Every dimension row for the descendants, newest first. The latest date per entity is the
         one that counts; earlier ones are history and belong to the trend chart. */
      const rows = await db
        .get()
        .select({
          brandEntityId: dimensionScores.brandEntityId,
          date: dimensionScores.date,
          dimension: dimensionScores.dimension,
          score: dimensionScores.score,
          signalCount: dimensionScores.signalCount,
        })
        .from(dimensionScores)
        .where(
          and(
            eq(dimensionScores.tenantId, tenantId),
            inArray(dimensionScores.brandEntityId, descendantIds),
          ),
        )
        .orderBy(desc(dimensionScores.date));

      /* Latest date per entity, then that date's dimensions averaged into the entity's index. */
      const latestDate = new Map<string, string>();
      for (const r of rows) {
        if (!latestDate.has(r.brandEntityId)) latestDate.set(r.brandEntityId, r.date);
      }

      const perEntity = new Map<string, { total: number; count: number; signals: number }>();
      for (const r of rows) {
        if (r.date !== latestDate.get(r.brandEntityId)) continue;
        const acc = perEntity.get(r.brandEntityId) ?? { total: 0, count: 0, signals: 0 };
        acc.total += r.score ?? 0;
        acc.count += 1;
        /* Signal counts are per DIMENSION and a signal can touch several, so summing them across
           dimensions would over-count. The maximum is the closest honest proxy for "how many
           signals stand behind this entity". */
        acc.signals = Math.max(acc.signals, r.signalCount ?? 0);
        perEntity.set(r.brandEntityId, acc);
      }

      const members: PortfolioMember[] = entities.map((e) => {
        const acc = perEntity.get(e.id);
        return {
          id: e.id,
          name: e.name,
          kind: e.kind,
          score: acc && acc.count > 0 ? round(acc.total / acc.count) : null,
          signalCount: acc?.signals ?? 0,
        };
      });

      const scored = members.filter((m) => m.score !== null);
      const totalSignals = scored.reduce((sum, m) => sum + m.signalCount, 0);

      /* Volume-weighted. If every scored member has zero recorded signals — possible if a rollup
         wrote a score without counts — fall back to an equal-weighted mean rather than dividing
         by zero and reporting NaN as a score. */
      let score: number | null = null;
      if (scored.length > 0) {
        score =
          totalSignals > 0
            ? round(scored.reduce((sum, m) => sum + m.score! * m.signalCount, 0) / totalSignals)
            : round(scored.reduce((sum, m) => sum + m.score!, 0) / scored.length);
      }

      members.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));

      return reply.send({
        score,
        signalCount: totalSignals,
        memberCount: members.length,
        scoredMemberCount: scored.length,
        members,
      });
    },
  );
};

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export default portfolioRoutes;
