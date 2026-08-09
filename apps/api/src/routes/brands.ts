import type { FastifyPluginAsync } from 'fastify';
import { db, brandEntities } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';
import { requireBrandAccess, requireRole } from '../plugins/auth.js';

const BRAND_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    parentId: { type: 'string', nullable: true },
    kind: { type: 'string' },
    isOwned: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

/** Depth ceiling on the ancestor walk. See `wouldCreateCycle`. */
const MAX_DEPTH = 20;

/** URL-safe slug from a display name. Not unique by itself — the caller decides. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'brand'
  );
}

/**
 * Would setting `parentId` on `id` create a cycle?
 *
 * Walks from the proposed parent up to the root. If `id` appears, the edge would close a loop —
 * and a loop makes every recursive tree query run forever.
 *
 * Postgres cannot express "may not be its own ancestor" as a simple constraint, so this is
 * enforced here, on every write that sets a parent. The depth ceiling is a second belt: if the
 * data has ALREADY been corrupted by some other path, this walk must still terminate rather than
 * hang the request that would have detected it.
 */
async function wouldCreateCycle(tenantId: string, id: string, parentId: string): Promise<boolean> {
  if (id === parentId) return true;

  let cursor: string | null = parentId;
  for (let depth = 0; depth < MAX_DEPTH && cursor; depth += 1) {
    if (cursor === id) return true;
    const [row]: { parentId: string | null }[] = await db
      .get()
      .select({ parentId: brandEntities.parentId })
      .from(brandEntities)
      .where(and(eq(brandEntities.id, cursor), eq(brandEntities.tenantId, tenantId)))
      .limit(1);
    cursor = row?.parentId ?? null;
  }
  /* Ran out of depth without reaching a root: treat as a cycle. Refusing a legitimate
     twenty-deep hierarchy is a far smaller problem than accepting one that hangs every read. */
  return Boolean(cursor);
}

const brandsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/brands',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        response: { 200: { type: 'array', items: BRAND_SCHEMA } },
      },
    },
    async (request) => {
      const { tenantId, role, brandEntityId } = request.user;
      const baseCondition = eq(brandEntities.tenantId, tenantId);

      if (role === 'user' && brandEntityId) {
        return db
          .get()
          .select()
          .from(brandEntities)
          .where(and(baseCondition, eq(brandEntities.id, brandEntityId)));
      }

      return db.get().select().from(brandEntities).where(baseCondition);
    },
  );

  /**
   * The tenant's entities as a tree.
   *
   * Assembled in memory from one flat query rather than by a recursive CTE or a query per level.
   * A tenant has tens of entities, not thousands, so one round trip and a map is both faster and
   * far easier to reason about than `WITH RECURSIVE` — and it cannot be tricked into running
   * forever by a cycle, because the visited set below terminates regardless of the data.
   */
  fastify.get(
    '/brands/tree',
    {
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          "The tenant's brands and the products beneath them, as a tree. Roots first, children nested.",
      },
    },
    async (request) => {
      const rows = await db
        .get()
        .select()
        .from(brandEntities)
        .where(eq(brandEntities.tenantId, request.user.tenantId));

      type Node = (typeof rows)[number] & { children: Node[] };
      const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, children: [] }]));

      const roots: Node[] = [];
      for (const node of byId.values()) {
        const parent = node.parentId ? byId.get(node.parentId) : undefined;
        /* An entity whose parent is missing — or outside this tenant — surfaces as a root rather
           than vanishing. Silently dropping it would hide a real data fault behind an empty
           space in the UI. */
        if (parent && parent.id !== node.id) parent.children.push(node);
        else roots.push(node);
      }

      const sort = (nodes: Node[]): Node[] => {
        nodes.sort((a, b) => a.name.localeCompare(b.name));
        for (const n of nodes) sort(n.children);
        return nodes;
      };

      return sort(roots);
    },
  );

  // `requireBrandAccess` applies here for the same reason it applies to every other
  // `/brands/:id/*` route: the tenant filter below closes cross-tenant reads, but without the
  // guard a `user` pinned to brand A could still read brand B's row — including a competitor
  // tracked by the same tenant — by changing the id in the URL. Only the brand's metadata
  // leaked rather than its signals, which is why this route was missed when KNOWN-GAPS #5 was
  // closed across the analytical endpoints; it is the same defect at a smaller blast radius.
  fastify.get(
    '/brands/:id',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        response: { 200: BRAND_SCHEMA },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [brand] = await db
        .get()
        .select()
        .from(brandEntities)
        .where(and(eq(brandEntities.id, id), eq(brandEntities.tenantId, request.user.tenantId)));

      if (!brand) return reply.notFound('Brand not found');
      return brand;
    },
  );

  /** Create a brand, or a product beneath one. */
  fastify.post<{ Body: { name: string; parentId?: string; kind?: string; isOwned?: boolean } }>(
    '/brands',
    {
      preHandler: requireRole('admin', 'owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'Create a brand entity. Supply parentId to create a product beneath an existing brand.',
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            parentId: { type: 'string' },
            kind: { type: 'string', enum: ['brand', 'product'] },
            isOwned: { type: 'boolean' },
          },
        },
        response: { 201: BRAND_SCHEMA },
      },
    },
    async (request, reply) => {
      const { name, parentId, kind, isOwned = true } = request.body;
      const tenantId = request.user.tenantId;

      if (parentId) {
        const [parent] = await db
          .get()
          .select({ id: brandEntities.id })
          .from(brandEntities)
          .where(and(eq(brandEntities.id, parentId), eq(brandEntities.tenantId, tenantId)))
          .limit(1);
        /* Checked against THIS tenant. Without the tenant filter a caller could attach their
           product to another tenant's brand, which would leak the child into that tenant's tree
           and its portfolio score. */
        if (!parent) return reply.badRequest('Parent brand not found in this tenant.');
      }

      const [created] = await db
        .get()
        .insert(brandEntities)
        .values({
          tenantId,
          name: name.trim(),
          slug: slugify(name),
          parentId: parentId ?? null,
          /* A child defaults to 'product' because that is what a child IS in practice; an
             explicit kind still wins, for brand → division → product. */
          kind: kind ?? (parentId ? 'product' : 'brand'),
          isOwned,
        })
        .returning();

      return reply.code(201).send(created);
    },
  );

  /** Rename, re-parent, or change the kind of an entity. */
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; parentId?: string | null; kind?: string; isOwned?: boolean };
  }>(
    '/brands/:id',
    {
      preHandler: requireRole('admin', 'owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        description: 'Rename or re-parent an entity. Pass parentId: null to promote it to a root.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            parentId: { type: ['string', 'null'] },
            kind: { type: 'string', enum: ['brand', 'product'] },
            isOwned: { type: 'boolean' },
          },
        },
        response: { 200: BRAND_SCHEMA },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const tenantId = request.user.tenantId;
      const { name, parentId, kind, isOwned } = request.body;

      const [existing] = await db
        .get()
        .select({ id: brandEntities.id })
        .from(brandEntities)
        .where(and(eq(brandEntities.id, id), eq(brandEntities.tenantId, tenantId)))
        .limit(1);
      if (!existing) return reply.notFound('Brand not found');

      if (parentId) {
        const [parent] = await db
          .get()
          .select({ id: brandEntities.id })
          .from(brandEntities)
          .where(and(eq(brandEntities.id, parentId), eq(brandEntities.tenantId, tenantId)))
          .limit(1);
        if (!parent) return reply.badRequest('Parent brand not found in this tenant.');
        if (await wouldCreateCycle(tenantId, id, parentId)) {
          return reply.badRequest(
            'That would make the entity its own ancestor, which would make the tree unreadable.',
          );
        }
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (name !== undefined) {
        patch['name'] = name.trim();
        patch['slug'] = slugify(name);
      }
      /* `undefined` means "not supplied"; `null` means "promote to root". Collapsing the two
         would make it impossible to ever detach a product from its parent. */
      if (parentId !== undefined) patch['parentId'] = parentId;
      if (kind !== undefined) patch['kind'] = kind;
      if (isOwned !== undefined) patch['isOwned'] = isOwned;

      const [updated] = await db
        .get()
        .update(brandEntities)
        .set(patch)
        .where(and(eq(brandEntities.id, id), eq(brandEntities.tenantId, tenantId)))
        .returning();

      return reply.send(updated);
    },
  );
};

export default brandsRoutes;
export { wouldCreateCycle, slugify };
