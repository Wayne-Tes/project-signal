/* @ds-bundle: {"format":3,"namespace":"LighthouseDesignSystem_68eba0","components":[{"name":"MosaicMark","sourcePath":"brand/MosaicMark.jsx"},{"name":"Avatar","sourcePath":"core/Avatar.jsx"},{"name":"Badge","sourcePath":"core/Badge.jsx"},{"name":"Button","sourcePath":"core/Button.jsx"},{"name":"Card","sourcePath":"core/Card.jsx"},{"name":"Chip","sourcePath":"core/Chip.jsx"},{"name":"DataTable","sourcePath":"core/DataTable.jsx"},{"name":"EmptyState","sourcePath":"core/EmptyState.jsx"},{"name":"ICON_PATHS","sourcePath":"core/Icon.jsx"},{"name":"Icon","sourcePath":"core/Icon.jsx"},{"name":"KpiCard","sourcePath":"core/KpiCard.jsx"},{"name":"PageHeader","sourcePath":"core/PageHeader.jsx"},{"name":"PanelHeader","sourcePath":"core/PanelHeader.jsx"},{"name":"Tabs","sourcePath":"core/Tabs.jsx"},{"name":"Input","sourcePath":"forms/Input.jsx"},{"name":"Select","sourcePath":"forms/Select.jsx"},{"name":"Composer","sourcePath":"patterns/Composer.jsx"},{"name":"AppShell","sourcePath":"shell/AppShell.jsx"},{"name":"Fab","sourcePath":"shell/Fab.jsx"},{"name":"LIGHTHOUSE_NAV","sourcePath":"shell/Sidebar.jsx"},{"name":"Sidebar","sourcePath":"shell/Sidebar.jsx"},{"name":"TopBar","sourcePath":"shell/TopBar.jsx"}],"sourceHashes":{"brand/MosaicMark.jsx":"8752ebab0f4e","core/Avatar.jsx":"5e5ef1231fb9","core/Badge.jsx":"164320cd1b56","core/Button.jsx":"6051b1e79ec7","core/Card.jsx":"36bd8911ae8c","core/Chip.jsx":"63ca659ab852","core/DataTable.jsx":"8605911fb504","core/EmptyState.jsx":"1f40a973b607","core/Icon.jsx":"653704368ca9","core/KpiCard.jsx":"da53b343a1fd","core/PageHeader.jsx":"4c48db2d5f2f","core/PanelHeader.jsx":"2392adcd24c6","core/Tabs.jsx":"a6ed283b83d4","forms/Input.jsx":"c7104c0329d4","forms/Select.jsx":"d8ecfa07cc21","patterns/Composer.jsx":"656c79b00b18","shell/AppShell.jsx":"c87c15d02eab","shell/Fab.jsx":"98404df588a9","shell/Sidebar.jsx":"4d9b0d885a05","shell/TopBar.jsx":"e440a97a91a3","ui_kits/lighthouse/HealthScreen.jsx":"14de67bfdc5c","ui_kits/lighthouse/HomeScreen.jsx":"93beee26ff18","ui_kits/lighthouse/InboxScreen.jsx":"2a10b2d52bad","ui_kits/lighthouse/TasksScreen.jsx":"9e4efad3c8c1"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.LighthouseDesignSystem_68eba0 = window.LighthouseDesignSystem_68eba0 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// brand/MosaicMark.jsx
try { (() => {
/**
 * Lighthouse brand mark — a 3×3 grid of rounded mosaic squares.
 * Used in the sidebar lockup and the assistant avatar. Recreated
 * from the Tes brand; swap for the official vector when available.
 */
const MOSAIC = ['#6B4E9E', '#2B7DC4', '#3FB6A8', '#C9275E', '#9FCB3B', '#E8843C', '#3E4A9E', '#5FB573', '#F2C13D'];
function MosaicMark({
  size = 32,
  gap,
  radius,
  style,
  ...rest
}) {
  const s = size;
  const g = gap != null ? gap : Math.round(s * 0.085); /* gap between tiles */
  const tile = (s - 2 * g) / 3;
  const rx = radius != null ? radius : tile * 0.28;
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      cells.push(React.createElement('rect', {
        key: r * 3 + c,
        x: c * (tile + g),
        y: r * (tile + g),
        width: tile,
        height: tile,
        rx,
        fill: MOSAIC[r * 3 + c]
      }));
    }
  }
  return React.createElement('svg', {
    width: s,
    height: s,
    viewBox: `0 0 ${s} ${s}`,
    style: {
      flex: 'none',
      display: 'block',
      ...style
    },
    'aria-label': 'Lighthouse',
    role: 'img',
    ...rest
  }, cells);
}
Object.assign(__ds_scope, { MosaicMark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "brand/MosaicMark.jsx", error: String((e && e.message) || e) }); }

