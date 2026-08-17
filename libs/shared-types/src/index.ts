// Signal sources supported by Project Signal.
export type SignalSource =
  | 'google_reviews'
  | 'trustpilot'
  | 'youtube'
  | 'app_store'
  | 'play_store'
  | 'rss'
  | 'reddit'
  | 'news_api'
  | 'x'
  | 'survey';

/**
 * The sources a collector actually exists for.
 *
 * `SignalSource` is what the SCHEMA models; this is what the pipeline can actually fetch. The
 * two are deliberately different, and conflating them hides a real failure: the integrations
 * endpoint accepted any string, so a source config for `trustpilot` could be stored, enabled and
 * shown as configured, and then throw "No adapter for source" on every single collection run —
 * where the error is counted as a failed source and dropped. Nothing surfaced to the person who
 * configured it.
 *
 * Kept in shared-types rather than in `libs/source-adapters` so the API can validate against it
 * without taking a dependency on every adapter's HTTP client. `apps/ingestion` has a test
 * asserting its adapter registry matches this list exactly, so the two cannot drift.
 */
export const COLLECTING_SOURCES = [
  'google_reviews',
  'app_store',
  'play_store',
  'rss',
  'reddit',
  'youtube',
] as const satisfies readonly SignalSource[];

export type CollectingSource = (typeof COLLECTING_SOURCES)[number];

export function isCollectingSource(value: string): value is CollectingSource {
  return (COLLECTING_SOURCES as readonly string[]).includes(value);
}

// The five brand perception dimensions.
export type Dimension = 'trust' | 'quality' | 'service' | 'value' | 'experience';

export type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'mixed';

export interface Signal {
  id: string;
  tenantId: string;
  brandEntityId: string;
  source: SignalSource;
  sourceUrl: string;
  rawStorageRef: string;
  publishedAt: Date;
  ingestedAt: Date;
}

export interface SentimentResult {
  signalId: string;
  label: SentimentLabel;
  score: number; // -1 to 1
  confidence: number; // 0 to 1
  dimensions: Dimension[];
  topics: string[];
  modelVersion: string;
}

export interface BrandPerceptionScore {
  brandEntityId: string;
  computedAt: Date;
  overall: number; // 0–100
  dimensions: Record<Dimension, number>;
}

export interface Report {
  id: string;
  tenantId: string;
  brandEntityId: string;
  periodStart: Date;
  periodEnd: Date;
  storageRef: string;
  generatedAt: Date;
}

// --- Territory ---------------------------------------------------------------

/**
 * Where a feed collects from.
 *
 * WHY THIS IS A PROPERTY OF THE FEED, NOT THE BRAND. A brand is not British.
 * `@TeachStarterUSA` and `@TeachStarter` are the same product in two countries, and the marketing
 * team's channel sheet is organised exactly that way — one country per channel. Putting it on the
 * brand would force a choice that does not exist.
 *
 * ISO 3166-1 alpha-2, plus two sentinels:
 *
 *   - `GLOBAL`  — a genuinely worldwide account, not "we have not decided".
 *   - `unknown` — not yet classified. The default, and the honest answer for every signal
 *     collected before this column existed.
 *
 * A CLOSED LIST, not a shape check. `UK` is two uppercase letters and looks entirely plausible,
 * but it is not an assigned ISO country code — `GB` is — so a pattern check would happily store
 * `UK` and `GB` as different territories for the same country, and the split would only surface
 * as two half-empty rows in a report months later. `Tes Social Channels.md` says "UK" and "AUS"
 * throughout, so this is not a hypothetical.
 */
export const TERRITORIES = [
  'GB',
  'IE',
  'US',
  'CA',
  'AU',
  'NZ',
  'AE',
  'ZA',
  'IN',
  'SG',
  'HK',
  'GLOBAL',
  'unknown',
] as const;

export type Territory = (typeof TERRITORIES)[number];

/** The aggregate row on `dimension_scores` — every territory combined. Never a signal's value. */
export const TERRITORY_ALL = 'all';

export function isTerritory(value: string): value is Territory {
  return (TERRITORIES as readonly string[]).includes(value);
}

/**
 * What people actually type, mapped to what ISO calls it.
 *
 * Exists because the channel sheet this feature was built for uses "UK", "AUS" and "Global"
 * throughout. Rejecting those outright would make the import a manual find-and-replace and would
 * teach whoever does it that the field is hostile; silently accepting them would split one
 * country across two codes. Correcting them is the third option, and it is the right one.
 *
 * Keys are compared upper-cased and trimmed.
 */
