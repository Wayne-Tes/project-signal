import { vi, type Mock } from 'vitest';

/**
 * API response fixtures for view tests, and a router for the mocked `apiFetch`.
 *
 * The shapes mirror `src/lib/brand-data.ts`, which mirrors the API's response schemas. They are
 * test fixtures of the sanctioned kind (DEVRULES: `vi.mock` of the network seam in unit tests) —
 * the values are arbitrary, the SHAPES are the contract.
 */

export const BRANDS = [
  { id: 'brand-1', name: 'Tes', slug: 'tes', isOwned: true },
  { id: 'brand-2', name: 'Rival', slug: 'rival', isOwned: false },
];

export const SCORE = {
  score: 62.4,
  previousScore: 58.1,
  date: '2026-11-15',
  previousDate: '2026-11-08',
  dimensions: [
    { dimension: 'trust', score: 70.2, date: '2026-11-15', signalCount: 12 },
    { dimension: 'service', score: 41.5, date: '2026-11-15', signalCount: 8 },
  ],
  previousDimensions: [{ dimension: 'trust', score: 66, date: '2026-11-08', signalCount: 10 }],
};

export const UNSCORED = {
  score: null,
  previousScore: null,
  date: null,
  previousDate: null,
  dimensions: [],
  previousDimensions: [],
};

export const HISTORY = [
  { dimension: 'trust', score: 66, date: '2026-11-08', signalCount: 10 },
  { dimension: 'service', score: 40, date: '2026-11-08', signalCount: 7 },
  { dimension: 'trust', score: 70.2, date: '2026-11-15', signalCount: 12 },
  { dimension: 'service', score: 41.5, date: '2026-11-15', signalCount: 8 },
];

/** The per-day Brand Perception Index (GET /brands/:id/score-history). */
export const INDEX_HISTORY = [
  { date: '2026-11-08', score: 53, signalCount: 17 },
  { date: '2026-11-15', score: 55.85, signalCount: 20 },
];

export const STATS = {
  signalsThisWeek: 30,
  signalsPreviousWeek: 20,
  totalSignals: 100,
  scoredSignals: 90,
  classifiedSignals: 80,
  lastRollupDate: '2026-11-15',
  activeSources: 3,
  configuredSources: 4,
};

export const CLUSTERS = [
  {
    topic: 'billing delays',
    volume: 9,
    negativity: 0.7,
    positivity: 0.05,
    recency: 0.9,
    damage: 5.67,
    strength: 0,
    sentiment: -0.6,
    dimensions: ['service'],
  },
];

export const STRENGTHS = [
  {
    topic: 'helpful staff',
    volume: 6,
    negativity: 0,
    positivity: 0.8,
    recency: 0.8,
    damage: 0,
    strength: 3.8,
    sentiment: 0.7,
    dimensions: ['trust'],
  },
];

export const ROADMAP = {
  current: 62.4,
  target: { value: 70, source: 'competitor-best', label: 'best tracked competitor' },
  gap: 7.6,
  benchmarks: {
    competitorMedian: 60.2,
    competitorBest: 70,
    competitorCount: 2,
    internalBest: { value: 66, label: 'United Kingdom' },
  },
  projection: {
    assumption: 'no new negative signals',
    daysToTarget: 45,
    decliningWithoutAction: true,
    points: [],
  },
  actions: [
    {
      topic: 'billing delays',
      volume: 9,
      sentiment: -0.6,
      damage: 5.67,
      damageShare: 60,
      dimensions: ['service'],
      ifResolved: { from: 62.4, to: 66.1, delta: 3.7, affectedSignals: 7 },
      play: {
        id: 'p1',
        title: 'Fix the billing loop',
        summary: 'Shorten the time to resolve billing queries.',
        steps: ['Map the journey', 'Remove the handoff'],
        measure: 'Billing complaints fall',
        owner: 'Finance',
        horizon: 'now',
        evidenceStatus: 'external',
        evidence: [
          {
            title: 'A study',
            url: 'https://example.com/study',
            source: 'Example',
            relevance: 'direct',
          },
          { title: 'Hostile', url: 'javascript:alert(1)', source: 'Bad', relevance: 'x' },
        ],
      },
    },
    {
      topic: 'app crashes',
      volume: 3,
      sentiment: -0.2,
      damage: 1,
      damageShare: 10,
      dimensions: ['quality'],
      ifResolved: { from: 62.4, to: 62.4, delta: 0, affectedSignals: 1 },
      play: null,
    },
  ],
};

export const VOICE = {
  connected: true,
  interactions: 40,
  accountsHeard: 12,
  themes: [
    {
      topic: 'renewal pricing',
      accounts: 4,
      mentions: 7,
      exposure: 120000,
      sentiment: -0.4,
      topBand: '100k+',
    },
  ],
  corroborated: [
    {
      topic: 'renewal pricing',
      accounts: 4,
      publicVolume: 5,
      publicSentiment: -0.3,
      reportedSentiment: -0.5,
    },
  ],
};

type Handler = unknown | ((url: string, init?: RequestInit) => unknown);

/**
 * Routes `apiFetch(url, init)` by path, ignoring the query string. A route value that is an Error
 * rejects; a function is called. Unmatched paths reject with a 404, so a test that forgets a
 * route fails loudly instead of rendering against `undefined`.
 */
export function routeApi(mock: Mock, routes: Record<string, Handler>): void {
  mock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0] ?? url;
    const method = init?.method ?? 'GET';
    const key = routes[`${method} ${path}`] !== undefined ? `${method} ${path}` : path;
    if (!(key in routes)) throw new Error(`404: no route for ${method} ${url}`);
    const handler = routes[key];
    if (handler instanceof Error) throw handler;
    return typeof handler === 'function'
      ? (handler as (u: string, i?: RequestInit) => unknown)(url, init)
      : handler;
  });
}

/** Every route a brand's analytical views read, for brand-1. */
export function brandRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    '/brands': BRANDS,
    '/brands/brand-1/score': SCORE,
    '/brands/brand-2/score': UNSCORED,
    '/brands/brand-1/dimension-scores': HISTORY,
    '/brands/brand-1/score-history': INDEX_HISTORY,
    '/brands/brand-1/territories': { territories: [] },
    '/brands/brand-1/stats': STATS,
    '/brands/brand-1/brand-impact': CLUSTERS,
    '/brands/brand-1/strengths': STRENGTHS,
    '/brands/brand-1/roadmap': ROADMAP,
    '/brands/brand-1/roadmap/actions': [],
    '/brands/brand-1/voice-of-customer': VOICE,
    '/brands/brand-1/integrations': [],
    ...overrides,
  };
}

export const nav = (): {
  openOverview: Mock;
  openDimension: Mock;
  openCluster: Mock;
  openTopic: Mock;
  to: Mock;
  close: Mock;
} => ({
  openOverview: vi.fn(),
  openDimension: vi.fn(),
  openCluster: vi.fn(),
  openTopic: vi.fn(),
  to: vi.fn(),
  close: vi.fn(),
});
