import type {
  Brand,
  Dimension,
  HistoryRow,
  VolumeData,
  Source,
  Cluster,
  Signal,
  RoadmapItem,
  Competitor,
  Alert,
} from './types';

export const PS_BRAND: Brand = {
  name: 'Cadence',
  tagline: 'Everyday money, in rhythm.',
  category: 'Challenger bank · Consumer finance',
  score: 73,
  prevScore: 69,
  scoreLabel: 'Brand Perception Index',
  period: '1 Apr – 28 May 2026',
  signalsThisWeek: 4218,
  signalsPrevWeek: 3760,
  sourcesActive: 6,
};

export const PS_DIMENSIONS: Dimension[] = [
  {
    key: 'trust',
    label: 'Trust',
    score: 78,
    prev: 74,
    weight: 0.25,
    blurb: 'Security, transparency, doing the right thing.',
  },
  {
    key: 'quality',
    label: 'Quality',
    score: 71,
    prev: 72,
    weight: 0.2,
    blurb: 'App stability, accuracy, reliability of features.',
  },
  {
    key: 'service',
    label: 'Service',
    score: 62,
    prev: 67,
    weight: 0.2,
    blurb: 'Support responsiveness and resolution quality.',
  },
  {
    key: 'value',
    label: 'Value',
    score: 80,
    prev: 77,
    weight: 0.15,
    blurb: 'Pricing fairness, fees, perceived worth.',
  },
  {
    key: 'experience',
    label: 'Experience',
    score: 74,
    prev: 70,
    weight: 0.2,
    blurb: 'Ease, delight, and flow of everyday use.',
  },
];

function buildHistory(): HistoryRow[] {
  const weeks = 26;
  const base: Record<string, number> = {
    trust: 70,
    quality: 73,
    service: 71,
    value: 74,
    experience: 67,
    score: 66,
  };
  const drift: Record<string, number> = {
    trust: 0.32,
    quality: -0.08,
    service: -0.36,
    value: 0.24,
    experience: 0.28,
    score: 0.28,
  };
  const wobble: Record<string, number> = {
    trust: 2.1,
    quality: 2.6,
    service: 3.4,
    value: 1.8,
    experience: 2.3,
    score: 1.6,
  };
  const seed = 7;
  const rnd = (i: number, k: number) =>
    (Math.sin(i * 12.9898 + k * 78.233 + seed) * 43758.5453) % 1;
  const out: HistoryRow[] = [];
  const start = new Date(2025, 11, 1);
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i * 7);
    const row: Partial<HistoryRow> = {
      date: d,
      label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    };
    for (const k of Object.keys(base)) {
      const bk = base[k] ?? 0;
      const dk = drift[k] ?? 0;
      const wk = wobble[k] ?? 0;
      const r = (rnd(i, k.length) + 1) / 2;
      let v = bk + dk * i + (r - 0.5) * wk * 2;
      if (k === 'service' && i > 14 && i < 21) v -= 6 - Math.abs(17 - i);
      if (k === 'score' && i > 14 && i < 21) v -= 2.4;
      (row as Record<string, unknown>)[k] = Math.max(40, Math.min(95, v));
    }
    out.push(row as HistoryRow);
  }
  const last = out[out.length - 1]!;
  last.trust = 78;
  last.quality = 71;
  last.service = 62;
  last.value = 80;
  last.experience = 74;
  last.score = 73;
  return out;
}

export const PS_HISTORY: HistoryRow[] = buildHistory();

export const PS_VOLUME: VolumeData = (() => {
  const sources = ['Google', 'Trustpilot', 'App Store', 'YouTube', 'News', 'X'];
  const wk: Array<Record<string, number | string>> = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(2026, 2, 7);
    d.setDate(d.getDate() + i * 7);
    wk.push({
      label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      Google: 380 + Math.round(Math.sin(i) * 60 + i * 9),
      Trustpilot: 210 + Math.round(Math.cos(i * 1.3) * 40 + i * 5),
      'App Store': 160 + Math.round(Math.sin(i * 0.7) * 30 + i * 4),
      YouTube: 90 + Math.round(Math.cos(i) * 22),
      News: 40 + Math.round(Math.abs(Math.sin(i * 2)) * 30 + (i === 7 ? 60 : 0)),
      X: 120 + Math.round(Math.sin(i * 1.6) * 50 + i * 3),
    });
  }
  return { sources, weeks: wk };
})();

