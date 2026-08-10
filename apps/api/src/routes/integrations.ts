/**
 * Integrations routes — manage source_configs for a brand entity.
 *
 * All routes are scoped to the authenticated tenant via request.user.tenantId.
 * Requires admin or higher role.
 *
 * GET    /brands/:id/integrations              — list every configured feed for a brand
 * POST   /brands/:id/integrations              — add a feed (many per source type are expected)
 * PATCH  /brands/:id/integrations/:configId    — update label, isEnabled or config
 * DELETE /brands/:id/integrations/:configId    — remove a feed
 *
 * MANY FEEDS PER SOURCE TYPE. These routes used to be keyed on the source TYPE — one `rss` per
 * brand, addressed as /integrations/rss — and POST upserted onto a unique(brand, source) index.
 * Adding a second RSS feed therefore did not fail; it silently OVERWROTE the first, and the list
 * then showed one row as though that had always been the whole configuration. A brand tracking
 * both "Tes Global" and "Tes MyConcern" on Google News could only ever have one of them.
 *
 * Feeds are now addressed by their own id, because the type no longer identifies one.
 */
import { db, signals, sourceConfigs } from '@project-signal/db';
import { and, count, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../plugins/auth.js';
import { COLLECTING_SOURCES, isCollectingSource } from '@project-signal/shared-types';

interface BrandParams {
  id: string;
}

interface IntegrationParams {
  id: string;
  /** The source_config's own id. The source TYPE no longer identifies a single row. */
  configId: string;
}

interface CreateIntegrationBody {
  source: string;
  config: Record<string, unknown>;
  /** What a person calls this feed. Optional; the UI falls back to summarising the config. */
  label?: string;
  isEnabled?: boolean;
}

interface UpdateIntegrationBody {
  isEnabled?: boolean;
  config?: Record<string, unknown>;
  label?: string;
}

// ---------------------------------------------------------------------------
// Route plugin — register with fastify.register(integrationsRoutes)
// ---------------------------------------------------------------------------

export async function integrationsRoutes(fastify: FastifyInstance): Promise<void> {
  const database = db.get();

  /**
   * GET /brands/:id/integrations
   * List all source_configs for the given brand (tenant-scoped).
   */
  fastify.get<{ Params: BrandParams }>('/brands/:id/integrations', {
    preHandler: requireRole('admin', 'owner'),
  }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id: brandEntityId } = request.params;

    const rows = await database
      .select()
      .from(sourceConfigs)
      .where(
        and(
          eq(sourceConfigs.tenantId, tenantId),
          eq(sourceConfigs.brandEntityId, brandEntityId),
        ),
      );

    return reply.status(200).send({ status: 'ok', data: rows });
  });

  /**
   * POST /brands/:id/integrations
   * Create or upsert a source_config for a brand.
   * Body: { source: string, config: object, isEnabled?: boolean }
   */
  fastify.post<{ Params: BrandParams; Body: CreateIntegrationBody }>(
    '/brands/:id/integrations',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;
      const { source, config, label, isEnabled = true } = request.body;

      if (!source || typeof source !== 'string') {
        return reply.status(400).send({ status: 'error', error: 'source is required' });
      }
      /* Reject a source with no collector rather than storing a configuration the pipeline can
         never honour.

         Any string was previously accepted. The row was written, the UI listed the source as
         configured and enabled, and every collection run then threw "No adapter for source" —
         an error the dispatcher counts as a failed source and drops. Nothing ever surfaced to
         the person who configured it, so the only symptom was a source that silently produced
         no signals, which is indistinguishable from nobody talking about the brand. */
      if (!isCollectingSource(source)) {
        return reply.status(400).send({
          status: 'error',
          error: `No collector exists for source '${source}'. Available: ${COLLECTING_SOURCES.join(', ')}.`,
        });
      }
      if (!config || typeof config !== 'object') {
        return reply.status(400).send({ status: 'error', error: 'config must be an object' });
      }

      /* An EXACT duplicate is refused, a different one of the same type is not.
         Two Google News feeds on different search terms are the entire point; the same URL twice
         is a double-submit, and collecting it twice would double that feed's cost for nothing.
         Compared here rather than enforced by a constraint, because a JSONB unique index would
         surface as a violation the user cannot read, and because "same feed" means equal config
         rather than equal row. */
      const existing = await database
        .select({ id: sourceConfigs.id, config: sourceConfigs.config })
        .from(sourceConfigs)
        .where(
          and(
            eq(sourceConfigs.tenantId, tenantId),
            eq(sourceConfigs.brandEntityId, brandEntityId),
            eq(sourceConfigs.source, source),
          ),
        );

      const duplicate = existing.find((row) => sameConfig(row.config, config));
      if (duplicate) {
        return reply.status(409).send({
          status: 'error',
          error: 'This exact feed is already configured for this brand.',
          data: { id: duplicate.id },
        });
      }

      const [row] = await database
        .insert(sourceConfigs)
        .values({
          tenantId,
          brandEntityId,
          source,
          label: label?.trim() || null,
          config,
          isEnabled,
        })
        .returning();

      /* 201, not 200. This creates a feed every time now — there is no upsert path left, and a
         200 would go on implying that repeating the call is idempotent when it is not. */
      return reply.status(201).send({ status: 'ok', data: row });
    },
  );

  /**
   * PATCH /brands/:id/integrations/:configId
   * Update label, isEnabled or config for one feed.
   */
  fastify.patch<{ Params: IntegrationParams; Body: UpdateIntegrationBody }>(
    '/brands/:id/integrations/:configId',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId, configId } = request.params;
      const { isEnabled, config, label } = request.body;

      const updates: Partial<typeof sourceConfigs.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (isEnabled !== undefined) updates.isEnabled = isEnabled;
      if (config !== undefined) updates.config = config;
      /* An empty string clears the label rather than storing "". `undefined` means untouched;
         the two are different requests and collapsing them would make a label unremovable. */
      if (label !== undefined) updates.label = label.trim() || null;

      const [row] = await database
        .update(sourceConfigs)
        .set(updates)
        /* Both the brand and the tenant, as well as the id. The id alone would be enough to find
           the row and is exactly how one tenant edits another's feed by pasting a uuid. */
        .where(
          and(
            eq(sourceConfigs.tenantId, tenantId),
            eq(sourceConfigs.brandEntityId, brandEntityId),
            eq(sourceConfigs.id, configId),
          ),
        )
        .returning();

      if (!row) {
        return reply.status(404).send({ status: 'error', error: 'integration not found' });
      }

      return reply.status(200).send({ status: 'ok', data: row });
    },
  );

  /**
   * DELETE /brands/:id/integrations/:configId
   * Remove one feed.
   *
   * A REAL delete, where this used to soft-disable by setting is_enabled = false. That was
   * defensible when a brand could hold at most one feed of each type: the row was the only record
   * that the type had ever been configured, and disabling kept it visible. It is not defensible
   * now. A brand may accumulate a dozen feeds, several added by mistake, and a delete that leaves
   * every one of them in the list forever makes the screen unusable — while offering no way at
   * all to remove a mistyped URL.
   *
   * Nothing collected is lost. `signals.source_config_id` is ON DELETE SET NULL, so every signal
   * this feed gathered survives with its text, its URL and its scores; only the pointer back to
   * the configuration goes. Disabling remains available through PATCH for the case it was really
   * meant for — pausing a feed you intend to bring back.
   */
  fastify.delete<{ Params: IntegrationParams }>(
    '/brands/:id/integrations/:configId',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId, configId } = request.params;

      const [row] = await database
        .delete(sourceConfigs)
        .where(
          and(
            eq(sourceConfigs.tenantId, tenantId),
            eq(sourceConfigs.brandEntityId, brandEntityId),
            eq(sourceConfigs.id, configId),
          ),
        )
        .returning();

      if (!row) {
        return reply.status(404).send({ status: 'error', error: 'integration not found' });
      }

      return reply.status(200).send({ status: 'ok', data: row });
    },
  );

  /**
   * GET /brands/:id/integrations/stats
   *
   * What each feed has actually produced: how many signals, how many of those are scored, and
   * when the newest one was published.
   *
   * This is what makes many feeds per type answerable rather than merely possible. Once a brand
   * has six Google News searches, "rss collected 400 signals" is not a fact anyone can act on —
   * the questions are which search is carrying the coverage, which has returned nothing for a
   * month because its URL is wrong, and which one the findings in a report came from. Without
   * this endpoint a dead feed is indistinguishable from a quiet market, which is precisely the
   * confusion this product exists to remove.
   *
   * A LEFT JOIN, deliberately. A feed that has collected nothing is the single most important row
   * here, and an inner join would drop it.
   */
  fastify.get<{ Params: BrandParams }>(
    '/brands/:id/integrations/stats',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;

      const rows = await database
        .select({
          id: sourceConfigs.id,
          source: sourceConfigs.source,
          label: sourceConfigs.label,
          isEnabled: sourceConfigs.isEnabled,
          lastFetchedAt: sourceConfigs.lastFetchedAt,
          signalCount: count(signals.id),
          latestSignalAt: max(signals.publishedAt),
        })
        .from(sourceConfigs)
        .leftJoin(signals, eq(signals.sourceConfigId, sourceConfigs.id))
        .where(
          and(
            eq(sourceConfigs.tenantId, tenantId),
            eq(sourceConfigs.brandEntityId, brandEntityId),
          ),
        )
        .groupBy(
          sourceConfigs.id,
          sourceConfigs.source,
          sourceConfigs.label,
          sourceConfigs.isEnabled,
          sourceConfigs.lastFetchedAt,
        );

      return reply.status(200).send({ status: 'ok', data: rows });
    },
  );
}

/**
 * Are two feed configurations the same feed?
 *
 * Key-order-independent, because `{feedUrl, country}` and `{country, feedUrl}` are the same
 * feed and `JSON.stringify` says otherwise. Values are compared as strings so that `50` and
 * `"50"` — which is what a form submits — do not read as two different feeds.
 */
function sameConfig(a: unknown, b: Record<string, unknown>): boolean {
  if (!a || typeof a !== 'object') return false;
  const left = a as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(b)]);
  for (const key of keys) {
    if (String(left[key] ?? '') !== String(b[key] ?? '')) return false;
  }
  return true;
}
