/**
 * Integrations routes — manage source_configs for a brand entity.
 *
 * All routes are scoped to the authenticated tenant via request.user.tenantId.
 * Requires admin or higher role.
 *
 * GET    /brands/:id/integrations              — list source_configs for a brand
 * POST   /brands/:id/integrations              — create or upsert a source config
 * PATCH  /brands/:id/integrations/:source      — update isEnabled or config
 * DELETE /brands/:id/integrations/:source      — soft-disable a source config
 */
import { db, sourceConfigs } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../plugins/auth.js';
import { COLLECTING_SOURCES, isCollectingSource } from '@project-signal/shared-types';

interface BrandParams {
  id: string;
}

interface IntegrationParams {
  id: string;
  source: string;
}

interface CreateIntegrationBody {
  source: string;
  config: Record<string, unknown>;
  isEnabled?: boolean;
}

interface UpdateIntegrationBody {
  isEnabled?: boolean;
  config?: Record<string, unknown>;
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
      const { source, config, isEnabled = true } = request.body;

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

      const [row] = await database
        .insert(sourceConfigs)
        .values({
          tenantId,
          brandEntityId,
          source,
          config,
          isEnabled,
        })
        .onConflictDoUpdate({
          target: [sourceConfigs.brandEntityId, sourceConfigs.source],
          set: {
            config,
            isEnabled,
            updatedAt: new Date(),
          },
        })
        .returning();

      return reply.status(200).send({ status: 'ok', data: row });
    },
  );

  /**
   * PATCH /brands/:id/integrations/:source
   * Update isEnabled or config for an existing source_config.
   * Body: { isEnabled?: boolean, config?: object }
   */
  fastify.patch<{ Params: IntegrationParams; Body: UpdateIntegrationBody }>(
    '/brands/:id/integrations/:source',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId, source } = request.params;
      const { isEnabled, config } = request.body;

      const updates: Partial<typeof sourceConfigs.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (isEnabled !== undefined) {
        updates.isEnabled = isEnabled;
      }
      if (config !== undefined) {
        updates.config = config;
      }

      const [row] = await database
        .update(sourceConfigs)
        .set(updates)
        .where(
          and(
            eq(sourceConfigs.tenantId, tenantId),
            eq(sourceConfigs.brandEntityId, brandEntityId),
            eq(sourceConfigs.source, source),
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
   * DELETE /brands/:id/integrations/:source
   * Soft-disable: sets is_enabled = false rather than deleting the row.
   * Hard deletes are not supported to preserve audit history.
   */
  fastify.delete<{ Params: IntegrationParams }>(
    '/brands/:id/integrations/:source',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId, source } = request.params;

      const [row] = await database
        .update(sourceConfigs)
        .set({ isEnabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(sourceConfigs.tenantId, tenantId),
            eq(sourceConfigs.brandEntityId, brandEntityId),
            eq(sourceConfigs.source, source),
          ),
        )
        .returning();

      if (!row) {
        return reply.status(404).send({ status: 'error', error: 'integration not found' });
      }

      return reply.status(200).send({ status: 'ok', data: row });
    },
  );
}