// core/Avatar.jsx
try { (() => {
/**
 * Avatar — a rounded-square gradient tile with initials. The default
 * gradient is the Tes blue→purple lockup; pass `gradient` for a
 * mosaic pairing (e.g. risk = magenta→orange).
 */
function Avatar({
  name,
  initial,
  size = 38,
  gradient = 'linear-gradient(135deg,#2B7DC4,#6B4E9E)',
  radius,
  style,
  ...rest
}) {
  const letter = (initial || (name ? name.trim()[0] : '?') || '?').toUpperCase();
  const r = radius != null ? radius : Math.round(size * 0.26);
  return React.createElement('div', {
    title: name,
    style: {
      width: size,
      height: size,
      borderRadius: r,
      background: gradient,
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-body)',
      fontWeight: 700,
      fontSize: Math.round(size * 0.38),
      flex: 'none',
      ...style
    },
    ...rest
  }, letter);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/Avatar.jsx", error: String((e && e.message) || e) }); }

// core/Badge.jsx
try { (() => {
/**
 * Badge / status pill — small tinted pill for status & severity.
 * Tones map to the status colour system; pass `mosaic` for a
 * categorical (non-semantic) hue instead.
 */
const TONES = {
  positive: {
    color: 'var(--status-positive)',
    bg: 'var(--status-positive-bg)'
  },
  info: {
    color: 'var(--status-info)',
    bg: 'var(--status-info-bg)'
  },
  warn: {
    color: 'var(--status-warn)',
    bg: 'var(--status-warn-bg)'
  },
  critical: {
    color: 'var(--status-critical)',
    bg: 'var(--status-critical-bg)'
  },
  neutral: {
    color: 'var(--status-neutral)',
    bg: 'var(--status-neutral-bg)'
  },
  teal: {
    color: 'var(--status-teal)',
    bg: 'var(--status-teal-bg)'
  }
};

/** Soften a hex to a light tint background. */
function tint(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = n >> 16 & 255,
    g = n >> 8 & 255,
    b = n & 255;
  return `rgba(${r},${g},${b},0.13)`;
}
function Badge({
  children,
  tone = 'neutral',
  mosaic,
  style,
  ...rest
}) {
  const colors = mosaic ? {
    color: mosaic,
    bg: tint(mosaic)
  } : TONES[tone] || TONES.neutral;
  return React.createElement('span', {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontFamily: 'var(--font-body)',
      fontSize: '11px',
      fontWeight: 700,
      lineHeight: 1.4,
      color: colors.color,
      background: colors.bg,
      padding: '3px 8px',
      borderRadius: 'var(--radius-pill)',
      whiteSpace: 'nowrap',
      ...style
    },
    ...rest
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/Badge.jsx", error: String((e && e.message) || e) }); }

// core/Button.jsx
try { (() => {
/**
 * Button — the Lighthouse action primitive.
 * Variants: primary (navy), ghost (hairline white), danger (magenta),
 * subtle (link-blue text). Sizes: md (default), sm.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  disabled = false,
  type = 'button',
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const pad = size === 'sm' ? '7px 12px' : '10px 16px';
  const fs = size === 'sm' ? '13px' : '14px';
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    fontSize: fs,
    lineHeight: 1,
    padding: variant === 'subtle' ? '0' : pad,
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease), color var(--dur) var(--ease)',
    whiteSpace: 'nowrap',
    userSelect: 'none'
  };
  const variants = {
    primary: {
      background: hover && !disabled ? 'var(--tes-ink)' : 'var(--tes-navy)',
      color: '#fff',
      border: '1px solid transparent',
      transform: hover && !disabled ? 'translateY(-1px)' : 'none'
    },
    ghost: {
      background: hover && !disabled ? 'var(--tes-n-100)' : '#fff',
      color: 'var(--tes-ink)',
      border: '1px solid var(--tes-n-300)',
      borderColor: hover && !disabled ? 'var(--tes-n-400)' : 'var(--tes-n-300)'
    },
    danger: {
      background: hover && !disabled ? '#a81f4d' : 'var(--status-critical)',
      color: '#fff',
      border: '1px solid transparent',
      transform: hover && !disabled ? 'translateY(-1px)' : 'none'
    },
    subtle: {
      background: 'transparent',
      color: hover && !disabled ? 'var(--tes-blue-600)' : 'var(--tes-blue)',
      border: 'none'
    }
  };
  return React.createElement('button', {
    type,
    disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      ...base,
      ...variants[variant],
      ...style
    },
    ...rest
  }, iconLeft, children != null ? React.createElement('span', null, children) : null, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/Button.jsx", error: String((e && e.message) || e) }); }

// core/Card.jsx
try { (() => {
/**
 * Card — the base white surface. Hairline border, soft shadow,
 * 14px radius. Set `interactive` for the hover lift used on
 * clickable cards. Set `accent` for a 3px top accent bar.
 */
function Card({
  children,
  interactive = false,
  accent,
  padding = '20px',
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('div', {
    onMouseEnter: interactive ? () => setHover(true) : undefined,
    onMouseLeave: interactive ? () => setHover(false) : undefined,
    style: {
      position: 'relative',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-xs)',
      padding,
      overflow: accent ? 'hidden' : undefined,
      transform: hover ? 'translateY(-3px)' : 'none',
      transition: 'transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
      ...style
    },
    ...rest
  }, accent ? React.createElement('div', {
    key: '__accent',
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '3px',
      background: accent
    }
  }) : null, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/Card.jsx", error: String((e && e.message) || e) }); }

// core/Chip.jsx
try { (() => {
/**
 * Filter chip — a toggle pill used in filter rows (Tasks, Triage,
 * Sector radar, Opportunities). Inactive = neutral fill; active =
 * blue tint + blue text.
 */
function Chip({
  children,
  active = false,
  iconLeft,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('button', {
    type: 'button',
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontFamily: 'var(--font-body)',
      fontSize: '13px',
      fontWeight: 600,
      lineHeight: 1,
      padding: '7px 14px',
      borderRadius: 'var(--radius-pill)',
      cursor: 'pointer',
      transition: 'background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease)',
      color: active ? 'var(--tes-blue)' : 'var(--text-muted)',
      background: active ? 'var(--tes-blue-100)' : 'var(--tes-n-100)',
      border: active ? '1px solid var(--tes-blue)' : hover ? '1px solid var(--tes-blue)' : '1px solid transparent',
      ...style
    },
    ...rest
  }, iconLeft, children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/Chip.jsx", error: String((e && e.message) || e) }); }

// core/DataTable.jsx
try { (() => {
/**
 * Data table — the admin list surface (Users, Connectors, Knowledge,
 * API keys…). Uppercase header row, hairline-separated body rows,
 * hover wash. Pass `columns` and `rows`; a column can render a cell
 * via `render(row)`.
 */
function DataTable({
  columns = [],
  rows = [],
  style,
  ...rest
}) {
  return React.createElement('div', {
    style: {
      width: '100%',
      overflowX: 'auto',
      ...style
    },
    ...rest
  }, React.createElement('table', {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-body)'
    }
  }, React.createElement('thead', null, React.createElement('tr', null, columns.map((c, i) => React.createElement('th', {
    key: c.key || i,
    style: {
      textAlign: c.align || 'left',
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      letterSpacing: 'var(--ls-eyebrow)',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      padding: '0 16px 12px',
      borderBottom: '1px solid var(--border-hairline)',
      whiteSpace: 'nowrap'
    }
  }, c.header)))), React.createElement('tbody', null, rows.map((row, ri) => React.createElement(Row, {
    key: row.id != null ? row.id : ri,
    row,
    columns
  })))));
}
function Row({
  row,
  columns
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('tr', {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: hover ? 'var(--tes-n-50)' : 'transparent',
      transition: 'background var(--dur) var(--ease)'
    }
  }, columns.map((c, ci) => React.createElement('td', {
    key: c.key || ci,
    style: {
      textAlign: c.align || 'left',
      fontSize: '14px',
      color: 'var(--text-body)',
      padding: '14px 16px',
      borderBottom: '1px solid var(--border-hairline)',
      fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-body)',
      whiteSpace: c.wrap ? 'normal' : 'nowrap'
    }
  }, c.render ? c.render(row) : row[c.key])));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/DataTable.jsx", error: String((e && e.message) || e) }); }

// core/EmptyState.jsx
try { (() => {
/**
 * Empty state — a centred soft icon tile (gentle float), a Poppins
 * title, a muted one-liner and an optional primary action. Keep the
 * copy honest ("No meetings in your scope").
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  style,
  ...rest
}) {
  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '48px',
      gap: '18px',
      ...style
    },
    ...rest
  }, React.createElement('div', {
    style: {
      width: '88px',
      height: '88px',
      borderRadius: '24px',
      background: 'linear-gradient(135deg,var(--tes-blue-100),#fff)',
      border: '1px solid var(--border-hairline)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--tes-blue)',
      boxShadow: 'var(--shadow-sm)',
      animation: 'lh-floaty 4s ease-in-out infinite'
    }
  }, icon), React.createElement('div', null, React.createElement('h2', {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 800,
      fontSize: '24px',
      color: 'var(--tes-ink)',
      margin: 0,
      letterSpacing: 'var(--ls-tight)'
    }
  }, title), description != null ? React.createElement('p', {
    style: {
      margin: '10px 0 0',
      fontSize: '14.5px',
      color: 'var(--text-muted)',
      maxWidth: '380px',
      lineHeight: 1.5
    }
  }, description) : null), action != null ? action : null);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/EmptyState.jsx", error: String((e && e.message) || e) }); }

// core/Icon.jsx
try { (() => {
/**
 * Icon — the Lighthouse thin-line icon set (1.8px stroke, rounded,
 * the Lucide vocabulary). `<Icon name="health" />`. Pass any path
 * set via `extraPaths` for one-off glyphs not in the map.
 */
const ICON_PATHS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9v12h14V9', 'M9.5 21v-7h5v7'],
  inbox: ['M3 12h5l2 3h4l2-3h5', 'M5 5h14l2 7v7H3v-7z'],
  health: ['M3 12h4l2.5 7 4-15 2.5 8h5'],
  radar: ['M12 3a9 9 0 1 0 9 9', 'M12 7a5 5 0 1 0 5 5', 'M12 12 21 5'],
  champion: ['M7 4h10v3a5 5 0 0 1-10 0z', 'M7 5H4v1.5a3 3 0 0 0 3 3', 'M17 5h3v1.5a3 3 0 0 1-3 3', 'M9.5 16h5', 'M11 12.5h2v3.5h-2z', 'M8 20h8'],
  tasks: ['M4 4h16v16H4z', 'M8 12l3 3 5-6'],
  triage: ['M12 3 2.5 20h19z', 'M12 9.5v5', 'M12 17.5v.3'],
  playbooks: ['M12 6c-2-1.4-5-1.4-8-1v12c3-.4 6-.4 8 1', 'M12 6c2-1.4 5-1.4 8-1v12c-3-.4-6-.4-8 1', 'M12 6v13'],
  ledger: ['M3 17l6-6 4 4 8-8', 'M17 7h4v4'],
  opportunities: ['M12 3a9 9 0 1 0 9 9', 'M12 7a5 5 0 1 0 5 5', 'M12 2.5v3', 'M12 18.5v3', 'M2.5 12h3', 'M18.5 12h3'],
  meetings: ['M4 6h16v15H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  skills: ['M2 9l10-4 10 4-10 4z', 'M6 11v4.5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5V11', 'M22 9v5'],
  chat: ['M4 5h16v11H9l-4 4v-4H4z'],
  reports: ['M4 20V4', 'M4 20h16', 'M8 20v-6', 'M13 20v-10', 'M18 20v-4'],
  jobs: ['M4 7h16v13H4z', 'M9 7V5h6v2'],
  design: ['M12 3a9 9 0 1 0 0 18 2 2 0 0 0 0-4h2a4 4 0 0 0 4-4 6 6 0 0 0-6-6z', 'M7.5 12h.01', 'M10 8h.01', 'M14 8h.01'],
  search: ['M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M21 21l-4-4'],
  bell: ['M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6', 'M10 19a2 2 0 0 0 4 0'],
  palette: ['M12 3a9 9 0 1 0 0 18 2 2 0 0 0 0-4h2a4 4 0 0 0 4-4 6 6 0 0 0-6-6z', 'M7.5 12.5h.01', 'M10 8h.01', 'M14.5 8.5h.01'],
  plus: ['M12 5v14M5 12h14'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  sparkle: ['M12 3l1.6 4.8L18 9.4l-4.4 1.6L12 16l-1.6-5L6 9.4l4.4-1.6z', 'M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9z'],
  chevronDown: ['M8 9l4 4 4-4'],
  robot: ['M4 8h16v11H4z', 'M12 8V5M9 13h.01M15 13h.01'],
  trendUp: ['M3 16l5-5 4 4 8-9', 'M16 6h5v5'],
  check: ['M5 12l5 5 9-10'],
  archive: ['M3 5h18v4H3z', 'M5 9v11h14V9', 'M10 13h4'],
  snooze: ['M12 3a9 9 0 1 0 9 9', 'M12 7v5l3 2']
};
function Icon({
  name,
  size = 19,
  stroke = 'currentColor',
  strokeWidth = 1.8,
  extraPaths,
  style,
  ...rest
}) {
  const paths = extraPaths || ICON_PATHS[name] || [];
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: {
      flex: 'none',
      ...style
    },
    'aria-hidden': true,
    ...rest
  }, paths.map((d, i) => React.createElement('path', {
    key: i,
    d
  })));
}
Object.assign(__ds_scope, { ICON_PATHS, Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/Icon.jsx", error: String((e && e.message) || e) }); }

// core/KpiCard.jsx
try { (() => {
/**
 * KPI card — the dashboard signature. A 3px mosaic accent bar,
 * an eyebrow + trend pill, a big Poppins figure, and a sparkline
 * that draws in. Accent + sparkline + trend share one colour.
 */
function buildSpark(spark, color, gradId) {
  // spark: array of y-values in 0..1 (1 = top). Maps to a 120x34 box.
  const W = 120,
    H = 34,
    pad = 4;
  const n = spark.length;
  const pts = spark.map((v, i) => {
    const x = n === 1 ? W / 2 : i / (n - 1) * (W - 2) + 1;
    const y = pad + (1 - Math.max(0, Math.min(1, v))) * (H - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`;
  return React.createElement('svg', {
    width: '100%',
    height: 34,
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none',
    style: {
      marginTop: '12px',
      display: 'block'
    }
  }, React.createElement('defs', null, React.createElement('linearGradient', {
    id: gradId,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 1
  }, React.createElement('stop', {
    offset: 0,
    stopColor: color,
    stopOpacity: 0.22
  }), React.createElement('stop', {
    offset: 1,
    stopColor: color,
    stopOpacity: 0
  }))), React.createElement('path', {
    d: area,
    fill: `url(#${gradId})`
  }), React.createElement('path', {
    d: line,
    fill: 'none',
    stroke: color,
    strokeWidth: 2.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: {
      strokeDasharray: 260,
      strokeDashoffset: 260,
      animation: 'lh-drawln 1.2s var(--ease) .25s forwards'
    }
  }));
}
function KpiCard({
  label,
  value,
  unit,
  trend,
  // { dir: 'up'|'down', value: '12%', tone: 'positive'|'critical'|... }
  accent = 'var(--tes-blue)',
  spark,
  // array of 0..1 values
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const gradId = React.useMemo(() => 'lhspk' + Math.random().toString(36).slice(2, 8), []);
  const TREND = {
    positive: {
      color: 'var(--status-positive)',
      bg: 'var(--status-positive-bg)'
    },
    info: {
      color: 'var(--status-info)',
      bg: 'var(--status-info-bg)'
    },
    warn: {
      color: 'var(--status-warn)',
      bg: 'var(--status-warn-bg)'
    },
    critical: {
      color: 'var(--status-critical)',
      bg: 'var(--status-critical-bg)'
    },
    teal: {
      color: 'var(--status-teal)',
      bg: 'var(--status-teal-bg)'
    },
    neutral: {
      color: 'var(--status-neutral)',
      bg: 'var(--status-neutral-bg)'
    }
  };
  const tt = trend ? TREND[trend.tone] || TREND.neutral : null;
  return React.createElement('div', {
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
      ...style
    },
    ...rest
  }, React.createElement('div', {
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '3px',
      background: accent
    }
  }), React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px'
    }
  }, React.createElement('span', {
    style: {
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      letterSpacing: 'var(--ls-eyebrow)',
      textTransform: 'uppercase',
      color: 'var(--text-muted)'
    }
  }, label), trend ? React.createElement('span', {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
      fontSize: '11px',
      fontWeight: 700,
      color: tt.color,
      background: tt.bg,
      padding: '3px 7px',
      borderRadius: 'var(--radius-pill)'
    }
  }, (trend.dir === 'down' ? '▼ ' : '▲ ') + trend.value) : null), React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '7px',
      marginTop: '12px'
    }
  }, React.createElement('span', {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 800,
      fontSize: 'var(--fs-stat)',
      lineHeight: 0.9,
      letterSpacing: 'var(--ls-tight)',
      color: 'var(--tes-ink)'
    }
  }, value), unit ? React.createElement('span', {
    style: {
      fontSize: '12.5px',
      color: 'var(--text-muted)',
      marginBottom: '6px'
    }
  }, unit) : null), spark && spark.length ? buildSpark(spark, accent, gradId) : null);
}
Object.assign(__ds_scope, { KpiCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/KpiCard.jsx", error: String((e && e.message) || e) }); }

// core/PageHeader.jsx
try { (() => {
/**
 * Page header — the standard top-of-page block: a Poppins title, a
 * one-line muted subtitle, and an optional right-aligned action.
 * Every route opens with one.
 */
function PageHeader({
  title,
  subtitle,
  action,
  style,
  ...rest
}) {
  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: '16px',
      ...style
    },
    ...rest
  }, React.createElement('div', {
    style: {
      minWidth: 0
    }
  }, React.createElement('h2', {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 800,
      fontSize: 'var(--fs-h1)',
      color: 'var(--tes-ink)',
      margin: 0,
      letterSpacing: 'var(--ls-tight)'
    }
  }, title), subtitle != null ? React.createElement('p', {
    style: {
      margin: '5px 0 0',
      fontSize: '14px',
      color: 'var(--text-muted)'
    }
  }, subtitle) : null), action != null ? React.createElement('div', {
    style: {
      flex: 'none'
    }
  }, action) : null);
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/PageHeader.jsx", error: String((e && e.message) || e) }); }

// core/PanelHeader.jsx
try { (() => {
/**
 * Panel header — the light section header that replaces the old
 * navy bars. A mosaic-tinted icon tile + title/subtitle, with an
 * optional right-aligned action. Place at the top of a white card.
 */
const TINTS = {
  blue: {
    bg: 'var(--tes-blue-100)',
    fg: 'var(--tes-blue)'
  },
  lime: {
    bg: 'var(--tes-lime-100)',
    fg: 'var(--tes-lime-deep)'
  },
  purple: {
    bg: '#f3eefa',
    fg: 'var(--tes-mosaic-purple)'
  },
  teal: {
    bg: 'var(--status-teal-bg)',
    fg: 'var(--status-teal)'
  },
  orange: {
    bg: 'var(--status-warn-bg)',
    fg: 'var(--status-warn)'
  },
  magenta: {
    bg: 'var(--status-critical-bg)',
    fg: 'var(--status-critical)'
  },
  neutral: {
    bg: 'var(--tes-n-100)',
    fg: 'var(--tes-n-600)'
  }
};
function PanelHeader({
  icon,
  tone = 'blue',
  title,
  subtitle,
  action,
  style,
  ...rest
}) {
  const t = TINTS[tone] || TINTS.blue;
  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '13px',
      padding: '18px 22px',
      borderBottom: '1px solid var(--tes-n-100)',
      ...style
    },
    ...rest
  }, React.createElement('div', {
    style: {
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-md)',
      background: t.bg,
      color: t.fg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 'none'
    }
  }, icon), React.createElement('div', {
    style: {
      flex: '1 1 auto',
      minWidth: 0
    }
  }, React.createElement('div', {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 'var(--fs-h3)',
      color: 'var(--tes-ink)'
    }
  }, title), subtitle != null ? React.createElement('div', {
    style: {
      fontSize: '12.5px',
      color: 'var(--text-muted)',
      marginTop: '1px'
    }
  }, subtitle) : null), action != null ? React.createElement('div', {
    style: {
      flex: 'none'
    }
  }, action) : null);
}
Object.assign(__ds_scope, { PanelHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/PanelHeader.jsx", error: String((e && e.message) || e) }); }

// core/Tabs.jsx
try { (() => {
/**
 * Underline tabs — switch content in place. Active = ink text + a
 * 2px ink underline; inactive = muted text. Used on Health,
 * Inbox, Skills, Knowledge.
 */
function Tabs({
  tabs = [],
  value,
  onChange,
  style,
  ...rest
}) {
  return React.createElement('div', {
    role: 'tablist',
    style: {
      display: 'flex',
      gap: '28px',
      borderBottom: '1px solid var(--border-hairline)',
      ...style
    },
    ...rest
  }, tabs.map(t => {
    const id = typeof t === 'string' ? t : t.id;
    const label = typeof t === 'string' ? t : t.label;
    const active = id === value;
    return React.createElement('button', {
      key: id,
      type: 'button',
      role: 'tab',
      'aria-selected': active,
      onClick: () => onChange && onChange(id),
      style: {
        fontFamily: 'var(--font-body)',
        fontSize: '15px',
        fontWeight: active ? 700 : 600,
        color: active ? 'var(--tes-ink)' : 'var(--text-muted)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '0 0 14px',
        borderBottom: active ? '2px solid var(--tes-ink)' : '2px solid transparent',
        marginBottom: '-1px',
        transition: 'color var(--dur) var(--ease)'
      }
    }, label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "core/Tabs.jsx", error: String((e && e.message) || e) }); }

// forms/Input.jsx
try { (() => {
/**
 * Text input — label above, hairline border, blue focus ring,
 * inline error in critical magenta. Pass `as="textarea"` for a
 * multi-line field.
 */
function Input({
  label,
  hint,
  error,
  as = 'input',
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const autoId = React.useMemo(() => id || 'lh-in-' + Math.random().toString(36).slice(2, 7), [id]);
  const Tag = as === 'textarea' ? 'textarea' : 'input';
  const field = React.createElement(Tag, {
    id: autoId,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--fs-body)',
      color: 'var(--tes-ink)',
      background: '#fff',
      border: '1px solid ' + (error ? 'var(--status-critical)' : focus ? 'var(--tes-blue)' : 'var(--border-input)'),
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      outline: 'none',
      boxShadow: focus ? 'var(--shadow-focus)' : 'none',
      transition: 'border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
      resize: as === 'textarea' ? 'vertical' : undefined,
      minHeight: as === 'textarea' ? '88px' : undefined,
      ...style
    },
    ...rest
  });
  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, label != null ? React.createElement('label', {
    htmlFor: autoId,
    style: {
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--text-body)'
    }
  }, label) : null, field, error != null ? React.createElement('span', {
    style: {
      fontSize: '12.5px',
      color: 'var(--status-critical)'
    }
  }, error) : hint != null ? React.createElement('span', {
    style: {
      fontSize: '12.5px',
      color: 'var(--text-muted)'
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "forms/Input.jsx", error: String((e && e.message) || e) }); }

// forms/Select.jsx
try { (() => {
/**
 * Select — a labelled native select styled to match Input, with a
 * blue focus ring and a chevron affordance.
 */
function Select({
  label,
  hint,
  error,
  id,
  children,
  options,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const autoId = React.useMemo(() => id || 'lh-sel-' + Math.random().toString(36).slice(2, 7), [id]);
  const opts = options ? options.map(o => {
    const value = typeof o === 'string' ? o : o.value;
    const lbl = typeof o === 'string' ? o : o.label;
    return React.createElement('option', {
      key: value,
      value
    }, lbl);
  }) : children;
  const field = React.createElement('div', {
    style: {
      position: 'relative'
    }
  }, React.createElement('select', {
    id: autoId,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      appearance: 'none',
      WebkitAppearance: 'none',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--fs-body)',
      color: 'var(--tes-ink)',
      background: '#fff',
      border: '1px solid ' + (error ? 'var(--status-critical)' : focus ? 'var(--tes-blue)' : 'var(--border-input)'),
      borderRadius: 'var(--radius-md)',
      padding: '10px 34px 10px 12px',
      outline: 'none',
      cursor: 'pointer',
      boxShadow: focus ? 'var(--shadow-focus)' : 'none',
      transition: 'border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
      ...style
    },
    ...rest
  }, opts), React.createElement('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'var(--tes-n-500)',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style: {
      position: 'absolute',
      right: '11px',
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none'
    }
  }, React.createElement('path', {
    d: 'M8 9l4 4 4-4'
  })));
  return React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, label != null ? React.createElement('label', {
    htmlFor: autoId,
    style: {
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--text-body)'
    }
  }, label) : null, field, error != null ? React.createElement('span', {
    style: {
      fontSize: '12.5px',
      color: 'var(--status-critical)'
    }
  }, error) : hint != null ? React.createElement('span', {
    style: {
      fontSize: '12.5px',
      color: 'var(--text-muted)'
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "forms/Select.jsx", error: String((e && e.message) || e) }); }

// patterns/Composer.jsx
try { (() => {
/**
 * Composer — the "Ask Lighthouse" hero element. A mosaic-gradient-
 * bordered input with a navy send button, suggestion chips, and a
 * streamed response card (blinking caret + follow-up chips). Pass
 * `answer(query) => string` to drive the canned/streamed reply; wire
 * `onSubmit` to a real endpoint in production.
 */
function SuggestionChip({
  label,
  icon,
  onClick
}) {
  const [h, setH] = React.useState(false);
  return React.createElement('button', {
    onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '7px',
      fontFamily: 'var(--font-body)',
      fontSize: '13.5px',
      fontWeight: 600,
      color: h ? 'var(--tes-blue)' : 'var(--tes-slate)',
      background: '#fff',
      border: '1px solid ' + (h ? 'var(--tes-blue)' : 'var(--tes-n-200)'),
      borderRadius: '999px',
      padding: '9px 15px',
      cursor: 'pointer',
      transform: h ? 'translateY(-1px)' : 'none',
      boxShadow: h ? '0 4px 12px rgba(43,125,196,.12)' : 'none',
      transition: 'all .14s'
    }
  }, icon ? React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14,
    strokeWidth: 1.9
  }) : null, label);
}
function Composer({
  placeholder = 'Ask Lighthouse… (@ to mention an account)',
  suggestions = [],
  followups = ['Open a retention playbook', 'Show at-risk accounts', 'Export to CSV'],
  answer,
  onSubmit,
  userInitial = 'D',
  style
}) {
  const [query, setQuery] = React.useState('');
  const [sent, setSent] = React.useState(null);
  const [streamed, setStreamed] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const ivRef = React.useRef(null);
  React.useEffect(() => () => clearInterval(ivRef.current), []);
  const run = q => {
    const text = (q || '').trim();
    if (!text) return;
    if (onSubmit) onSubmit(text);
    const ans = answer ? answer(text) : 'Here is what I found across your portfolio. (Wire `answer` or `onSubmit` to your assistant endpoint.)';
    clearInterval(ivRef.current);
    setSent(text);
    setStreaming(true);
    setStreamed('');
    setQuery('');
    let i = 0;
    ivRef.current = setInterval(() => {
      i += 2;
      if (i >= ans.length) {
        clearInterval(ivRef.current);
        setStreamed(ans);
        setStreaming(false);
      } else setStreamed(ans.slice(0, i));
    }, 14);
  };
  return React.createElement('div', {
    style: {
      maxWidth: '780px',
      margin: '0 auto',
      ...style
    }
  }, React.createElement('div', {
    style: {
      padding: '1.5px',
      borderRadius: '20px',
      background: 'linear-gradient(120deg,#6B4E9E,#2B7DC4,#3FB6A8,#9FCB3B,#E8843C,#C9275E)',
      boxShadow: '0 14px 40px rgba(34,38,51,.12)'
    }
  }, React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      background: '#fff',
      borderRadius: '18.5px',
      padding: '14px 14px 14px 22px'
    }
  }, React.createElement(__ds_scope.Icon, {
    name: 'sparkle',
    size: 22,
    stroke: 'var(--tes-blue)',
    strokeWidth: 1.7
  }), React.createElement('input', {
    value: query,
    onChange: e => setQuery(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') run(query);
    },
    placeholder,
    style: {
      flex: '1 1 auto',
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-body)',
      fontSize: '17px',
      color: 'var(--tes-ink)'
    }
  }), React.createElement('button', {
    onClick: () => run(query),
    'aria-label': 'Send',
    style: {
      flex: 'none',
      width: '46px',
      height: '46px',
      borderRadius: '13px',
      border: 'none',
      cursor: 'pointer',
      background: 'var(--tes-navy)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, React.createElement(__ds_scope.Icon, {
    name: 'arrowUp',
    size: 20,
    stroke: '#fff',
    strokeWidth: 2
  })))), suggestions.length ? React.createElement('div', {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '10px',
      justifyContent: 'center',
      marginTop: '16px'
    }
  }, suggestions.map(s => React.createElement(SuggestionChip, {
    key: s.label,
    label: s.label,
    icon: s.icon,
    onClick: () => run(s.label)
  }))) : null, sent ? React.createElement('div', {
    style: {
      marginTop: '20px',
      background: '#fff',
      border: '1px solid var(--tes-n-200)',
      borderRadius: '16px',
      boxShadow: '0 8px 26px rgba(34,38,51,.08)',
      overflow: 'hidden',
      textAlign: 'left',
      animation: 'lh-fadeup .35s ease both'
    }
  }, React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '13px 20px',
      borderBottom: '1px solid var(--tes-n-100)',
      background: 'var(--tes-n-50)'
    }
  }, React.createElement(__ds_scope.Avatar, {
    initial: userInitial,
    size: 24,
    radius: 7
  }), React.createElement('span', {
    style: {
      fontSize: '14.5px',
      fontWeight: 600,
      color: 'var(--tes-ink)'
    }
  }, sent)), React.createElement('div', {
    style: {
      display: 'flex',
      gap: '13px',
      padding: '18px 20px'
    }
  }, React.createElement(__ds_scope.MosaicMark, {
    size: 26,
    radius: 5
  }), React.createElement('div', {
    style: {
      flex: '1 1 auto',
      minWidth: 0
    }
  }, React.createElement('div', {
    style: {
      fontSize: '12px',
      fontWeight: 700,
      color: 'var(--tes-lime-deep)',
      letterSpacing: '.02em',
      marginBottom: '6px'
    }
  }, 'LIGHTHOUSE'), React.createElement('p', {
    style: {
      margin: 0,
      fontSize: '15px',
      lineHeight: 1.62,
      color: 'var(--tes-n-700)',
      textWrap: 'pretty'
    }
  }, streamed, streaming ? React.createElement('span', {
    style: {
      display: 'inline-block',
      width: '8px',
      height: '17px',
      background: 'var(--tes-blue)',
      marginLeft: '2px',
      verticalAlign: '-2px',
      animation: 'lh-blink 1s steps(1) infinite'
    }
  }) : null), !streaming && followups.length ? React.createElement('div', {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      marginTop: '14px'
    }
  }, followups.map(f => React.createElement('button', {
    key: f,
    onClick: () => run(f),
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: '12.5px',
      fontWeight: 600,
      color: 'var(--tes-slate)',
      background: 'var(--tes-n-100)',
      border: 'none',
      borderRadius: '8px',
      padding: '7px 12px',
      cursor: 'pointer'
    }
  }, f))) : null))) : null);
}
Object.assign(__ds_scope, { Composer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "patterns/Composer.jsx", error: String((e && e.message) || e) }); }

// shell/Fab.jsx
try { (() => {
/**
 * Fab — the persistent assistant floating action button, bottom-right.
 * Opens the Lighthouse assistant; present on every route.
 */
function Fab({
  icon = 'robot',
  onClick,
  title = 'Ask Lighthouse',
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('button', {
    onClick,
    title,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'fixed',
      bottom: '26px',
      right: '26px',
      width: '54px',
      height: '54px',
      borderRadius: '999px',
      border: 'none',
      background: hover ? 'var(--tes-ink)' : 'var(--tes-navy)',
      boxShadow: 'var(--shadow-lg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: 30,
      transition: 'background var(--dur) var(--ease)',
      ...style
    },
    ...rest
  }, React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 24,
    stroke: '#fff'
  }));
}
Object.assign(__ds_scope, { Fab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "shell/Fab.jsx", error: String((e && e.message) || e) }); }

// shell/Sidebar.jsx
try { (() => {
/** Default Lighthouse navigation — pass your own `nav` to reuse the
 *  shell for another product. */
const LIGHTHOUSE_NAV = {
  workspace: [{
    id: 'Home',
    icon: 'home'
  }, {
    id: 'Inbox',
    icon: 'inbox',
    badge: '3',
    badgeColor: '#2B7DC4'
  }, {
    id: 'Health',
    icon: 'health'
  }, {
    id: 'Sector radar',
    icon: 'radar'
  }, {
    id: 'Champion watch',
    icon: 'champion'
  }, {
    id: 'Tasks',
    icon: 'tasks',
    badge: '13',
    badgeColor: '#E8843C'
  }, {
    id: 'Triage',
    icon: 'triage'
  }, {
    id: 'Playbooks',
    icon: 'playbooks'
  }, {
    id: 'Impact ledger',
    icon: 'ledger'
  }, {
    id: 'Opportunities',
    icon: 'opportunities'
  }, {
    id: 'Meetings',
    icon: 'meetings'
  }, {
    id: 'Skills',
    icon: 'skills'
  }, {
    id: 'Chat',
    icon: 'chat'
  }, {
    id: 'Reports',
    icon: 'reports'
  }],
  admin: [{
    id: 'Jobs',
    icon: 'jobs'
  }, {
    id: 'Design library',
    icon: 'design'
  }]
};
function NavItem({
  item,
  active,
  accent,
  navy,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const th = navy ? {
    item: 'rgba(255,255,255,.74)',
    icon: 'rgba(255,255,255,.55)',
    activeBg: 'rgba(255,255,255,.10)',
    activeText: '#fff',
    hoverBg: 'rgba(255,255,255,.06)'
  } : {
    item: '#5b616e',
    icon: '#8b909c',
    activeBg: accent + '24',
    activeText: 'var(--tes-ink)',
    hoverBg: '#f4f5f7'
  };
  return React.createElement('div', {
    onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '9px 12px',
      margin: '1px 12px',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      fontFamily: 'var(--font-body)',
      fontSize: '14px',
      fontWeight: active ? 700 : 500,
      color: active ? th.activeText : hover ? th.activeText : th.item,
      background: active ? th.activeBg : hover ? th.hoverBg : 'transparent',
      boxShadow: active ? 'inset 3px 0 0 ' + accent : 'none',
      transition: 'background .14s, color .14s',
      userSelect: 'none'
    }
  }, React.createElement(__ds_scope.Icon, {
    name: item.icon,
    stroke: active ? accent : th.icon
  }), React.createElement('span', {
    style: {
      flex: '1 1 auto',
      whiteSpace: 'nowrap'
    }
  }, item.label || item.id), item.badge ? React.createElement('span', {
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: '11px',
      fontWeight: 700,
      color: '#fff',
      background: item.badgeColor || '#C9275E',
      borderRadius: '999px',
      padding: '1px 7px',
      lineHeight: '16px'
    }
  }, item.badge) : null);
}
function Sidebar({
  nav = LIGHTHOUSE_NAV,
  active,
  onNav,
  navy = false,
  accent = '#9FCB3B',
  user = {
    name: 'dev-admin',
    scope: 'All scope · Tes Global',
    initial: 'D'
  },
  brand = 'Lighthouse',
  brandSub = 'by Tes'
}) {
  const th = navy ? {
    bg: '#2A2F3D',
    border: '1px solid rgba(255,255,255,.08)',
    brand: '#fff',
    sub: 'rgba(255,255,255,.55)',
    group: 'rgba(255,255,255,.42)',
    userBg: 'rgba(255,255,255,.04)'
  } : {
    bg: '#fff',
    border: '1px solid var(--tes-n-200)',
    brand: 'var(--tes-ink)',
    sub: 'var(--tes-n-500)',
    group: 'var(--tes-n-400)',
    userBg: 'var(--tes-n-50)'
  };
  const groups = [['WORKSPACE', nav.workspace || []], ['ADMIN', nav.admin || []]].filter(g => g[1].length);
  return React.createElement('aside', {
    style: {
      width: 'var(--sidebar-w)',
      flex: 'none',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: th.bg,
      borderRight: th.border
    }
  }, React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '11px',
      padding: '20px 20px 18px'
    }
  }, React.createElement(__ds_scope.MosaicMark, {
    size: 32
  }), React.createElement('div', {
    style: {
      lineHeight: 1.05
    }
  }, React.createElement('div', {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 800,
      fontSize: '18px',
      letterSpacing: '-.01em',
      color: th.brand
    }
  }, brand), React.createElement('div', {
    style: {
      fontSize: '11px',
      fontWeight: 600,
      color: th.sub,
      marginTop: '1px'
    }
  }, brandSub))), React.createElement('div', {
    style: {
      flex: '1 1 auto',
      overflowY: 'auto',
      paddingBottom: '8px'
    }
  }, groups.map(([label, items], gi) => React.createElement(React.Fragment, {
    key: label
  }, React.createElement('div', {
    style: {
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '.08em',
      color: th.group,
      padding: gi === 0 ? '14px 24px 7px' : '18px 24px 7px'
    }
  }, label), items.map(it => React.createElement(NavItem, {
    key: it.id,
    item: it,
    active: active === it.id,
    accent,
    navy,
    onClick: () => onNav && onNav(it.id)
  }))))), React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '12px 14px',
      margin: '8px 12px 12px',
      borderRadius: 'var(--radius-lg)',
      background: th.userBg,
      border: th.border,
      cursor: 'pointer'
    }
  }, React.createElement(__ds_scope.Avatar, {
    initial: user.initial,
    size: 34
  }), React.createElement('div', {
    style: {
      lineHeight: 1.2,
      flex: '1 1 auto',
      minWidth: 0
    }
  }, React.createElement('div', {
    style: {
      fontWeight: 700,
      fontSize: '13.5px',
      color: th.brand
    }
  }, user.name), React.createElement('div', {
    style: {
      fontSize: '11.5px',
      color: th.sub,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, user.scope)), React.createElement(__ds_scope.Icon, {
    name: 'chevronDown',
    size: 16,
    stroke: th.sub
  })));
}
Object.assign(__ds_scope, { LIGHTHOUSE_NAV, Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "shell/Sidebar.jsx", error: String((e && e.message) || e) }); }

// shell/TopBar.jsx
try { (() => {
function IconButton({
  children,
  onClick,
  title,
  badge
}) {
  const [hover, setHover] = React.useState(false);
  return React.createElement('button', {
    onClick,
    title,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'relative',
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--tes-n-200)',
      background: hover ? 'var(--tes-n-100)' : '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'background .14s',
      flex: 'none'
    }
  }, children, badge != null ? React.createElement('span', {
    style: {
      position: 'absolute',
      top: '-5px',
      right: '-5px',
      minWidth: '18px',
      height: '18px',
      padding: '0 4px',
      borderRadius: '999px',
      background: '#C9275E',
      color: '#fff',
      fontSize: '11px',
      fontWeight: 700,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '2px solid #fff'
    }
  }, badge) : null);
}

/**
 * TopBar — the glassy sticky top bar: page title, ⌘K search, the
 * Appearance popover (sidebar Light/Navy + accent), notification bell
 * and the user/scope pill. Appearance handlers are controlled by the
 * shell so the choice applies app-wide.
 */
function TopBar({
  title,
  navy = false,
  accent = '#9FCB3B',
  onSidebar,
  onAccent,
  accentOptions = ['#9FCB3B', '#2B7DC4', '#3FB6A8', '#E8843C', '#6B4E9E'],
  notifications = 2,
  user = {
    name: 'dev-admin',
    scope: 'all scope',
    initial: 'D'
  }
}) {
  const [appr, setAppr] = React.useState(false);
  const segBtn = on => ({
    flex: 1,
    textAlign: 'center',
    fontFamily: 'var(--font-body)',
    fontSize: '13px',
    fontWeight: 700,
    padding: '7px 0',
    borderRadius: '8px',
    cursor: 'pointer',
    border: 'none',
    background: on ? '#fff' : 'transparent',
    color: on ? 'var(--tes-ink)' : 'var(--tes-n-500)',
    boxShadow: on ? 'var(--shadow-xs)' : 'none'
  });
  return React.createElement('header', {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 20,
      display: 'flex',
      alignItems: 'center',
      gap: '18px',
      padding: '0 36px',
      height: 'var(--topbar-h)',
      background: 'rgba(255,255,255,.82)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      borderBottom: '1px solid var(--tes-n-200)',
      flex: 'none'
    }
  }, React.createElement('h1', {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: '20px',
      color: 'var(--tes-ink)',
      margin: 0,
      letterSpacing: '-.01em'
    }
  }, title), React.createElement('div', {
    style: {
      flex: '1 1 auto'
    }
  }), React.createElement('label', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '9px',
      background: 'var(--tes-n-100)',
      border: '1px solid transparent',
      borderRadius: 'var(--radius-md)',
      padding: '8px 12px',
      width: '280px'
    }
  }, React.createElement(__ds_scope.Icon, {
    name: 'search',
    size: 17,
    stroke: 'var(--tes-n-500)',
    strokeWidth: 1.9
  }), React.createElement('input', {
    placeholder: 'Search accounts, tasks…',
    style: {
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-body)',
      fontSize: '14px',
      color: 'var(--tes-ink)',
      flex: '1 1 auto',
      minWidth: 0
    }
  }), React.createElement('kbd', {
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: '11px',
      fontWeight: 600,
      color: 'var(--tes-n-500)',
      background: '#fff',
      border: '1px solid var(--tes-n-200)',
      borderRadius: '5px',
      padding: '1px 6px'
    }
  }, '⌘K')), React.createElement('div', {
    style: {
      position: 'relative'
    }
  }, React.createElement(IconButton, {
    title: 'Appearance',
    onClick: () => setAppr(v => !v)
  }, React.createElement(__ds_scope.Icon, {
    name: 'palette',
    stroke: 'var(--tes-slate)'
  })), appr ? React.createElement('div', {
    style: {
      position: 'absolute',
      top: '48px',
      right: 0,
      width: '236px',
      background: '#fff',
      border: '1px solid var(--tes-n-200)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      padding: '16px',
      zIndex: 40
    }
  }, React.createElement('div', {
    style: {
      fontSize: '11.5px',
      fontWeight: 700,
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      color: 'var(--tes-n-500)',
      marginBottom: '11px'
    }
  }, 'Appearance'), React.createElement('div', {
    style: {
      fontSize: '12.5px',
      fontWeight: 600,
      color: 'var(--tes-n-600)',
      marginBottom: '7px'
    }
  }, 'Sidebar'), React.createElement('div', {
    style: {
      display: 'flex',
      gap: '4px',
      background: 'var(--tes-n-100)',
      borderRadius: '10px',
      padding: '3px',
      marginBottom: '16px'
    }
  }, React.createElement('button', {
    onClick: () => onSidebar && onSidebar('light'),
    style: segBtn(!navy)
  }, 'Light'), React.createElement('button', {
    onClick: () => onSidebar && onSidebar('navy'),
    style: segBtn(navy)
  }, 'Navy')), React.createElement('div', {
    style: {
      fontSize: '12.5px',
      fontWeight: 600,
      color: 'var(--tes-n-600)',
      marginBottom: '9px'
    }
  }, 'Accent colour'), React.createElement('div', {
    style: {
      display: 'flex',
      gap: '11px'
    }
  }, accentOptions.map(c => React.createElement('button', {
    key: c,
    onClick: () => onAccent && onAccent(c),
    style: {
      width: '26px',
      height: '26px',
      borderRadius: '999px',
      background: c,
      cursor: 'pointer',
      border: '2px solid #fff',
      boxShadow: accent.toLowerCase() === c.toLowerCase() ? '0 0 0 2px ' + c : '0 0 0 1px var(--tes-n-300)'
    }
  })))) : null), React.createElement(IconButton, {
    badge: notifications != null ? String(notifications) : null
  }, React.createElement(__ds_scope.Icon, {
    name: 'bell',
    stroke: 'var(--tes-slate)'
  })), React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '5px 6px 5px 5px',
      border: '1px solid var(--tes-n-200)',
      borderRadius: 'var(--radius-md)',
      background: '#fff'
    }
  }, React.createElement(__ds_scope.Avatar, {
    initial: user.initial,
    size: 28,
    radius: 7
  }), React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '13px',
      color: 'var(--tes-slate)',
      fontWeight: 600
    }
  }, React.createElement('span', null, user.name), React.createElement(__ds_scope.Badge, {
    tone: 'info'
  }, user.scope)), React.createElement(__ds_scope.Icon, {
    name: 'chevronDown',
    size: 15,
    stroke: 'var(--tes-n-500)',
    strokeWidth: 1.9
  })));
}
Object.assign(__ds_scope, { TopBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "shell/TopBar.jsx", error: String((e && e.message) || e) }); }

