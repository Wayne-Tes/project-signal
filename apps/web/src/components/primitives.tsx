'use client';
import { sourceMeta } from '@/config/sources';

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
