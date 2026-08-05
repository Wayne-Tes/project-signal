/* eslint-disable no-console -- CLI script: stdout is the user-facing interface */
/**
 * Seed the local database with a usable demo tenant.
 *
 * Creates one tenant, an owned brand with aliases and source configs, and three competitor
 * brands. Names deliberately match the placeholder dashboard data in
 * `apps/web/src/lib/data.ts` so that swapping those views onto the live API (Epic 6) lines
 * up rather than looking like a different product.
 *
 * **Idempotent.** Every insert is `onConflictDoNothing`, keyed on the natural unique
 * constraints (tenants.slug, brand_aliases (brand,alias), source_configs (brand,source)).
 * Re-running it is safe and will not duplicate rows. Brands have no unique constraint on
 * slug, so they are looked up before insert.
 *
 * Usage:  yarn db:seed          (requires docker compose postgres to be running)
 * Reset:  yarn db:seed --reset  (deletes seeded rows first — LOCAL ONLY, refuses in prod)
 */
import { and, eq } from 'drizzle-orm';
import {
  db,
  client,
  tenants,
  brandEntities,
  brandAliases,
  sourceConfigs,
} from '@project-signal/db';

const TENANT = { name: 'Project Signal Demo', slug: 'project-signal-demo' };

const OWNED_BRAND = { name: 'Cadence', slug: 'cadence' };
const COMPETITORS = [
  { name: 'Northwind', slug: 'northwind' },
  { name: 'Vault', slug: 'vault' },
  { name: 'Penny', slug: 'penny' },
];

const ALIASES = ['Cadence Bank', 'CDN', 'cadence.app'];

// Placeholder identifiers — real ones must be supplied before ingestion will return data.
// The RSS feed is a real, public, no-auth endpoint so at least one source works end to end
// without any API key.
const SOURCE_CONFIGS: Array<{ source: string; config: Record<string, string>; isEnabled: boolean }> =
  [
    {
      source: 'rss',
      config: { feedUrl: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
      isEnabled: true,
    },
    { source: 'google_reviews', config: { placeId: 'REPLACE_ME' }, isEnabled: false },
    { source: 'app_store', config: { appId: 'REPLACE_ME', country: 'gb' }, isEnabled: false },
    { source: 'play_store', config: { appId: 'REPLACE_ME' }, isEnabled: false },
    { source: 'youtube', config: { channelId: 'REPLACE_ME' }, isEnabled: false },
  ];

const reset = process.argv.includes('--reset');

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.error('Refusing to seed with NODE_ENV=production.');
    process.exit(1);
  }

  const database = db.get();

  // --- tenant -------------------------------------------------------------
  await database.insert(tenants).values(TENANT).onConflictDoNothing();
  const [tenant] = await database.select().from(tenants).where(eq(tenants.slug, TENANT.slug));
  if (!tenant) throw new Error('failed to create or find the demo tenant');
  console.log(`tenant:      ${tenant.name} (${tenant.id})`);

  if (reset) {
    // Order matters — children before parents.
    await database.delete(brandAliases).where(eq(brandAliases.tenantId, tenant.id));
    await database.delete(sourceConfigs).where(eq(sourceConfigs.tenantId, tenant.id));
    console.log('reset:       cleared aliases + source configs for this tenant');
  }

  // --- brands -------------------------------------------------------------
  const upsertBrand = async (name: string, slug: string, isOwned: boolean) => {
    const [existing] = await database
      .select()
      .from(brandEntities)
      .where(and(eq(brandEntities.tenantId, tenant.id), eq(brandEntities.slug, slug)));
    if (existing) return existing;

    const [created] = await database
      .insert(brandEntities)
      .values({ tenantId: tenant.id, name, slug, isOwned })
      .returning();
    if (!created) throw new Error(`failed to create brand ${slug}`);
    return created;
  };

  const brand = await upsertBrand(OWNED_BRAND.name, OWNED_BRAND.slug, true);
  console.log(`owned brand: ${brand.name} (${brand.id})`);

  for (const c of COMPETITORS) {
    const competitor = await upsertBrand(c.name, c.slug, false);
    console.log(`competitor:  ${competitor.name} (${competitor.id})`);
  }

  // --- aliases ------------------------------------------------------------
  await database
    .insert(brandAliases)
    .values(ALIASES.map((alias) => ({ tenantId: tenant.id, brandEntityId: brand.id, alias })))
    .onConflictDoNothing();
  console.log(`aliases:     ${ALIASES.join(', ')}`);

  // --- source configs -----------------------------------------------------
  await database
    .insert(sourceConfigs)
    .values(
      SOURCE_CONFIGS.map((s) => ({
        tenantId: tenant.id,
        brandEntityId: brand.id,
        source: s.source,
        config: s.config,
        isEnabled: s.isEnabled,
      })),
    )
    .onConflictDoNothing();
  const enabled = SOURCE_CONFIGS.filter((s) => s.isEnabled).map((s) => s.source);
  const disabled = SOURCE_CONFIGS.filter((s) => !s.isEnabled).map((s) => s.source);
  console.log(`sources:     enabled=[${enabled.join(', ')}] disabled=[${disabled.join(', ')}]`);

  console.log('\nSeed complete.');
  console.log('Disabled sources need real identifiers — set them in the Admin UI or via');
  console.log('PATCH /brands/:id/integrations/:source, then flip isEnabled to true.');
  const devToken = `dev:owner:${tenant.id}:${brand.id}`;
  console.log(`\nDev token for this tenant:  ${devToken}`);
  console.log(`Try it:  curl -H "Authorization: Bearer ${devToken}" http://localhost:8080/brands`);
}

main()
  .then(async () => {
    await client.get().end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await client.get().end();
    process.exit(1);
  });