export const PS_SOURCES: Record<string, Source> = {
  Google: { label: 'Google reviews', short: 'Google', tone: 'var(--sky)' },
  Trustpilot: { label: 'Trustpilot', short: 'Trustpilot', tone: 'var(--mint)' },
  'App Store': { label: 'App Store', short: 'App Store', tone: 'var(--peri)' },
  YouTube: { label: 'YouTube', short: 'YouTube', tone: 'var(--coral)' },
  News: { label: 'News / RSS', short: 'News', tone: 'var(--gold)' },
  X: { label: 'X (Twitter)', short: 'X', tone: 'var(--t2)' },
};

export const PS_CLUSTERS: Record<string, Cluster[]> = {
  service: [
    {
      id: 'svc-1',
      title: 'Slow support response times',
      sentiment: -0.71,
      volume: 643,
      damage: 92,
      recency: 0.94,
      trend: -8,
      summary:
        'Customers report multi-day waits for chat and email support, with several describing being bounced between agents on unresolved disputes.',
      mix: { Trustpilot: 41, Google: 22, 'App Store': 19, X: 14, YouTube: 4 },
    },
    {
      id: 'svc-2',
      title: 'Chatbot fails to escalate',
      sentiment: -0.58,
      volume: 287,
      damage: 61,
      recency: 0.88,
      trend: -3,
      summary:
        'The in-app assistant loops users through FAQ articles without a clear path to a human agent for account-locked situations.',
      mix: { 'App Store': 38, Trustpilot: 27, Google: 21, X: 14 },
    },
    {
      id: 'svc-3',
      title: 'Weekend support gaps',
      sentiment: -0.44,
      volume: 156,
      damage: 38,
      recency: 0.71,
      trend: +2,
      summary:
        'Reduced weekend coverage leaves time-sensitive card issues unresolved until Monday.',
      mix: { Trustpilot: 44, Google: 31, X: 25 },
    },
  ],
  quality: [
    {
      id: 'qly-1',
      title: 'App crashes after update 4.2',
      sentiment: -0.66,
      volume: 412,
      damage: 74,
      recency: 0.97,
      trend: -11,
      summary:
        'A spike of crash reports on launch following the 4.2 release, concentrated on older Android devices.',
      mix: { 'App Store': 58, Google: 19, YouTube: 13, X: 10 },
    },
    {
      id: 'qly-2',
      title: 'Payment notifications delayed',
      sentiment: -0.39,
      volume: 198,
      damage: 33,
      recency: 0.69,
      trend: +4,
      summary:
        'Push notifications for incoming payments arrive minutes late, eroding confidence in real-time balances.',
      mix: { 'App Store': 47, Trustpilot: 28, Google: 25 },
    },
  ],
  trust: [
    {
      id: 'trs-1',
      title: 'Account freezes without notice',
      sentiment: -0.62,
      volume: 231,
      damage: 57,
      recency: 0.85,
      trend: -2,
      summary:
        'Fraud-prevention freezes are perceived as sudden and poorly explained, prompting trust concerns and press pickup.',
      mix: { Trustpilot: 39, News: 24, Google: 21, X: 16 },
    },
    {
      id: 'trs-2',
      title: 'Praised for transparent pricing',
      sentiment: +0.74,
      volume: 388,
      damage: 0,
      recency: 0.8,
      trend: +6,
      summary:
        'Reviewers repeatedly highlight clear, upfront fee communication versus legacy banks.',
      mix: { Trustpilot: 42, Google: 33, YouTube: 15, News: 10 },
    },
  ],
  value: [
    {
      id: 'val-1',
      title: 'Fee-free spending abroad',
      sentiment: +0.81,
      volume: 502,
      damage: 0,
      recency: 0.9,
      trend: +9,
      summary:
        'Travel and FX experience is the single most-loved theme, with strong word-of-mouth advocacy.',
      mix: { Google: 37, Trustpilot: 31, YouTube: 20, X: 12 },
    },
    {
      id: 'val-2',
      title: 'Premium tier seen as overpriced',
      sentiment: -0.41,
      volume: 174,
      damage: 31,
      recency: 0.66,
      trend: -1,
      summary:
        'The £14.99 Cadence Plus tier draws value-for-money pushback against newer competitor bundles.',
      mix: { Trustpilot: 38, Google: 29, X: 21, 'App Store': 12 },
    },
  ],
  experience: [
    {
      id: 'exp-1',
      title: 'Onboarding is fast & delightful',
      sentiment: +0.77,
      volume: 446,
      damage: 0,
      recency: 0.92,
      trend: +5,
      summary: 'Sub-five-minute account opening is a consistent first-impression highlight.',
      mix: { Google: 35, 'App Store': 33, Trustpilot: 20, YouTube: 12 },
    },
    {
      id: 'exp-2',
      title: 'Card freeze toggle hard to find',
      sentiment: -0.34,
      volume: 121,
      damage: 24,
      recency: 0.6,
      trend: +1,
      summary: 'Navigation depth to the freeze-card control is a recurring minor friction point.',
      mix: { 'App Store': 46, Google: 30, Trustpilot: 24 },
    },
  ],
};

