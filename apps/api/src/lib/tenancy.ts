import { brandEntities, db } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';

/**
 * Does this brand entity belong to this tenant?
 *
 * Every table that carries a `brand_entity_id` has a foreign key to `brand_entities`, and a
 * foreign key proves only that the brand exists SOMEWHERE. A route that writes
 * `{ tenantId: caller's, brandEntityId: from the URL }` without this check stores a row in the
 * caller's tenant pointing at another tenant's brand: an alias that renames their brand in our
 * mention matching, a feed that collects into their brand, a scan that runs against it, or — on
 * `users` — an authorisation pin onto it.
 *
 * Callers answer 404 when this is false, not 403: "not yours" and "does not exist" must be the
 * same answer, or the route becomes an oracle for which ids exist in other tenants.
 */
export async function brandInTenant(tenantId: string, brandEntityId: string): Promise<boolean> {
  const [row] = await db
    .get()
    .select({ id: brandEntities.id })
    .from(brandEntities)
    .where(and(eq(brandEntities.id, brandEntityId), eq(brandEntities.tenantId, tenantId)))
    .limit(1);
  return Boolean(row);
}