// shell/AppShell.jsx
try { (() => {
/**
 * AppShell — the whole Lighthouse chrome in one component: fixed light
 * (or navy) sidebar with a lime active accent, a glassy sticky top bar
 * with the Appearance popover, and the assistant FAB. Renders your
 * route content as `children` in the scrolling main column.
 *
 * Appearance (sidebar Light/Navy + accent colour) is a real user
 * setting: it persists to localStorage (lh_sidebar, lh_accent) and
 * applies app-wide. Pass `persistAppearance={false}` to opt out.
 */
function AppShell({
  active,
  onNav,
  children,
  nav = __ds_scope.LIGHTHOUSE_NAV,
  pageTitle,
  user = {
    name: 'dev-admin',
    scope: 'all scope',
    initial: 'D'
  },
  notifications = 2,
  persistAppearance = true,
  onAssistant
}) {
  const [navy, setNavy] = React.useState(false);
  const [accent, setAccent] = React.useState('#9FCB3B');
  React.useEffect(() => {
    if (!persistAppearance) return;
    try {
      const s = localStorage.getItem('lh_sidebar');
      const a = localStorage.getItem('lh_accent');
      if (s === 'navy') setNavy(true);
      if (a) setAccent(a);
    } catch (e) {}
  }, [persistAppearance]);
  const chooseSidebar = v => {
    setNavy(v === 'navy');
    if (persistAppearance) {
      try {
        localStorage.setItem('lh_sidebar', v);
      } catch (e) {}
    }
  };
  const chooseAccent = c => {
    setAccent(c);
    if (persistAppearance) {
      try {
        localStorage.setItem('lh_accent', c);
      } catch (e) {}
    }
  };
  const sidebarUser = {
    name: user.name,
    scope: user.scope === 'all scope' ? 'All scope · Tes Global' : user.scope,
    initial: user.initial
  };
  return React.createElement('div', {
    'data-sidebar': navy ? 'navy' : 'light',
    style: {
      display: 'flex',
      height: '100vh',
      width: '100%',
      overflow: 'hidden',
      background: 'var(--app-bg)',
      color: 'var(--text-body)'
    }
  }, React.createElement(__ds_scope.Sidebar, {
    nav,
    active,
    onNav,
    navy,
    accent,
    user: sidebarUser
  }), React.createElement('main', {
    style: {
      flex: '1 1 auto',
      height: '100vh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column'
    }
  }, React.createElement(__ds_scope.TopBar, {
    title: pageTitle != null ? pageTitle : active,
    navy,
    accent,
    onSidebar: chooseSidebar,
    onAccent: chooseAccent,
    notifications,
    user
  }), children), React.createElement(__ds_scope.Fab, {
    onClick: onAssistant
  }));
}
Object.assign(__ds_scope, { AppShell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "shell/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lighthouse/HealthScreen.jsx
try { (() => {
/* Lighthouse — Health. Overview/Analytics tabs, 4 band stat cards,
   band distribution panel (donut + bars), top movers + entity lookup. */
(function () {
  const Icon = window.LHIcon;
  const {
    Tabs,
    Card,
    PanelHeader,
    Button,
    Badge,
    Avatar,
    Input
  } = window.LighthouseDesignSystem_68eba0;
  const BANDS = [{
    label: 'Healthy',
    count: 16,
    pct: '53% of 30',
    color: '#5FB573',
    barW: '53%',
    pill: ['#3f8a52', '#eaf5ec']
  }, {
    label: 'Attention',
    count: 4,
    pct: '13% of 30',
    color: '#E8843C',
    barW: '13%',
    pill: ['#B5611F', '#fdeede']
  }, {
    label: 'Critical',
    count: 1,
    pct: '3% of 30',
    color: '#C9275E',
    barW: '4%',
    pill: ['#C9275E', '#fbe7ee']
  }, {
    label: 'Unscored',
    count: 9,
    pct: '30% of 30',
    color: '#aeb3bf',
    barW: '30%',
    pill: ['#5b616e', '#f1f2f4']
  }];
  function HealthScreen() {
    const [tab, setTab] = React.useState('overview');
    const [lookup, setLookup] = React.useState('');
    const [result, setResult] = React.useState(null);
    const doLookup = () => {
      const name = (lookup || '').trim() || 'Riverside High';
      setResult({
        initial: name[0].toUpperCase(),
        name,
        meta: 'Secondary · State · last computed 09:47',
        score: 38,
        band: 'Critical'
      });
    };
    return React.createElement('div', {
      style: {
        maxWidth: '1240px',
        width: '100%',
        margin: '0 auto',
        padding: '32px 36px 72px'
      }
    }, React.createElement('div', {
      style: {
        marginBottom: '28px'
      }
    }, React.createElement(Tabs, {
      tabs: [{
        id: 'overview',
        label: 'Overview'
      }, {
        id: 'analytics',
        label: 'Analytics'
      }],
      value: tab,
      onChange: setTab
    })), tab === 'overview' ? React.createElement(React.Fragment, null, React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        gap: '16px'
      }
    }, BANDS.map((b, i) => React.createElement(Card, {
      key: b.label,
      accent: b.color,
      padding: '20px',
      style: {
        animation: `lh-fadeup .5s ease ${0.04 + i * 0.06}s both`
      }
    }, React.createElement('div', {
      style: {
        fontSize: '11.5px',
        fontWeight: 700,
        letterSpacing: '.05em',
        textTransform: 'uppercase',
        color: 'var(--tes-n-500)'
      }
    }, b.label), React.createElement('div', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '46px',
        lineHeight: 1,
        color: 'var(--tes-ink)',
        margin: '14px 0'
      }
    }, b.count), React.createElement('span', {
      style: {
        fontSize: '12px',
        fontWeight: 700,
        color: b.pill[0],
        background: b.pill[1],
        padding: '4px 10px',
        borderRadius: '999px',
        display: 'inline-block'
      }
    }, b.pct)))), React.createElement(Card, {
      padding: '0',
      style: {
        marginTop: '16px',
        animation: 'lh-fadeup .5s ease .24s both'
      }
    }, React.createElement(PanelHeader, {
      tone: 'lime',
      icon: React.createElement(Icon, {
        name: 'health',
        size: 20,
        strokeWidth: 1.9
      }),
      title: 'Band distribution',
      subtitle: 'Last computed 19/06/2026, 09:47:23'
    }), React.createElement('div', {
      style: {
        display: 'flex',
        gap: '40px',
        alignItems: 'center',
        padding: '26px 24px'
      }
    }, React.createElement('div', {
      style: {
        position: 'relative',
        width: '150px',
        height: '150px',
        flex: 'none'
      }
    }, React.createElement('svg', {
      width: 150,
      height: 150,
      viewBox: '0 0 120 120'
    }, React.createElement('circle', {
      cx: 60,
      cy: 60,
      r: 50,
      fill: 'none',
      stroke: '#eef0f3',
      strokeWidth: 13
    }), React.createElement('circle', {
      cx: 60,
      cy: 60,
      r: 50,
      fill: 'none',
      stroke: '#5FB573',
      strokeWidth: 13,
      strokeLinecap: 'round',
      transform: 'rotate(-90 60 60)',
      strokeDasharray: '314.2',
      strokeDashoffset: 148
    })), React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, React.createElement('span', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '30px',
        color: 'var(--tes-ink)',
        lineHeight: 1
      }
    }, '53%'), React.createElement('span', {
      style: {
        fontSize: '11.5px',
        color: 'var(--tes-n-500)',
        marginTop: '2px'
      }
    }, 'healthy'))), React.createElement('div', {
      style: {
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    }, BANDS.map(b => React.createElement('div', {
      key: b.label
    }, React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '6px'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '13.5px',
        fontWeight: 600,
        color: 'var(--tes-n-700)'
      }
    }, b.label), React.createElement('span', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '15px',
        color: 'var(--tes-ink)'
      }
    }, b.count)), React.createElement('div', {
      style: {
        height: '8px',
        borderRadius: '999px',
        background: 'var(--tes-n-100)',
        overflow: 'hidden'
      }
    }, React.createElement('div', {
      style: {
        height: '100%',
        borderRadius: '999px',
        background: b.color,
        width: b.barW,
        transformOrigin: 'left',
        animation: 'lh-growbar .9s ease .3s both'
      }
    }))))))), React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: '16px',
        marginTop: '16px'
      }
    }, React.createElement(Card, {
      padding: '0',
      style: {
        animation: 'lh-fadeup .5s ease .30s both'
      }
    }, React.createElement(PanelHeader, {
      tone: 'blue',
      icon: React.createElement(Icon, {
        name: 'trendUp',
        size: 20,
        strokeWidth: 1.9
      }),
      title: 'Top movers',
      subtitle: 'Band transitions since the last compute'
    }), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '44px 24px',
        gap: '12px'
      }
    }, React.createElement('div', {
      style: {
        width: '64px',
        height: '64px',
        borderRadius: '18px',
        background: 'linear-gradient(135deg,var(--tes-n-100),#fff)',
        border: '1px solid var(--tes-n-200)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, React.createElement(Icon, {
      name: 'trendUp',
      size: 26,
      stroke: 'var(--tes-n-400)',
      strokeWidth: 1.7
    })), React.createElement('p', {
      style: {
        margin: 0,
        fontSize: '14px',
        color: 'var(--tes-n-500)',
        maxWidth: '320px'
      }
    }, 'Transitions appear after the second daily compute — no history yet.'))), React.createElement(Card, {
      padding: '0',
      style: {
        animation: 'lh-fadeup .5s ease .36s both'
      }
    }, React.createElement(PanelHeader, {
      tone: 'purple',
      icon: React.createElement(Icon, {
        name: 'search',
        size: 20,
        strokeWidth: 1.9
      }),
      title: 'Entity Health Lookup',
      subtitle: 'Score & band for any account'
    }), React.createElement('div', {
      style: {
        padding: '20px 22px'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start'
      }
    }, React.createElement('div', {
      style: {
        flex: '1 1 auto'
      }
    }, React.createElement(Input, {
      value: lookup,
      onChange: e => setLookup(e.target.value),
      onKeyDown: e => {
        if (e.key === 'Enter') doLookup();
      },
      placeholder: 'Entity name or ObjectId…'
    })), React.createElement(Button, {
      onClick: doLookup
    }, 'Look up')), result ? React.createElement('div', {
      style: {
        marginTop: '16px',
        border: '1px solid var(--tes-n-200)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        animation: 'lh-fadeup .3s ease both'
      }
    }, React.createElement(Avatar, {
      initial: result.initial,
      gradient: 'linear-gradient(135deg,#C9275E,#E8843C)',
      size: 44
    }), React.createElement('div', {
      style: {
        flex: '1 1 auto',
        minWidth: 0
      }
    }, React.createElement('div', {
      style: {
        fontSize: '14.5px',
        fontWeight: 700,
        color: 'var(--tes-ink)'
      }
    }, result.name), React.createElement('div', {
      style: {
        fontSize: '12.5px',
        color: 'var(--tes-n-500)',
        marginTop: '1px'
      }
    }, result.meta)), React.createElement('div', {
      style: {
        textAlign: 'right'
      }
    }, React.createElement('div', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '26px',
        color: 'var(--tes-ink)',
        lineHeight: 1,
        marginBottom: '4px'
      }
    }, result.score), React.createElement(Badge, {
      tone: 'critical'
    }, result.band))) : null)))) : React.createElement(Card, {
      padding: '0',
      style: {
        animation: 'lh-fadeup .4s ease both'
      }
    }, React.createElement(PanelHeader, {
      tone: 'blue',
      icon: React.createElement(Icon, {
        name: 'reports',
        size: 20,
        strokeWidth: 1.9
      }),
      title: 'Healthy accounts over time',
      subtitle: 'Rolling 12-week trend · % of portfolio in the healthy band'
    }), React.createElement('div', {
      style: {
        padding: '24px'
      }
    }, React.createElement('svg', {
      width: '100%',
      height: 240,
      viewBox: '0 0 900 240',
      preserveAspectRatio: 'none',
      style: {
        display: 'block'
      }
    }, [40, 100, 160, 220].map(y => React.createElement('line', {
      key: y,
      x1: 0,
      y1: y,
      x2: 900,
      y2: y,
      stroke: '#eef0f3',
      strokeWidth: 1
    })), React.createElement('defs', null, React.createElement('linearGradient', {
      id: 'lh-ar',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1
    }, React.createElement('stop', {
      offset: 0,
      stopColor: '#5FB573',
      stopOpacity: 0.18
    }), React.createElement('stop', {
      offset: 1,
      stopColor: '#5FB573',
      stopOpacity: 0
    }))), React.createElement('path', {
      d: 'M0 170 L82 158 L164 162 L246 140 L328 132 L410 138 L492 118 L574 112 L656 120 L738 98 L820 92 L900 84 L900 240 L0 240 Z',
      fill: 'url(#lh-ar)'
    }), React.createElement('path', {
      d: 'M0 170 L82 158 L164 162 L246 140 L328 132 L410 138 L492 118 L574 112 L656 120 L738 98 L820 92 L900 84',
      fill: 'none',
      stroke: '#5FB573',
      strokeWidth: 3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    })), React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '10px',
        fontSize: '11.5px',
        color: 'var(--tes-n-400)'
      }
    }, ['12w ago', '9w', '6w', '3w', 'Now'].map(l => React.createElement('span', {
      key: l
    }, l))))));
  }
  window.HealthScreen = HealthScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lighthouse/HealthScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lighthouse/HomeScreen.jsx
