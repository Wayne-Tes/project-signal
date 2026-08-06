'use client';
import { useState, useEffect } from 'react';
import type { VolumeData } from '@/lib/types';

/**
 * A chart row: a display label plus any number of numeric series keyed by name.
 *
 * Deliberately structural rather than the old fixed `HistoryRow`, which hard-coded the five
 * dimensions plus a composite. The rollup only writes dimensions that have data, so a day can
 * legitimately carry a subset — an absent key is "no rollup", not zero.
 */
export interface ChartRow {
  label: string;
  [series: string]: number | string | Date | undefined;
}
import { PS_SOURCES } from '@/lib/data';

/** Series values are numbers; anything else (the label) reads as absent. */
function asNumber(value: number | string | Date | undefined): number {
  return typeof value === 'number' ? value : 0;
}

interface SeriesDef {
  key: string;
  color: string;
  w?: number;
  area?: boolean;
}

export function LineChart({
  data,
  series,
  width = 720,
  height = 240,
  play = true,
  yMin = 50,
  yMax = 90,
  showDots = false,
  highlight,
}: {
  data: ChartRow[];
  series: SeriesDef[];
  width?: number;
  height?: number;
  play?: boolean;
  yMin?: number;
  yMax?: number;
  showDots?: boolean;
  highlight?: string | null;
}) {
  const pad = { t: 16, r: 16, b: 26, l: 30 };
  const iw = width - pad.l - pad.r,
    ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / (data.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const path = (key: string) =>
    data
      .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(asNumber(d[key])).toFixed(1)}`)
      .join(' ');
  const area = (key: string) =>
    `${path(key)} L${x(data.length - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
  const ticks = [50, 60, 70, 80, 90].filter((t) => t >= yMin && t <= yMax);
  const [draw, setDraw] = useState(play ? 0 : 1);

  useEffect(() => {
    if (!play) return;
    let s: number | undefined;
    const dur = 1500;
    const tick = (ts: number) => {
      if (!s) s = ts;
      const t = Math.min(1, (ts - s) / dur);
      setDraw(t);
      if (t < 1) requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [play]);

  return (
    <svg
      className="linechart"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      preserveAspectRatio="none"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--line)"
            strokeWidth="1"
          />
          <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" className="chart-axis">
            {t}
          </text>
        </g>
      ))}
      {data.map(
        (d, i) =>
          (i % 4 === 0 || i === data.length - 1) && (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="chart-axis">
              {d.label}
            </text>
          ),
      )}
      {series.map((s) => (
        <g
          key={s.key}
          style={{
            opacity: highlight && highlight !== s.key ? 0.18 : 1,
            transition: 'opacity .3s',
          }}
        >
          {s.area && (
            <path
              d={area(s.key)}
              fill={`color-mix(in srgb, ${s.color} 14%, transparent)`}
              style={{ opacity: draw }}
            />
          )}
          <path
            d={path(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.w || 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - draw}
          />
          {showDots && (
            <circle
              cx={x(data.length - 1)}
              cy={y((data[data.length - 1] as unknown as Record<string, number>)?.[s.key] ?? 0)}
              r="3.5"
              fill={s.color}
              style={{ opacity: draw > 0.95 ? 1 : 0 }}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

export function Sparkline({
  data,
  dkey = 'score',
  color = 'var(--mint)',
  width = 140,
  height = 40,
  play = true,
}: {
  data: ChartRow[];
  dkey?: string;
  color?: string;
  width?: number;
  height?: number;
  play?: boolean;
}) {
  const vals = data.map((d) => asNumber(d[dkey]));
  const mn = Math.min(...vals) - 2,
    mx = Math.max(...vals) + 2;
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - ((v - mn) / (mx - mn)) * height;
  const d = vals
    .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v ?? 0).toFixed(1)}`)
    .join(' ');
  const [draw, setDraw] = useState(play ? 0 : 1);

  useEffect(() => {
    if (!play) return;
    let s: number | undefined;
    const tick = (ts: number) => {
      if (!s) s = ts;
      const t = Math.min(1, (ts - s) / 1200);
      setDraw(t);
      if (t < 1) requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [play]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="sparkline">
      <path
        d={`${d} L${width} ${height} L0 ${height} Z`}
        fill={`color-mix(in srgb, ${color} 12%, transparent)`}
        style={{ opacity: draw }}
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        pathLength="1"
        strokeDasharray="1"
        strokeDashoffset={1 - draw}
      />
      <circle
        cx={x(vals.length - 1)}
        cy={y(vals[vals.length - 1] ?? 0)}
        r="2.6"
        fill={color}
        style={{ opacity: draw > 0.9 ? 1 : 0 }}
      />
    </svg>
  );
}

export function VolumeBars({
  vol,
  width = 720,
  height = 180,
  play = true,
}: {
  vol: VolumeData;
  width?: number;
  height?: number;
  play?: boolean;
}) {
  const pad = { t: 10, r: 8, b: 24, l: 8 };
  const iw = width - pad.l - pad.r,
    ih = height - pad.t - pad.b;
  const max = Math.max(
    ...vol.weeks.map((w) => vol.sources.reduce((a, s) => a + (w[s] as number), 0)),
  );
  const bw = (iw / vol.weeks.length) * 0.62;
  const gap = iw / vol.weeks.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" className="volbars">
      {vol.weeks.map((w, i) => {
        let acc = 0;
        const cx = pad.l + i * gap + (gap - bw) / 2;
        return (
          <g key={i}>
            {vol.sources.map((s) => {
              const h = ((w[s] as number) / max) * ih;
              const yTop = pad.t + ih - acc - h;
              acc += h;
              return (
                <rect
                  key={s}
                  x={cx}
                  y={yTop}
                  width={bw}
                  height={Math.max(0, h - 1)}
                  rx="1.5"
                  fill={PS_SOURCES[s]?.tone}
                  style={{
                    opacity: 0.85,
                    transformOrigin: 'bottom',
                    animation: play
                      ? `growbar .8s ${i * 0.03}s both cubic-bezier(.2,.8,.2,1)`
                      : 'none',
                  }}
                />
              );
            })}
            {i % 3 === 0 && (
              <text x={cx + bw / 2} y={height - 8} textAnchor="middle" className="chart-axis">
                {w.label as string}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function MixDonut({ mix, size = 96 }: { mix: Record<string, number>; size?: number }) {
  const entries = Object.entries(mix);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const r = size / 2 - 8,
    cx = size / 2,
    c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: 'rotate(-90deg)' }}
    >
      {entries.map(([k, v]) => {
        const frac = v / total;
        const seg = (
          <circle
            key={k}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={PS_SOURCES[k]?.tone || 'var(--t3)'}
            strokeWidth="10"
            strokeDasharray={`${c * frac} ${c}`}
            strokeDashoffset={-c * acc}
            style={{ transition: 'stroke-dasharray .9s', opacity: 0.9 }}
          />
        );
        acc += frac;
        return seg;
      })}
    </svg>
  );
}
