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
import { requireBrandAccess, requireRole } from '../plugins/auth.js';
import { ID_PARAMS, UUID } from '../lib/http.js';
import { brandInTenant } from '../lib/tenancy.js';
import {
  COLLECTING_SOURCES,
  isCollectingSource,
  normaliseTerritory,
  TERRITORIES,
} from '@project-signal/shared-types';

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
  territory?: string;
}

interface UpdateIntegrationBody {
  territory?: string;
  isEnabled?: boolean;
  config?: Record<string, unknown>;
  label?: string;
}

const INTEGRATION_PARAMS = {
  type: 'object',
  required: ['id', 'configId'],
  properties: { id: UUID, configId: UUID },
} as const;

/* `config` is adapter-specific (a feed URL, a place id, a channel id…) and validated by the
   collector that reads it, so its keys are open — but it must be an object, and the request
   around it is closed. The previous routes had no schema at all: a non-string `label` reached
   `label.trim()` and threw, turning a client mistake into a 500. */
const CONFIG = { type: 'object', maxProperties: 20 } as const;
const LABEL = { type: 'string', maxLength: 200 } as const;
const TERRITORY = { type: 'string', maxLength: 32 } as const;

const CREATE_BODY = {
  type: 'object',
  required: ['source', 'config'],
  additionalProperties: false,
  properties: {
    source: { type: 'string', minLength: 1, maxLength: 64 },
    config: CONFIG,
    label: LABEL,
    isEnabled: { type: 'boolean' },
    territory: TERRITORY,
  },
} as const;

const UPDATE_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    config: CONFIG,
    label: LABEL,
    isEnabled: { type: 'boolean' },
    territory: TERRITORY,
  },
} as const;

/* requireBrandAccess for uniformity with every other `/brands/:id…` route; the role check is
   what actually restricts these to administrators. */
const GUARDS = [requireBrandAccess, requireRole('admin', 'owner')];

// ---------------------------------------------------------------------------
// Route plugin — register with fastify.register(integrationsRoutes)
// ---------------------------------------------------------------------------

