import React from 'react';

/**
 * KPI card — the dashboard signature. A 3px mosaic accent bar,
 * an eyebrow + trend pill, a big Poppins figure, and a sparkline
 * that draws in. Accent + sparkline + trend share one colour.
 */
function buildSpark(spark, color, gradId) {
  // spark: array of y-values in 0..1 (1 = top). Maps to a 120x34 box.
  const W = 120, H = 34, pad = 4;
  const n = spark.length;
  const pts = spark.map((v, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * (W - 2) + 1;
    const y = pad + (1 - Math.max(0, Math.min(1, v))) * (H - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`;

  return React.createElement(
    'svg',
    {
      width: '100%',
      height: 34,
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      style: { marginTop: '12px', display: 'block' },
    },
    React.createElement(
      'defs',
      null,
      React.createElement(
        'linearGradient',
        { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 },
        React.createElement('stop', { offset: 0, stopColor: color, stopOpacity: 0.22 }),
        React.createElement('stop', { offset: 1, stopColor: color, stopOpacity: 0 })
      )
    ),
    React.createElement('path', { d: area, fill: `url(#${gradId})` }),
    React.createElement('path', {
      d: line,
      fill: 'none',
      stroke: color,
      strokeWidth: 2.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      style: { strokeDasharray: 260, strokeDashoffset: 260, animation: 'lh-drawln 1.2s var(--ease) .25s forwards' },
    })
  );
}

export function KpiCard({
  label,
  value,
  unit,
  trend,           // { dir: 'up'|'down', value: '12%', tone: 'positive'|'critical'|... }
  accent = 'var(--tes-blue)',
  spark,           // array of 0..1 values
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const gradId = React.useMemo(() => 'lhspk' + Math.random().toString(36).slice(2, 8), []);

  const TREND = {
    positive: { color: 'var(--status-positive)', bg: 'var(--status-positive-bg)' },
    info:     { color: 'var(--status-info)',     bg: 'var(--status-info-bg)' },
    warn:     { color: 'var(--status-warn)',     bg: 'var(--status-warn-bg)' },
    critical: { color: 'var(--status-critical)', bg: 'var(--status-critical-bg)' },
    teal:     { color: 'var(--status-teal)',     bg: 'var(--status-teal-bg)' },
    neutral:  { color: 'var(--status-neutral)',  bg: 'var(--status-neutral-bg)' },
  };
  const tt = trend ? (TREND[trend.tone] || TREND.neutral) : null;

  return React.createElement(
    'div',
    {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        position: 'relative',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-hairline)',
        borderRadius: '15px',
        padding: '18px',
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        overflow: 'hidden',
        transform: hover ? 'translateY(-3px)' : 'none',
        transition: 'transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
        ...style,
      },
      ...rest,
    },
    React.createElement('div', { style: { position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: accent } }),
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
      React.createElement('span', {
        style: { fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--text-muted)' },
      }, label),
      trend
        ? React.createElement('span', {
            style: { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontWeight: 700, color: tt.color, background: tt.bg, padding: '3px 7px', borderRadius: 'var(--radius-pill)' },
          }, (trend.dir === 'down' ? '▼ ' : '▲ ') + trend.value)
        : null
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'flex-end', gap: '7px', marginTop: '12px' } },
      React.createElement('span', {
        style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'var(--fs-stat)', lineHeight: 0.9, letterSpacing: 'var(--ls-tight)', color: 'var(--tes-ink)' },
      }, value),
      unit ? React.createElement('span', { style: { fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '6px' } }, unit) : null
    ),
    spark && spark.length ? buildSpark(spark, accent, gradId) : null
  );
}
