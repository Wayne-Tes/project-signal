'use client';
import { sourceMeta } from '@/config/sources';
import { sentColor, sentLabel } from '@/lib/utils';

export function Delta({
  value,
  suffix = '',
  className = '',
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const up = value >= 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'} ${className}`}>
      <svg
        width="9"
        height="9"
        viewBox="0 0 10 10"
        style={{ transform: up ? 'none' : 'scaleY(-1)' }}
      >
        <path d="M5 1 L9 8 L1 8 Z" fill="currentColor" />
      </svg>
      {up ? '+' : '−'}
      {Math.abs(value).toFixed(Number.isInteger(value) ? 0 : 1)}
      {suffix}
    </span>
  );
}

export function SourceGlyph({ name, size = 16 }: { name: string; size?: number }) {
  /* `name` is the API's source id (`google_reviews`), not a display string. The previous
     version keyed a literal map on prose ("Google", "News"), so every real id fell through to a
     bullet — the glyph looked deliberate and told you nothing. */
  const { tone, glyph } = sourceMeta(name);
  return (
    <span
      className="src-glyph"
      style={{ width: size, height: size, borderColor: tone, color: tone, fontSize: size * 0.62 }}
    >
      {glyph}
    </span>
  );
}

export function SourceBadge({ name }: { name: string }) {
  const s = sourceMeta(name);
  return (
    <span className="src-badge">
      <SourceGlyph name={name} size={14} />
      <span>{s.short}</span>
    </span>
  );
}

export function Stars({ n }: { n: number | null }) {
  if (n == null) return null;
  return (
    <span className="stars" aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill={i <= n ? 'var(--gold)' : 'none'}
          stroke={i <= n ? 'var(--gold)' : 'var(--line2)'}
          strokeWidth="1"
        >
          <path d="M6 1 L7.5 4.3 L11 4.7 L8.4 7.1 L9.1 10.6 L6 8.8 L2.9 10.6 L3.6 7.1 L1 4.7 L4.5 4.3 Z" />
        </svg>
      ))}
    </span>
  );
}

export function SentChip({ value }: { value: number }) {
  return (
    <span
      className="sent-chip"
      style={{
        color: sentColor(value),
        borderColor: `color-mix(in srgb, currentColor 35%, transparent)`,
      }}
    >
      <span className="dot" style={{ background: 'currentColor' }} />
      {sentLabel(value)} · {value > 0 ? '+' : ''}
      {value.toFixed(2)}
    </span>
  );
}