export const PS_SIGNALS: Record<string, Signal[]> = {
  'svc-1': [
    {
      source: 'Trustpilot',
      author: 'Hannah W.',
      rating: 1,
      when: '2 days ago',
      date: '26 May 2026',
      sentiment: -0.83,
      confidence: 0.94,
      text: "Four days and counting with my account locked after a disputed transaction. Every chat agent says someone will 'get back to me' and no one ever does. Genuinely stressful when it's your main account.",
      topics: ['support wait', 'dispute', 'account access'],
    },
    {
      source: 'App Store',
      author: 'danieldoesthings',
      rating: 2,
      when: '3 days ago',
      date: '25 May 2026',
      sentiment: -0.69,
      confidence: 0.9,
      text: "Love the app but support is a black hole. Waited 36 hours for a reply about a duplicate charge, then got a canned response that didn't address it.",
      topics: ['support wait', 'billing'],
    },
    {
      source: 'Google',
      author: 'M. Okafor',
      rating: 2,
      when: '4 days ago',
      date: '24 May 2026',
      sentiment: -0.61,
      confidence: 0.88,
      text: "Great until something goes wrong. Then you're on your own for days. Phone support would change everything.",
      topics: ['support wait', 'channel gap'],
    },
    {
      source: 'X',
      author: '@priya_codes',
      rating: null,
      when: '5 days ago',
      date: '23 May 2026',
      sentiment: -0.58,
      confidence: 0.82,
      text: "hey @cadence it's been 3 days on a 'priority' support ticket about a failed transfer. priority to whom exactly 😤",
      topics: ['support wait', 'transfers'],
    },
    {
      source: 'Trustpilot',
      author: 'Rémy L.',
      rating: 2,
      when: '6 days ago',
      date: '22 May 2026',
      sentiment: -0.55,
      confidence: 0.86,
      text: 'Bounced between three agents, had to re-explain my issue each time. The product is excellent — the support model is not keeping up with their growth.',
      topics: ['agent handoff', 'support wait'],
    },
    {
      source: 'YouTube',
      author: 'FinTechFrank',
      rating: null,
      when: '1 week ago',
      date: '21 May 2026',
      sentiment: -0.49,
      confidence: 0.79,
      text: 'In my 6-month review: onboarding 10/10, day-to-day 9/10, but the one time I needed real support it took the better part of a week. Docking a point for that.',
      topics: ['support wait', 'long-term review'],
    },
  ],
  'qly-1': [
    {
      source: 'App Store',
      author: 'kev_2014',
      rating: 1,
      when: '1 day ago',
      date: '27 May 2026',
      sentiment: -0.78,
      confidence: 0.95,
      text: "Crashes the second I open it since the 4.2 update. Pixel 6a. Cleared cache, reinstalled, nothing. Can't even check my balance.",
      topics: ['crash', 'update 4.2', 'android'],
    },
    {
      source: 'App Store',
      author: 'Saoirse_M',
      rating: 1,
      when: '2 days ago',
      date: '26 May 2026',
      sentiment: -0.74,
      confidence: 0.93,
      text: 'Was perfect for a year. Latest update bricked it on my older phone. Please roll back or push a hotfix.',
      topics: ['crash', 'update 4.2'],
    },
    {
      source: 'Google',
      author: 'T. Bianchi',
      rating: 2,
      when: '3 days ago',
      date: '25 May 2026',
      sentiment: -0.52,
      confidence: 0.84,
      text: 'App freezes on the home screen since the new version. Force-closing five times a day now.',
      topics: ['crash', 'stability'],
    },
    {
      source: 'YouTube',
      author: 'AndroidPennies',
      rating: null,
      when: '4 days ago',
      date: '24 May 2026',
      sentiment: -0.45,
      confidence: 0.8,
      text: 'Heads up to anyone on older Android — hold off on 4.2 until they patch the launch crash. Comments are full of it.',
      topics: ['crash', 'update 4.2', 'android'],
    },
  ],
  'trs-2': [
    {
      source: 'Trustpilot',
      author: 'George P.',
      rating: 5,
      when: '2 days ago',
      date: '26 May 2026',
      sentiment: +0.82,
      confidence: 0.92,
      text: 'No hidden fees, no surprises. Everything is spelled out before you confirm. After 20 years with a high-street bank this feels honest.',
      topics: ['transparency', 'fees'],
    },
    {
      source: 'Google',
      author: 'Aisha R.',
      rating: 5,
      when: '4 days ago',
      date: '24 May 2026',
      sentiment: +0.71,
      confidence: 0.89,
      text: "What I tell everyone: you always know exactly what you're paying. The breakdown before every transfer is brilliant.",
      topics: ['transparency', 'transfers'],
    },
    {
      source: 'YouTube',
      author: 'MoneyWithMaya',
      rating: null,
      when: '1 week ago',
      date: '21 May 2026',
      sentiment: +0.68,
      confidence: 0.85,
      text: 'Cadence is the one I recommend to first-time switchers purely because the pricing is so clear. No asterisks.',
      topics: ['transparency', 'recommendation'],
    },
  ],
  'val-1': [
    {
      source: 'Google',
      author: 'L. Fernández',
      rating: 5,
      when: '1 day ago',
      date: '27 May 2026',
      sentiment: +0.86,
      confidence: 0.93,
      text: "Used it across three countries last month and didn't pay a penny in FX fees. The live rate in the app is exactly what you get. Unreal.",
      topics: ['FX', 'travel', 'no fees'],
    },
    {
      source: 'Trustpilot',
      author: 'Dan H.',
      rating: 5,
      when: '3 days ago',
      date: '25 May 2026',
      sentiment: +0.8,
      confidence: 0.9,
      text: 'Travel card of choice now. Withdrew cash in Tokyo, spent in Lisbon, zero fees, perfect rates. Sold.',
      topics: ['FX', 'travel', 'ATM'],
    },
    {
      source: 'YouTube',
      author: 'NomadBudgets',
      rating: null,
      when: '5 days ago',
      date: '23 May 2026',
      sentiment: +0.74,
      confidence: 0.86,
      text: 'Tested 5 cards across 8 countries — Cadence came out on top for real-world spend with no foreign transaction fees.',
      topics: ['FX', 'comparison', 'travel'],
    },
  ],
};