const TERRITORY_ALIASES: Record<string, Territory> = {
  UK: 'GB',
  'GREAT BRITAIN': 'GB',
  'UNITED KINGDOM': 'GB',
  ENGLAND: 'GB',
  SCOTLAND: 'GB',
  WALES: 'GB',
  AUS: 'AU',
  AUSTRALIA: 'AU',
  USA: 'US',
  'UNITED STATES': 'US',
  IRELAND: 'IE',
  'NEW ZEALAND': 'NZ',
  CANADA: 'CA',
  WORLDWIDE: 'GLOBAL',
  INTERNATIONAL: 'GLOBAL',
  '': 'unknown',
};

/**
 * Normalises an input to a territory, or returns null if it cannot be resolved.
 *
 * Returns `null` rather than falling back to `unknown`, so the API can refuse a typo with a
 * message instead of storing something plausible. A feed silently filed under the wrong territory
 * produces reporting that is confidently wrong, which is worse than a 400 — the same reasoning
 * that made a source with no collector a validation error rather than a stored row
 * (KNOWN-GAPS #24).
 *
 * `Global?` — which appears six times in the channel sheet — resolves to null on purpose. The
 * question mark is the sheet's author saying they are not sure, and guessing on their behalf is
 * exactly what must not happen.
 */
export function normaliseTerritory(value: string | null | undefined): Territory | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (isTerritory(trimmed)) return trimmed;
  const upper = trimmed.toUpperCase();
  if (isTerritory(upper)) return upper;
  return TERRITORY_ALIASES[upper] ?? null;
}

/** Display names. The stored value is the code; this is the only place it becomes prose. */
export const TERRITORY_LABELS: Record<Territory, string> = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  AE: 'United Arab Emirates',
  ZA: 'South Africa',
  IN: 'India',
  SG: 'Singapore',
  HK: 'Hong Kong',
  GLOBAL: 'Global',
  unknown: 'Not set',
};

// --- CRM -----------------------------------------------------------------------

/**
 * The CRMs a connector exists for.
 *
 * Same distinction as `COLLECTING_SOURCES`: what the schema can MODEL versus what the pipeline
 * can actually fetch. Both start empty of connectors — the plumbing ships before either mapper,
 * because writing a field mapping against a guessed payload shape is the fabrication
 * `DEVRULES.md` forbids, and a plausible-but-wrong mapping produces silently misattributed
 * commercial data.
 */
export const CRM_PROVIDERS = ['hubspot', 'salesforce'] as const;
export type CrmProvider = (typeof CRM_PROVIDERS)[number];

export function isCrmProvider(value: string): value is CrmProvider {
  return (CRM_PROVIDERS as readonly string[]).includes(value);
}

export const CRM_PROVIDER_LABELS: Record<CrmProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
};

/**
 * Who wrote the words behind a signal.
 *
 * `direct` — the customer wrote them. Every public source.
 * `reported` — an employee wrote down what a customer said. CRM notes, and later any support desk.
 *
 * **The Brand Perception Index is computed over `direct` only.** A CSM writes a note because
 * something needs attention, so that channel is a work queue rather than a sample: structurally
 * negative-biased by design. Averaging it in would move the index for reasons unrelated to brand
 * perception, and nobody could see why, because the number would still look plausible.
 */
export const VOICES = ['direct', 'reported'] as const;
export type Voice = (typeof VOICES)[number];

export function isVoice(value: string): value is Voice {
  return (VOICES as readonly string[]).includes(value);
}

/**
 * Commercial exposure as a band, never a figure.
 *
 * Enough to rank a theme by what it puts at risk; not enough to constitute revenue data. The
 * revenue uplift model is an open question in the product spec and this deliberately does not
 * answer it.
 */
export const ARR_BANDS = ['<10k', '10-50k', '50-250k', '250k+'] as const;
export type ArrBand = (typeof ARR_BANDS)[number];

export function isArrBand(value: string): value is ArrBand {
  return (ARR_BANDS as readonly string[]).includes(value);
}

/** Ranking weight per band. Used to order themes by exposure rather than by raw volume. */
export const ARR_BAND_WEIGHT: Record<ArrBand, number> = {
  '<10k': 1,
  '10-50k': 3,
  '50-250k': 8,
  '250k+': 20,
};