export async function integrationsRoutes(fastify: FastifyInstance): Promise<void> {
  const database = db.get();

  /**
   * GET /brands/:id/integrations
   * List all source_configs for the given brand (tenant-scoped).
   */
  fastify.get<{ Params: BrandParams }>(
    '/brands/:id/integrations',
    {
      preHandler: GUARDS,
      schema: { params: ID_PARAMS },
    },
    async (request) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;

      const rows = await database
        .select()
        .from(sourceConfigs)
        .where(
          and(eq(sourceConfigs.tenantId, tenantId), eq(sourceConfigs.brandEntityId, brandEntityId)),
        );

      return rows;
    },
  );

  /**
   * POST /brands/:id/integrations
   * Create or upsert a source_config for a brand.
   * Body: { source: string, config: object, isEnabled?: boolean }
   */
  fastify.post<{ Params: BrandParams; Body: CreateIntegrationBody }>(
    '/brands/:id/integrations',
    { preHandler: GUARDS, schema: { params: ID_PARAMS, body: CREATE_BODY } },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;
      const { source, config, label, isEnabled = true, territory } = request.body;
      /* Reject a source with no collector rather than storing a configuration the pipeline can
         never honour.

         Any string was previously accepted. The row was written, the UI listed the source as
         configured and enabled, and every collection run then threw "No adapter for source" —
         an error the dispatcher counts as a failed source and drops. Nothing ever surfaced to
         the person who configured it, so the only symptom was a source that silently produced
         no signals, which is indistinguishable from nobody talking about the brand. */
      if (!isCollectingSource(source)) {
        return reply.badRequest(
          `No collector exists for source '${source}'. Available: ${COLLECTING_SOURCES.join(', ')}.`,
        );
      }
      /* Refused rather than stored, for the same reason a source with no collector is refused
         (KNOWN-GAPS #24): a feed filed under the wrong territory produces reporting that is
         confidently wrong, and nobody ever finds it. `normaliseTerritory` corrects the spellings
         the marketing team's channel sheet actually uses — "UK", "AUS", "USA" — and returns null
         for anything it cannot resolve, including the sheet's six "Global?" entries, where the
         question mark is its author saying they are unsure. Guessing on their behalf is exactly
         what must not happen. */
      const resolvedTerritory = territory === undefined ? 'unknown' : normaliseTerritory(territory);
      if (resolvedTerritory === null) {
        return reply.badRequest(
          `Unrecognised territory '${territory}'. Use an ISO 3166-1 alpha-2 code, GLOBAL, or unknown. Valid: ${TERRITORIES.join(', ')}.`,
        );
      }

      /* The brand must be the caller's. The insert stamps the CALLER's tenant with the URL's
         brand id; without this check an admin could point a feed at another tenant's brand by
         pasting its id, and collection would then write signals against it. After input
         validation, so a malformed request is a 400 without touching the database. */
      if (!(await brandInTenant(tenantId, brandEntityId))) {
        return reply.notFound('Brand not found');
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
        return reply.conflict('This exact feed is already configured for this brand.');
      }

      const [row] = await database
        .insert(sourceConfigs)
        .values({
          tenantId,
          brandEntityId,
          source,
          label: label?.trim() || null,
          territory: resolvedTerritory,
          config,
          isEnabled,
        })
        .returning();

      /* 201, not 200. This creates a feed every time now — there is no upsert path left, and a
         200 would go on implying that repeating the call is idempotent when it is not. */
      return reply.status(201).send(row);
    },
  );

  /**
   * PATCH /brands/:id/integrations/:configId
   * Update label, isEnabled or config for one feed.
   */
  fastify.patch<{ Params: IntegrationParams; Body: UpdateIntegrationBody }>(
    '/brands/:id/integrations/:configId',
    { preHandler: GUARDS, schema: { params: INTEGRATION_PARAMS, body: UPDATE_BODY } },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId, configId } = request.params;
      const { isEnabled, config, label, territory } = request.body;

      const updates: Partial<typeof sourceConfigs.$inferInsert> = {
        updatedAt: new Date(),
      };

      /* Changing this does NOT rewrite the territory of signals already collected. Those were
         collected from a feed that was configured this way at the time, and that is a fact about
         the past — `signals.territory` is stamped at insert precisely so it survives both a
         reconfiguration and a deletion. Correcting a misconfiguration retrospectively is an
         explicit backfill, which is a separate, deliberate act. */
      if (territory !== undefined) {
        const resolved = normaliseTerritory(territory);
        if (resolved === null) {
          return reply.badRequest(
            `Unrecognised territory '${territory}'. Use an ISO 3166-1 alpha-2 code, GLOBAL, or unknown. Valid: ${TERRITORIES.join(', ')}.`,
          );
        }
        updates.territory = resolved;
      }
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
        return reply.notFound('Integration not found');
      }

      return row;
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
    { preHandler: GUARDS, schema: { params: INTEGRATION_PARAMS } },
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
        return reply.notFound('Integration not found');
      }

      return row;
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
    { preHandler: GUARDS, schema: { params: ID_PARAMS } },
    async (request) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;

      const rows = await database
        .select({
          id: sourceConfigs.id,
          source: sourceConfigs.source,
          label: sourceConfigs.label,
          territory: sourceConfigs.territory,
          isEnabled: sourceConfigs.isEnabled,
          lastFetchedAt: sourceConfigs.lastFetchedAt,
          signalCount: count(signals.id),
          latestSignalAt: max(signals.publishedAt),
        })
        .from(sourceConfigs)
        .leftJoin(signals, eq(signals.sourceConfigId, sourceConfigs.id))
        .where(
          and(eq(sourceConfigs.tenantId, tenantId), eq(sourceConfigs.brandEntityId, brandEntityId)),
        )
        .groupBy(
          sourceConfigs.id,
          sourceConfigs.source,
          sourceConfigs.label,
          sourceConfigs.isEnabled,
          sourceConfigs.lastFetchedAt,
        );

      return rows;
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