export function signalsFor(clusterId: string, mix?: Record<string, number>): Signal[] {
  if (PS_SIGNALS[clusterId]) return PS_SIGNALS[clusterId]!;
  const tones = Object.keys(mix || { Google: 1 });
  const names = ['A. Khan', 'J. Müller', 'R. Silva', 'P. Adeyemi'];
  return tones.slice(0, 4).map((src, i) => ({
    source: src,
    author: names[i % 4] ?? 'Unknown',
    rating: i % 2 ? 2 : 4,
    when: `${i + 2} days ago`,
    date: 'May 2026',
    sentiment: i % 2 ? -0.5 : 0.5,
    confidence: 0.8 - i * 0.04,
    text: 'Representative verbatim from this cluster — every score in Project Signal links back to source items like this with full provenance.',
    topics: ['topic'],
  }));
}

export const PS_ACHILLES: Cluster[] = [
  { ...PS_CLUSTERS['service']![0]!, dimension: 'service', dimensionLabel: 'Service' },
  { ...PS_CLUSTERS['quality']![0]!, dimension: 'quality', dimensionLabel: 'Quality' },
  { ...PS_CLUSTERS['trust']![0]!, dimension: 'trust', dimensionLabel: 'Trust' },
];

export const PS_ROADMAP: RoadmapItem[] = [
  {
    id: 'act-1',
    priority: 'Critical',
    title: 'Add a human-escalation path to in-app support',
    dimension: 'service',
    impact: 6.4,
    effort: 'Medium',
    confidence: 0.88,
    evidence: ['svc-1', 'svc-2'],
    desc: "Introduce a one-tap 'talk to a person' route for account-access and dispute cases, with a published response-time SLA shown in-app.",
    why: 'Slow support is the single largest drag on the index, concentrated in high-stakes account-locked moments.',
  },
  {
    id: 'act-2',
    priority: 'Critical',
    title: 'Ship a 4.2.1 hotfix for the Android launch crash',
    dimension: 'quality',
    impact: 4.1,
    effort: 'Low',
    confidence: 0.91,
    evidence: ['qly-1'],
    desc: 'Roll back or patch the launch crash affecting older Android devices, and proactively notify affected users.',
    why: 'Crash reports spiked sharply after 4.2 and are dragging App Store sentiment in real time.',
  },
  {
    id: 'act-3',
    priority: 'High',
    title: 'Clarify why and how fraud freezes happen',
    dimension: 'trust',
    impact: 3.2,
    effort: 'Medium',
    confidence: 0.79,
    evidence: ['trs-1'],
    desc: 'Send an in-the-moment explanation and expected-resolution time when a protective freeze is applied; add a status tracker.',
    why: 'Unexplained freezes generate disproportionate press and trust damage relative to their volume.',
  },
  {
    id: 'act-4',
    priority: 'Medium',
    title: 'Re-evaluate Cadence Plus pricing & bundle',
    dimension: 'value',
    impact: 1.8,
    effort: 'High',
    confidence: 0.7,
    evidence: ['val-2'],
    desc: 'Benchmark the premium tier against competitor bundles and test a re-packaged value proposition.',
    why: 'Premium pricing pushback is rising slowly but steadily against newer competitor offers.',
  },
];

export const PS_COMPETITORS: Competitor[] = [
  { name: 'Cadence', score: 73, prev: 69, you: true },
  { name: 'Northwind', score: 81, prev: 80 },
  { name: 'Vault', score: 70, prev: 71 },
  { name: 'Penny', score: 64, prev: 66 },
];

export const PS_ALERT: Alert = {
  active: true,
  metric: 'Service sentiment',
  delta: -15.2,
  window: 'rolling 24h vs 30-day baseline',
  when: 'Triggered 6h ago',
  cluster: 'svc-1',
  detail:
    'A sharp drop in Service sentiment driven by a cluster of support-wait complaints on Trustpilot and the App Store.',
};

export function clusterById(id: string): (Cluster & { dimKey: string }) | null {
  for (const k of Object.keys(PS_CLUSTERS)) {
    const c = (PS_CLUSTERS[k] ?? []).find((cl) => cl.id === id);
    if (c) return { ...c, dimKey: k };
  }
  return null;
}