try { (() => {
/* Lighthouse — Home. Hero greeting + "Ask Lighthouse" composer (canned
   streamed answers) + KPI bento + portfolio donut / at-risk / your-day. */
(function () {
  const Icon = window.LHIcon;
  const {
    KpiCard,
    Card,
    Avatar,
    Button,
    MosaicMark
  } = window.LighthouseDesignSystem_68eba0;
  const ANSWERS = q => {
    const t = (q || '').toLowerCase();
    if (t.includes('platform') || t.includes('what is')) return 'Lighthouse is your customer-success command centre for Tes. It unifies CRM, account health, behaviour-data signals and playbooks — so you can spot at-risk schools early and act before renewal. Everything here is scoped to your 30 accounts.';
    if (t.includes('risk')) return '3 accounts dropped into the critical band this week. Riverside High fell to a health score of 38 (down 12) after a 40% drop in Class Charts logins, and Greenfield MAT slipped to 52 following a leadership change. Shall I open a retention playbook for Riverside?';
    if (t.includes('playbook')) return 'Head to Playbooks → New. Pick a trigger (e.g. health score below 50), add your steps — an automated email, a task for the account owner, a check-in — and Lighthouse runs it across every matching account. Clone the "Renewal rescue" template to start.';
    if (t.includes('headteacher') || t.includes('changed')) return '4 schools recorded a headteacher change in the last 90 days: Oakwood Academy, St Mary\u2019s CofE Primary, Greenfield MAT and Archbishop Ilsley. Leadership changes are a renewal-risk signal — want me to flag all four for a check-in?';
    return 'Across your portfolio: 16 of 30 accounts are healthy, 9 are on watch and 5 are critical. The biggest mover this week is Riverside High (down 12). Ask about a specific account, or pick a suggestion to dig in.';
  };
  const SUGGESTIONS = [['What is this platform?', 'triage'], ['Show at-risk accounts', 'triage'], ['How do I create a playbook?', 'playbooks'], ['Which schools changed headteacher recently?', 'champion']];
  function Composer() {
    return React.createElement(window.LighthouseDesignSystem_68eba0.Composer, {
      answer: ANSWERS,
      suggestions: SUGGESTIONS.map(([label, icon]) => ({
        label,
        icon
      })),
      followups: ['Open a retention playbook', 'Show at-risk accounts', 'Export to CSV']
    });
  }
  const ACCOUNTS = [['R', 'Riverside High', 'Secondary · State', 38, '▼12', 'linear-gradient(135deg,#C9275E,#E8843C)', '#C9275E'], ['G', 'Greenfield MAT', 'Multi-academy trust', 52, '▼6', 'linear-gradient(135deg,#E8843C,#F2C13D)', '#B5611F'], ['S', "St Mary's CofE", 'Primary · Faith', 61, '▼3', 'linear-gradient(135deg,#6B4E9E,#2B7DC4)', '#B5611F'], ['O', 'Oakwood Academy', 'Secondary · Academy', 74, '▲4', 'linear-gradient(135deg,#3FB6A8,#5FB573)', '#247f76']];
  function HomeScreen() {
    const [tasks, setTasks] = React.useState([{
      id: 't1',
      title: 'Renewal call — Riverside High',
      time: '09:30',
      prio: 'High',
      done: false
    }, {
      id: 't2',
      title: 'Review Q3 renewal forecast',
      time: '11:00',
      prio: 'Medium',
      done: false
    }, {
      id: 't3',
      title: 'Prep QBR deck for Greenfield MAT',
      time: '14:00',
      prio: 'Medium',
      done: true
    }, {
      id: 't4',
      title: "Reply to St Mary's adoption query",
      time: '16:30',
      prio: 'High',
      done: false
    }]);
    const prioColor = {
      High: '#C9275E',
      Medium: '#B5611F',
      Low: '#247f76'
    };
    const prioBg = {
      High: '#fbe7ee',
      Medium: '#fdeede',
      Low: '#e2f4f1'
    };
    const left = tasks.filter(t => !t.done).length;
    const accent = '#9FCB3B';
    return React.createElement('div', {
      style: {
        maxWidth: '1240px',
        width: '100%',
        margin: '0 auto',
        padding: '40px 36px 72px'
      }
    }, React.createElement('div', {
      style: {
        textAlign: 'center',
        margin: '18px 0 30px',
        animation: 'lh-fadeup .5s ease both'
      }
    }, React.createElement('div', {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--tes-blue)',
        background: 'var(--tes-blue-100)',
        padding: '6px 13px',
        borderRadius: '999px',
        marginBottom: '20px'
      }
    }, React.createElement('span', {
      style: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        background: 'var(--tes-lime)',
        animation: 'lh-ringpulse 2.2s infinite'
      }
    }), 'Tuesday 19 June · 14 accounts updated today'), React.createElement('h2', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '52px',
        lineHeight: 1.02,
        letterSpacing: '-.025em',
        color: 'var(--tes-ink)',
        margin: 0
      }
    }, 'Good evening, Admin'), React.createElement('p', {
      style: {
        fontSize: '17px',
        color: 'var(--tes-n-600)',
        margin: '14px 0 0'
      }
    }, "Here's what's moving across your portfolio. Ask anything, or jump into a signal below.")), React.createElement(Composer, null), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '16px',
        margin: '54px 0 18px'
      }
    }, React.createElement('div', null, React.createElement('h3', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '26px',
        color: 'var(--tes-ink)',
        margin: 0,
        letterSpacing: '-.02em'
      }
    }, 'Your dashboard'), React.createElement('p', {
      style: {
        margin: '5px 0 0',
        fontSize: '14px',
        color: 'var(--tes-n-500)'
      }
    }, 'Live signals across 30 accounts · updated 4 min ago')), React.createElement(Button, {
      variant: 'ghost',
      iconLeft: React.createElement(Icon, {
        name: 'plus',
        size: 16,
        strokeWidth: 2
      })
    }, 'Add metric')), React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(5,1fr)',
        gap: '16px'
      }
    }, React.createElement(KpiCard, {
      label: 'Critical accounts',
      value: '1',
      unit: 'in critical band',
      accent: '#C9275E',
      trend: {
        dir: 'up',
        value: '1',
        tone: 'critical'
      },
      spark: [0.2, 0.35, 0.3, 0.55, 0.5, 0.78, 0.92]
    }), React.createElement(KpiCard, {
      label: 'Portfolio health',
      value: React.createElement(React.Fragment, null, '16', React.createElement('span', {
        style: {
          fontSize: '24px',
          color: 'var(--tes-n-400)'
        }
      }, '/30')),
      unit: 'healthy',
      accent: '#5FB573',
      trend: {
        dir: 'up',
        value: '2',
        tone: 'positive'
      },
      spark: [0.35, 0.42, 0.3, 0.5, 0.6, 0.68, 0.82]
    }), React.createElement(KpiCard, {
      label: 'Overdue tasks',
      value: '13',
      unit: 'past due',
      accent: '#E8843C',
      trend: {
        dir: 'up',
        value: '3',
        tone: 'warn'
      },
      spark: [0.6, 0.4, 0.66, 0.36, 0.52, 0.3, 0.46]
    }), React.createElement(KpiCard, {
      label: 'Open triage',
      value: '4',
      unit: 'scored tickets',
      accent: '#2B7DC4',
      trend: {
        dir: 'down',
        value: '1',
        tone: 'info'
      },
      spark: [0.75, 0.6, 0.66, 0.46, 0.5, 0.34, 0.3]
    }), React.createElement(KpiCard, {
      label: 'Adoption',
      value: '7,173',
      unit: 'req / week',
      accent: '#3FB6A8',
      trend: {
        dir: 'up',
        value: '12%',
        tone: 'teal'
      },
      spark: [0.15, 0.28, 0.26, 0.48, 0.42, 0.7, 0.92]
    })), React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1.45fr 1fr',
        gap: '16px',
        marginTop: '16px',
        alignItems: 'stretch'
      }
    }, /* donut */
    React.createElement(Card, null, React.createElement('h4', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '16px',
        color: 'var(--tes-ink)',
        margin: '0 0 2px'
      }
    }, 'Portfolio health'), React.createElement('p', {
      style: {
        margin: '0 0 14px',
        fontSize: '12.5px',
        color: 'var(--tes-n-500)'
      }
    }, 'Across 30 accounts'), React.createElement('div', {
      style: {
        position: 'relative',
        width: '160px',
        height: '160px',
        margin: '4px auto 16px'
      }
    }, React.createElement('svg', {
      width: 160,
      height: 160,
      viewBox: '0 0 120 120'
    }, React.createElement('circle', {
      cx: 60,
      cy: 60,
      r: 50,
      fill: 'none',
      stroke: '#eef0f3',
      strokeWidth: 14
    }), React.createElement('g', {
      transform: 'rotate(-90 60 60)'
    }, React.createElement('circle', {
      cx: 60,
      cy: 60,
      r: 50,
      fill: 'none',
      stroke: '#5FB573',
      strokeWidth: 14,
      strokeLinecap: 'round',
      strokeDasharray: '167.5 314.2'
    }), React.createElement('circle', {
      cx: 60,
      cy: 60,
      r: 50,
      fill: 'none',
      stroke: '#E8843C',
      strokeWidth: 14,
      strokeLinecap: 'round',
      strokeDasharray: '94.2 314.2',
      strokeDashoffset: -171.5
    }), React.createElement('circle', {
      cx: 60,
      cy: 60,
      r: 50,
      fill: 'none',
      stroke: '#C9275E',
      strokeWidth: 14,
      strokeLinecap: 'round',
      strokeDasharray: '52.4 314.2',
      strokeDashoffset: -269.7
    }))), React.createElement('div', {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, React.createElement('span', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '32px',
        color: 'var(--tes-ink)',
        lineHeight: 1
      }
    }, '53', React.createElement('span', {
      style: {
        fontSize: '18px',
        color: 'var(--tes-n-400)'
      }
    }, '%')), React.createElement('span', {
      style: {
        fontSize: '11.5px',
        color: 'var(--tes-n-500)',
        marginTop: '2px'
      }
    }, 'healthy'))), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '9px'
      }
    }, [['Healthy', '#5FB573', 16], ['Watch', '#E8843C', 9], ['Critical', '#C9275E', 5]].map(([l, c, n]) => React.createElement('div', {
      key: l,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        fontSize: '13px'
      }
    }, React.createElement('span', {
      style: {
        width: '9px',
        height: '9px',
        borderRadius: '3px',
        background: c
      }
    }), React.createElement('span', {
      style: {
        flex: 1,
        color: 'var(--tes-n-700)'
      }
    }, l), React.createElement('span', {
      style: {
        fontWeight: 700,
        color: 'var(--tes-ink)'
      }
    }, n))))), /* at-risk */
    React.createElement(Card, null, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px'
      }
    }, React.createElement('div', null, React.createElement('h4', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '16px',
        color: 'var(--tes-ink)',
        margin: '0 0 2px'
      }
    }, 'Accounts needing attention'), React.createElement('p', {
      style: {
        margin: 0,
        fontSize: '12.5px',
        color: 'var(--tes-n-500)'
      }
    }, 'Sorted by health-score movement')), React.createElement(Button, {
      variant: 'subtle'
    }, 'View all →')), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, ACCOUNTS.map(([ini, name, sector, score, trend, bg, color]) => React.createElement('div', {
      key: name,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '13px',
        padding: '12px 8px',
        borderRadius: '11px',
        cursor: 'pointer'
      }
    }, React.createElement(Avatar, {
      initial: ini,
      gradient: bg,
      size: 38
    }), React.createElement('div', {
      style: {
        flex: '1 1 auto',
        minWidth: 0
      }
    }, React.createElement('div', {
      style: {
        fontSize: '14px',
        fontWeight: 700,
        color: 'var(--tes-ink)'
      }
    }, name), React.createElement('div', {
      style: {
        fontSize: '12px',
        color: 'var(--tes-n-500)',
        marginTop: '1px'
      }
    }, sector)), React.createElement('div', {
      style: {
        width: '96px',
        flex: 'none'
      }
    }, React.createElement('div', {
      style: {
        height: '6px',
        borderRadius: '999px',
        background: 'var(--tes-n-100)',
        overflow: 'hidden'
      }
    }, React.createElement('div', {
      style: {
        height: '100%',
        width: score + '%',
        borderRadius: '999px',
        background: color
      }
    })), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '5px'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '13px',
        fontWeight: 800,
        fontFamily: 'var(--font-display)',
        color: 'var(--tes-ink)'
      }
    }, score), React.createElement('span', {
      style: {
        fontSize: '11px',
        fontWeight: 700,
        color
      }
    }, trend))))))), /* your day */
    React.createElement(Card, {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, React.createElement('div', {
      style: {
        marginBottom: '14px'
      }
    }, React.createElement('h4', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '16px',
        color: 'var(--tes-ink)',
        margin: '0 0 2px'
      }
    }, 'Your day'), React.createElement('p', {
      style: {
        margin: 0,
        fontSize: '12.5px',
        color: 'var(--tes-n-500)'
      }
    }, left + ' of ' + tasks.length + ' remaining')), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        flex: '1 1 auto'
      }
    }, tasks.map(t => React.createElement('div', {
      key: t.id,
      onClick: () => setTasks(s => s.map(x => x.id === t.id ? {
        ...x,
        done: !x.done
      } : x)),
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '11px',
        padding: '10px 8px',
        borderRadius: '10px',
        cursor: 'pointer'
      }
    }, React.createElement('div', {
      style: {
        width: '20px',
        height: '20px',
        borderRadius: '6px',
        flex: 'none',
        marginTop: '1px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: t.done ? 'none' : '2px solid var(--tes-n-300)',
        background: t.done ? accent : '#fff',
        transition: 'all .14s'
      }
    }, t.done ? React.createElement(Icon, {
      name: 'check',
      size: 12,
      stroke: '#fff',
      strokeWidth: 3.2
    }) : null), React.createElement('div', {
      style: {
        flex: '1 1 auto',
        minWidth: 0
      }
    }, React.createElement('div', {
      style: {
        fontSize: '13.5px',
        fontWeight: 600,
        color: t.done ? 'var(--tes-n-400)' : 'var(--tes-ink)',
        textDecoration: t.done ? 'line-through' : 'none'
      }
    }, t.title), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        marginTop: '3px'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '11.5px',
        fontWeight: 600,
        color: 'var(--tes-n-500)'
      }
    }, t.time), React.createElement('span', {
      style: {
        fontSize: '10.5px',
        fontWeight: 700,
        color: prioColor[t.prio],
        background: prioBg[t.prio],
        padding: '1px 7px',
        borderRadius: '999px'
      }
    }, t.prio)))))), React.createElement('button', {
      style: {
        marginTop: '12px',
        width: '100%',
        fontFamily: 'var(--font-body)',
        fontSize: '13px',
        fontWeight: 700,
        color: 'var(--tes-slate)',
        background: 'var(--tes-n-100)',
        border: 'none',
        borderRadius: '9px',
        padding: '10px',
        cursor: 'pointer'
      }
    }, 'Go to Tasks →'))));
  }
  window.HomeScreen = HomeScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lighthouse/HomeScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lighthouse/InboxScreen.jsx
