'use client';
import { useCountUp } from '@/hooks/useCountUp';
import { scoreColor } from '@/lib/utils';

export function RadialGauge({
  value,
  max = 100,
  size = 220,
  stroke = 14,
  play = true,
  label,
  sub,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  play?: boolean;
  label?: string;
  sub?: React.ReactNode;
}) {
  const shown = useCountUp(value, { play, duration: 1600 });
  const r = (size - stroke) / 2;
  const sweep = 0.75;
  const arcLen = 2 * Math.PI * r * sweep;
  const pct = Math.min(1, Number(shown) / max);
  const col = scoreColor(value);

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(135deg)' }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
          strokeDasharray={`${arcLen} ${2 * Math.PI * r}`}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={stroke}
          strokeDasharray={`${arcLen * pct} ${2 * Math.PI * r}`}
          strokeLinecap="round"
          style={{
            transition: 'stroke 0.4s',
            filter: `drop-shadow(0 0 12px color-mix(in srgb, ${col} 50%, transparent))`,
          }}
        />
      </svg>
      <div className="gauge-center">
        <div className="gauge-num" style={{ color: col }}>
          {shown}
        </div>
        {label && <div className="gauge-label">{label}</div>}
        {sub}
      </div>
    </div>
  );
}
