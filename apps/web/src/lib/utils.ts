export const scoreColor = (s: number) =>
  s >= 78 ? 'var(--mint)' : s >= 65 ? 'var(--sky)' : s >= 55 ? 'var(--gold)' : 'var(--coral)';

export const sentLabel = (v: number) =>
  v > 0.15 ? 'Positive' : v < -0.15 ? 'Negative' : 'Neutral';

export const sentColor = (v: number) =>
  v > 0.15 ? 'var(--mint)' : v < -0.15 ? 'var(--coral)' : 'var(--t3)';