try { (() => {
/* Lighthouse — Signal inbox. Tabs + one white card per account with
   severity-graded signal lines, each citing its source. */
(function () {
  const Icon = window.LHIcon;
  const {
    Tabs,
    Card,
    Button,
    Badge
  } = window.LighthouseDesignSystem_68eba0;
  const DIGESTS = [{
    account: 'Riverside High',
    date: '19 Jun, 08:00',
    groups: [{
      sev: 'critical',
      label: 'Critical blockers',
      lines: [['Class Charts logins down 41% week-on-week — lowest since onboarding.', 'usage[3]'], ['Renewal owner has not replied to two outreach emails in 14 days.', 'crm[7]']]
    }, {
      sev: 'warn',
      label: 'Engagement concerns',
      lines: [['Behaviour-points entry concentrated in 2 of 9 departments.', 'usage[5]']]
    }]
  }, {
    account: 'Greenfield MAT',
    date: '19 Jun, 08:00',
    groups: [{
      sev: 'critical',
      label: 'Critical blockers',
      lines: [['Headteacher change recorded at lead school — primary champion has left.', 'gias[1]']]
    }, {
      sev: 'warn',
      label: 'Engagement concerns',
      lines: [['Trust-wide rollout paused; 3 of 6 schools yet to activate.', 'crm[2]'], ['Support ticket open 9 days on SIS data import.', 'tickets[4]']]
    }]
  }];
  const SEV = {
    critical: {
      tone: 'critical',
      heading: 'var(--status-critical)'
    },
    warn: {
      tone: 'warn',
      heading: 'var(--status-warn)'
    }
  };
  function InboxScreen() {
    const [tab, setTab] = React.useState('inbox');
    return React.createElement('div', {
      style: {
        maxWidth: '1240px',
        width: '100%',
        margin: '0 auto',
        padding: '32px 36px 72px'
      }
    }, React.createElement('div', {
      style: {
        marginBottom: '6px'
      }
    }, React.createElement('h2', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '26px',
        color: 'var(--tes-ink)',
        margin: 0,
        letterSpacing: '-.02em'
      }
    }, 'Signal inbox'), React.createElement('p', {
      style: {
        margin: '5px 0 0',
        fontSize: '14px',
        color: 'var(--tes-n-500)'
      }
    }, 'Severity-graded daily digests per account — every line cites its source.')), React.createElement('div', {
      style: {
        margin: '22px 0 24px'
      }
    }, React.createElement(Tabs, {
      tabs: [{
        id: 'inbox',
        label: 'Inbox'
      }, {
        id: 'archive',
        label: 'Archive'
      }, {
        id: 'snoozed',
        label: 'Snoozed'
      }],
      value: tab,
      onChange: setTab
    })), tab === 'inbox' ? React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    }, DIGESTS.map((d, i) => React.createElement(Card, {
      key: d.account,
      padding: '0',
      style: {
        animation: `lh-fadeup .5s ease ${0.04 + i * 0.08}s both`
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 22px',
        borderBottom: '1px solid var(--tes-n-100)'
      }
    }, React.createElement('div', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '17px',
        color: 'var(--tes-ink)'
      }
    }, d.account), React.createElement('span', {
      style: {
        fontSize: '12.5px',
        color: 'var(--tes-n-500)'
      }
    }, d.date)), React.createElement('div', {
      style: {
        padding: '6px 22px 18px'
      }
    }, d.groups.map(g => React.createElement('div', {
      key: g.label,
      style: {
        marginTop: '14px'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px'
      }
    }, React.createElement('span', {
      style: {
        width: '8px',
        height: '8px',
        borderRadius: '999px',
        background: SEV[g.sev].heading
      }
    }), React.createElement('span', {
      style: {
        fontSize: '11.5px',
        fontWeight: 700,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        color: SEV[g.sev].heading
      }
    }, g.label)), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }
    }, g.lines.map(([line, cite], j) => React.createElement('div', {
      key: j,
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        fontSize: '14px',
        color: 'var(--tes-n-700)',
        lineHeight: 1.5
      }
    }, React.createElement('span', {
      style: {
        flex: '1 1 auto'
      }
    }, line), React.createElement('span', {
      style: {
        flex: 'none',
        marginTop: '1px'
      }
    }, React.createElement(Badge, {
      tone: SEV[g.sev].tone
    }, cite))))))), React.createElement('div', {
      style: {
        display: 'flex',
        gap: '10px',
        marginTop: '18px'
      }
    }, React.createElement(Button, {
      variant: 'ghost',
      size: 'sm',
      iconLeft: React.createElement(Icon, {
        name: 'archive',
        size: 15
      })
    }, 'Archive'), React.createElement(Button, {
      variant: 'ghost',
      size: 'sm',
      iconLeft: React.createElement(Icon, {
        name: 'snooze',
        size: 15
      })
    }, 'Snooze')))))) : React.createElement(Card, {
      style: {
        textAlign: 'center',
        padding: '56px 24px',
        color: 'var(--tes-n-500)',
        fontSize: '14px'
      }
    }, tab === 'archive' ? 'No archived digests.' : 'Nothing snoozed.'));
  }
  window.InboxScreen = InboxScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lighthouse/InboxScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lighthouse/TasksScreen.jsx
