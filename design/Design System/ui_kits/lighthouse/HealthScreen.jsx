/* Lighthouse — Health. Overview/Analytics tabs, 4 band stat cards,
   band distribution panel (donut + bars), top movers + entity lookup. */
(function () {
  const Icon = window.LHIcon;
  const { Tabs, Card, PanelHeader, Button, Badge, Avatar, Input } = window.LighthouseDesignSystem_68eba0;

  const BANDS = [
    { label: 'Healthy', count: 16, pct: '53% of 30', color: '#5FB573', barW: '53%', pill: ['#3f8a52', '#eaf5ec'] },
    { label: 'Attention', count: 4, pct: '13% of 30', color: '#E8843C', barW: '13%', pill: ['#B5611F', '#fdeede'] },
    { label: 'Critical', count: 1, pct: '3% of 30', color: '#C9275E', barW: '4%', pill: ['#C9275E', '#fbe7ee'] },
    { label: 'Unscored', count: 9, pct: '30% of 30', color: '#aeb3bf', barW: '30%', pill: ['#5b616e', '#f1f2f4'] },
  ];

  function HealthScreen() {
    const [tab, setTab] = React.useState('overview');
    const [lookup, setLookup] = React.useState('');
    const [result, setResult] = React.useState(null);
    const doLookup = () => {
      const name = (lookup || '').trim() || 'Riverside High';
      setResult({ initial: name[0].toUpperCase(), name, meta: 'Secondary · State · last computed 09:47', score: 38, band: 'Critical' });
    };

    return React.createElement('div', { style: { maxWidth: '1240px', width: '100%', margin: '0 auto', padding: '32px 36px 72px' } },
      React.createElement('div', { style: { marginBottom: '28px' } },
        React.createElement(Tabs, { tabs: [{ id: 'overview', label: 'Overview' }, { id: 'analytics', label: 'Analytics' }], value: tab, onChange: setTab })),

      tab === 'overview' ? React.createElement(React.Fragment, null,
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px' } },
          BANDS.map((b, i) => React.createElement(Card, { key: b.label, accent: b.color, padding: '20px', style: { animation: `lh-fadeup .5s ease ${0.04 + i * 0.06}s both` } },
            React.createElement('div', { style: { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--tes-n-500)' } }, b.label),
            React.createElement('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '46px', lineHeight: 1, color: 'var(--tes-ink)', margin: '14px 0' } }, b.count),
            React.createElement('span', { style: { fontSize: '12px', fontWeight: 700, color: b.pill[0], background: b.pill[1], padding: '4px 10px', borderRadius: '999px', display: 'inline-block' } }, b.pct)
          ))
        ),

        React.createElement(Card, { padding: '0', style: { marginTop: '16px', animation: 'lh-fadeup .5s ease .24s both' } },
          React.createElement(PanelHeader, { tone: 'lime', icon: React.createElement(Icon, { name: 'health', size: 20, strokeWidth: 1.9 }), title: 'Band distribution', subtitle: 'Last computed 19/06/2026, 09:47:23' }),
          React.createElement('div', { style: { display: 'flex', gap: '40px', alignItems: 'center', padding: '26px 24px' } },
            React.createElement('div', { style: { position: 'relative', width: '150px', height: '150px', flex: 'none' } },
              React.createElement('svg', { width: 150, height: 150, viewBox: '0 0 120 120' },
                React.createElement('circle', { cx: 60, cy: 60, r: 50, fill: 'none', stroke: '#eef0f3', strokeWidth: 13 }),
                React.createElement('circle', { cx: 60, cy: 60, r: 50, fill: 'none', stroke: '#5FB573', strokeWidth: 13, strokeLinecap: 'round', transform: 'rotate(-90 60 60)', strokeDasharray: '314.2', strokeDashoffset: 148 })),
              React.createElement('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
                React.createElement('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '30px', color: 'var(--tes-ink)', lineHeight: 1 } }, '53%'),
                React.createElement('span', { style: { fontSize: '11.5px', color: 'var(--tes-n-500)', marginTop: '2px' } }, 'healthy'))
            ),
            React.createElement('div', { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '16px' } },
              BANDS.map(b => React.createElement('div', { key: b.label },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
                  React.createElement('span', { style: { fontSize: '13.5px', fontWeight: 600, color: 'var(--tes-n-700)' } }, b.label),
                  React.createElement('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', color: 'var(--tes-ink)' } }, b.count)),
                React.createElement('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--tes-n-100)', overflow: 'hidden' } },
                  React.createElement('div', { style: { height: '100%', borderRadius: '999px', background: b.color, width: b.barW, transformOrigin: 'left', animation: 'lh-growbar .9s ease .3s both' } }))
              ))
            )
          )
        ),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', marginTop: '16px' } },
          React.createElement(Card, { padding: '0', style: { animation: 'lh-fadeup .5s ease .30s both' } },
            React.createElement(PanelHeader, { tone: 'blue', icon: React.createElement(Icon, { name: 'trendUp', size: 20, strokeWidth: 1.9 }), title: 'Top movers', subtitle: 'Band transitions since the last compute' }),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '44px 24px', gap: '12px' } },
              React.createElement('div', { style: { width: '64px', height: '64px', borderRadius: '18px', background: 'linear-gradient(135deg,var(--tes-n-100),#fff)', border: '1px solid var(--tes-n-200)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
                React.createElement(Icon, { name: 'trendUp', size: 26, stroke: 'var(--tes-n-400)', strokeWidth: 1.7 })),
              React.createElement('p', { style: { margin: 0, fontSize: '14px', color: 'var(--tes-n-500)', maxWidth: '320px' } }, 'Transitions appear after the second daily compute — no history yet.'))
          ),
          React.createElement(Card, { padding: '0', style: { animation: 'lh-fadeup .5s ease .36s both' } },
            React.createElement(PanelHeader, { tone: 'purple', icon: React.createElement(Icon, { name: 'search', size: 20, strokeWidth: 1.9 }), title: 'Entity Health Lookup', subtitle: 'Score & band for any account' }),
            React.createElement('div', { style: { padding: '20px 22px' } },
              React.createElement('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } },
                React.createElement('div', { style: { flex: '1 1 auto' } },
                  React.createElement(Input, { value: lookup, onChange: (e) => setLookup(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') doLookup(); }, placeholder: 'Entity name or ObjectId…' })),
                React.createElement(Button, { onClick: doLookup }, 'Look up')),
              result ? React.createElement('div', { style: { marginTop: '16px', border: '1px solid var(--tes-n-200)', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'center', gap: '14px', animation: 'lh-fadeup .3s ease both' } },
                React.createElement(Avatar, { initial: result.initial, gradient: 'linear-gradient(135deg,#C9275E,#E8843C)', size: 44 }),
                React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
                  React.createElement('div', { style: { fontSize: '14.5px', fontWeight: 700, color: 'var(--tes-ink)' } }, result.name),
                  React.createElement('div', { style: { fontSize: '12.5px', color: 'var(--tes-n-500)', marginTop: '1px' } }, result.meta)),
                React.createElement('div', { style: { textAlign: 'right' } },
                  React.createElement('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '26px', color: 'var(--tes-ink)', lineHeight: 1, marginBottom: '4px' } }, result.score),
                  React.createElement(Badge, { tone: 'critical' }, result.band))
              ) : null)
          )
        )
      ) : React.createElement(Card, { padding: '0', style: { animation: 'lh-fadeup .4s ease both' } },
        React.createElement(PanelHeader, { tone: 'blue', icon: React.createElement(Icon, { name: 'reports', size: 20, strokeWidth: 1.9 }), title: 'Healthy accounts over time', subtitle: 'Rolling 12-week trend · % of portfolio in the healthy band' }),
        React.createElement('div', { style: { padding: '24px' } },
          React.createElement('svg', { width: '100%', height: 240, viewBox: '0 0 900 240', preserveAspectRatio: 'none', style: { display: 'block' } },
            [40, 100, 160, 220].map(y => React.createElement('line', { key: y, x1: 0, y1: y, x2: 900, y2: y, stroke: '#eef0f3', strokeWidth: 1 })),
            React.createElement('defs', null, React.createElement('linearGradient', { id: 'lh-ar', x1: 0, y1: 0, x2: 0, y2: 1 },
              React.createElement('stop', { offset: 0, stopColor: '#5FB573', stopOpacity: 0.18 }), React.createElement('stop', { offset: 1, stopColor: '#5FB573', stopOpacity: 0 }))),
            React.createElement('path', { d: 'M0 170 L82 158 L164 162 L246 140 L328 132 L410 138 L492 118 L574 112 L656 120 L738 98 L820 92 L900 84 L900 240 L0 240 Z', fill: 'url(#lh-ar)' }),
            React.createElement('path', { d: 'M0 170 L82 158 L164 162 L246 140 L328 132 L410 138 L492 118 L574 112 L656 120 L738 98 L820 92 L900 84', fill: 'none', stroke: '#5FB573', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' })
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '11.5px', color: 'var(--tes-n-400)' } },
            ['12w ago', '9w', '6w', '3w', 'Now'].map(l => React.createElement('span', { key: l }, l)))
        )
      )
    );
  }

  window.HealthScreen = HealthScreen;
})();
