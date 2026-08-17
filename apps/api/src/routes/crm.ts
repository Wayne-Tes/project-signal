import type { FastifyPluginAsync } from 'fastify';
import { crmConnections, db } from '@project-signal/db';
import { CRM_PROVIDERS, isCrmProvider } from '@project-signal/shared-types';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../plugins/auth.js';
import { deleteTokens, writeTokens, type CrmTokens } from '../lib/crm-secrets.js';

/**
 * CRM connections — the plumbing, deliberately stopping short of a connector.
 *
 * ## What this does and does not do
 *
 * It manages the LINK: store the tokens, record who connected it, report its health, disconnect
 * it. What it does not contain is a field mapping for HubSpot or Salesforce, and that omission is
 * a decision rather than an unfinished edge.
 *
 * A mapper written against a guessed payload shape is exactly the fabrication `DEVRULES.md`
 * forbids — and it fails in the worst possible way: not with an error, but with plausible data
 * attributed to the wrong account. The connector gets written against a real sandbox, from real
 * responses, and not before.
 *
 * ## Nothing here reaches personal data
 *
 * Storing a token and reading a connection's status touches no customer record. The point at
 * which this system first processes CRM personal data is the sync, which does not exist yet — so
 * the data-protection sign-off recorded in `docs/PLAN-change-territory-and-actions.md` §8.3
 * gates the connector, not this. Building the plumbing first is what makes that sign-off a
 * scheduling question rather than a blocker.
 *
 * ## Tokens are never returned
 *
 * No route in this file responds with a token, and none logs one. Everything the UI needs is the
 * provider, the status, and when it last worked.
 */

const CONNECTION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    provider: { type: 'string' },
    instanceUrl: { type: 'string', nullable: true },
    scopes: { type: 'array', items: { type: 'string' } },
    status: { type: 'string' },
    connectedBy: { type: 'string' },
    lastSyncedAt: { type: 'string', nullable: true },
    lastAttemptedAt: { type: 'string', nullable: true },
    lastError: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
  },
};

/** Serialises a row for the wire. `secretArn` is omitted — the UI has no use for it. */
function toWire(row: typeof crmConnections.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    provider: row.provider,
    instanceUrl: row.instanceUrl,
    scopes: row.scopes,
    status: row.status,
    connectedBy: row.connectedBy,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastAttemptedAt: row.lastAttemptedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

const crmRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /crm/connections — what is linked, and whether it is working. */
  fastify.get(
    '/crm/connections',
    {
      preHandler: requireRole('admin', 'owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        response: { 200: { type: 'array', items: CONNECTION_SCHEMA } },
      },
    },
    async (request) => {
      const rows = await db
        .get()
        .select()
        .from(crmConnections)
        .where(eq(crmConnections.tenantId, request.user.tenantId));
      return rows.map(toWire);
    },
  );

  /**
   * POST /crm/connections — store a connection's tokens.
   *
   * The tokens arrive in the body because the OAuth exchange happens outside this endpoint. That
   * is deliberate: the authorisation-code exchange needs a client secret per provider, which is a
   * deployment credential rather than a tenant one, and wiring it before either provider is chosen
   * would mean guessing at two different flows. This stores whatever a completed exchange
   * produced, which is the part that is identical for both.
   */
  fastify.post(
    '/crm/connections',
    {
      preHandler: requireRole('admin', 'owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'Stores CRM OAuth tokens in Secrets Manager and records the connection. The tokens are never stored in Postgres and never returned.',
        body: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            instanceUrl: { type: 'string' },
            accessToken: { type: 'string', minLength: 1 },
            refreshToken: { type: 'string', minLength: 1 },
            expiresAt: { type: 'integer' },
            scopes: { type: 'array', items: { type: 'string' } },
          },
          required: ['provider', 'accessToken', 'refreshToken', 'expiresAt'],
        },
        response: {
          201: CONNECTION_SCHEMA,
          /* Declared, or Fastify's typed reply refuses the 400 branch — and an undeclared error
             shape is also stripped by fast-json-stringify, so the message never reaches the UI. */
          400: {
            type: 'object',
            properties: { status: { type: 'string' }, error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        provider: string;
        instanceUrl?: string;
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        scopes?: string[];
      };
      const tenantId = request.user.tenantId;

      if (!isCrmProvider(body.provider)) {
        return reply.status(400).send({
          status: 'error',
          error: `Unknown CRM '${body.provider}'. Supported: ${CRM_PROVIDERS.join(', ')}.`,
        });
      }

      /* Salesforce is per-instance and HubSpot is not. A missing instance URL for Salesforce would
         send every request to the wrong org — which looks like it worked, returns data, and
         attributes another company's records to this tenant. Refused rather than defaulted. */
      if (body.provider === 'salesforce' && !body.instanceUrl?.trim()) {
        return reply.status(400).send({
          status: 'error',
          error: 'Salesforce requires an instanceUrl — the org-specific API host.',
        });
      }

      const tokens: CrmTokens = {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiresAt: body.expiresAt,
        scopes: body.scopes ?? [],
      };

      /* The secret is written BEFORE the row, so `secret_arn` can never point at a secret that
         does not exist — the same ordering, for the same reason, as raw payloads before signals. */
      const secretArn = await writeTokens(tenantId, body.provider, tokens);

      const [row] = await db
        .get()
        .insert(crmConnections)
        .values({
          tenantId,
          provider: body.provider,
          instanceUrl: body.instanceUrl?.trim() || null,
          secretArn,
          scopes: body.scopes ?? [],
          connectedBy: request.user.uid,
          status: 'active',
        })
        /* Reconnecting after a revoked grant must succeed rather than collide with the unique
           constraint. The secret was already overwritten above, so the ARN is current. */
        .onConflictDoUpdate({
          target: [crmConnections.tenantId, crmConnections.provider],
          set: {
            secretArn,
            instanceUrl: body.instanceUrl?.trim() || null,
            scopes: body.scopes ?? [],
            connectedBy: request.user.uid,
            status: 'active',
            lastError: null,
            updatedAt: new Date(),
          },
        })
        .returning();

      return reply.status(201).send(toWire(row!));
    },
  );

  /**
   * DELETE /crm/connections/:id — disconnect.
   *
   * The secret is scheduled for deletion with a recovery window rather than destroyed, so a
   * misclick is survivable. The row goes immediately: a connection nobody can use should not
   * appear connected.
   */
  fastify.delete(
    '/crm/connections/:id',
    {
      preHandler: requireRole('admin', 'owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const [row] = await db
        .get()
        .delete(crmConnections)
        /* Id AND tenant. The id alone would let one tenant disconnect another's CRM. */
        .where(
          and(eq(crmConnections.id, id), eq(crmConnections.tenantId, request.user.tenantId)),
        )
        .returning();

      if (!row) return reply.notFound('Connection not found');

      try {
        await deleteTokens(row.secretArn);
      } catch (err) {
        /* The row is already gone, which is what the user asked for. A secret left behind is an
           operational tidy-up, not a failed disconnect — reporting failure here would tell them
           the CRM is still linked when it is not. */
        request.log.warn({ err, secretArn: row.secretArn }, 'CRM secret not deleted');
      }

      return reply.status(204).send();
    },
  );
};

export default crmRoutes;