try { (() => {
/* Lighthouse — Tasks (Kanban). Stat tiles, filter chip rows, four
   status columns; cards carry priority + source chips and an inline
   Move select (the accessible fallback for drag). */
(function () {
  const Icon = window.LHIcon;
  const {
    KpiCard,
    Card,
    Chip,
    Badge,
    Select
  } = window.LighthouseDesignSystem_68eba0;
  const COLUMNS = ['To do', 'In progress', 'Waiting on customer', 'Done'];
  const SEED = [{
    id: 1,
    col: 'To do',
    title: 'Renewal call — Riverside High',
    prio: 'high',
    source: 'playbook',
    due: '18/06/2026',
    overdue: true
  }, {
    id: 2,
    col: 'To do',
    title: 'Chase SIS import ticket — Greenfield MAT',
    prio: 'high',
    source: 'ticket',
    due: '22/06/2026'
  }, {
    id: 3,
    col: 'To do',
    title: 'Draft adoption nudge for St Mary\u2019s',
    prio: 'medium',
    source: 'manual',
    due: '24/06/2026'
  }, {
    id: 4,
    col: 'In progress',
    title: 'Prep QBR deck — Greenfield MAT',
    prio: 'medium',
    source: 'manual',
    due: '23/06/2026'
  }, {
    id: 5,
    col: 'In progress',
    title: 'Review Q3 renewal forecast',
    prio: 'low',
    source: 'email',
    due: '25/06/2026'
  }, {
    id: 6,
    col: 'Waiting on customer',
    title: 'Awaiting signed DPA — Oakwood',
    prio: 'medium',
    source: 'email',
    due: '30/06/2026'
  }, {
    id: 7,
    col: 'Done',
    title: 'Onboarding check-in — Archbishop Ilsley',
    prio: 'low',
    source: 'playbook',
    due: '12/06/2026'
  }];
  const PRIO = {
    high: 'critical',
    medium: 'warn',
    low: 'neutral'
  };
  function TaskCard({
    t,
    onMove
  }) {
    const [hover, setHover] = React.useState(false);
    return React.createElement('div', {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      style: {
        background: '#fff',
        border: '1px solid var(--tes-n-200)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px',
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'all .14s'
      }
    }, React.createElement('div', {
      style: {
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--tes-ink)',
        lineHeight: 1.4
      }
    }, t.title), React.createElement('div', {
      style: {
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap',
        margin: '10px 0'
      }
    }, React.createElement(Badge, {
      tone: PRIO[t.prio]
    }, t.prio), React.createElement(Badge, {
      tone: 'neutral'
    }, t.source)), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '12px',
        color: t.overdue ? 'var(--status-critical)' : 'var(--tes-n-500)',
        fontWeight: t.overdue ? 700 : 400
      }
    }, (t.overdue ? 'Overdue · ' : 'Due ') + t.due), React.createElement('div', {
      style: {
        width: '108px'
      }
    }, React.createElement(Select, {
      value: t.col,
      onChange: e => onMove(t.id, e.target.value),
      options: COLUMNS,
      style: {
        padding: '5px 26px 5px 9px',
        fontSize: '12px'
      }
    }))));
  }
  function TasksScreen() {
    const [tasks, setTasks] = React.useState(SEED);
    const [prio, setPrio] = React.useState('all');
    const [mine, setMine] = React.useState(false);
    const move = (id, col) => setTasks(s => s.map(t => t.id === id ? {
      ...t,
      col,
      overdue: col === 'Done' ? false : t.overdue
    } : t));
    const shown = tasks.filter(t => prio === 'all' || t.prio === prio);
    return React.createElement('div', {
      style: {
        maxWidth: '1240px',
        width: '100%',
        margin: '0 auto',
        padding: '32px 36px 72px'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: '20px'
      }
    }, React.createElement('div', null, React.createElement('h2', {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '26px',
        color: 'var(--tes-ink)',
        margin: 0,
        letterSpacing: '-.02em'
      }
    }, 'Tasks'), React.createElement('p', {
      style: {
        margin: '5px 0 0',
        fontSize: '14px',
        color: 'var(--tes-n-500)'
      }
    }, 'Customer-success work across your accounts.')), React.createElement('label', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--tes-slate)',
        cursor: 'pointer'
      }
    }, React.createElement('input', {
      type: 'checkbox',
      checked: mine,
      onChange: () => setMine(v => !v)
    }), 'Mine only')), React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        gap: '16px',
        marginBottom: '20px'
      }
    }, React.createElement(KpiCard, {
      label: 'Created (30d)',
      value: '24',
      accent: '#2B7DC4'
    }), React.createElement(KpiCard, {
      label: 'Completed',
      value: '11',
      accent: '#5FB573'
    }), React.createElement(KpiCard, {
      label: 'Overdue now',
      value: '1',
      accent: '#C9275E',
      trend: {
        dir: 'up',
        value: '1',
        tone: 'critical'
      }
    }), React.createElement(KpiCard, {
      label: 'Avg completion',
      value: '2.4',
      unit: 'days',
      accent: '#3FB6A8'
    })), React.createElement('div', {
      style: {
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        marginBottom: '22px',
        alignItems: 'center'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '11.5px',
        fontWeight: 700,
        letterSpacing: '.05em',
        textTransform: 'uppercase',
        color: 'var(--tes-n-500)',
        marginRight: '4px'
      }
    }, 'Priority'), ['all', 'low', 'medium', 'high'].map(p => React.createElement(Chip, {
      key: p,
      active: prio === p,
      onClick: () => setPrio(p)
    }, p))), React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4,1fr)',
        gap: '16px',
        alignItems: 'start'
      }
    }, COLUMNS.map(col => {
      const items = shown.filter(t => t.col === col);
      return React.createElement('div', {
        key: col
      }, React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 4px 12px'
        }
      }, React.createElement('span', {
        style: {
          fontSize: '11.5px',
          fontWeight: 700,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--tes-n-600)'
        }
      }, col), React.createElement('span', {
        style: {
          fontSize: '11.5px',
          fontWeight: 700,
          color: 'var(--tes-n-400)'
        }
      }, items.length)), React.createElement('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: 'var(--tes-n-50)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px',
          minHeight: '120px'
        }
      }, items.length ? items.map(t => React.createElement(TaskCard, {
        key: t.id,
        t,
        onMove: move
      })) : React.createElement('div', {
        style: {
          fontSize: '12.5px',
          color: 'var(--tes-n-400)',
          textAlign: 'center',
          padding: '20px 0'
        }
      }, 'Nothing here')));
    })));
  }
  window.TasksScreen = TasksScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lighthouse/TasksScreen.jsx", error: String((e && e.message) || e) }); }

__ds_ns.MosaicMark = __ds_scope.MosaicMark;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.ICON_PATHS = __ds_scope.ICON_PATHS;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.KpiCard = __ds_scope.KpiCard;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.PanelHeader = __ds_scope.PanelHeader;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Composer = __ds_scope.Composer;

__ds_ns.AppShell = __ds_scope.AppShell;

__ds_ns.Fab = __ds_scope.Fab;

__ds_ns.LIGHTHOUSE_NAV = __ds_scope.LIGHTHOUSE_NAV;

__ds_ns.Sidebar = __ds_scope.Sidebar;

__ds_ns.TopBar = __ds_scope.TopBar;

})();
