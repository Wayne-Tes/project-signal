/* Lighthouse — Home. Hero greeting + "Ask Lighthouse" composer (canned
   streamed answers) + KPI bento + portfolio donut / at-risk / your-day. */
(function () {
  const Icon = window.LHIcon;
  const { KpiCard, Card, Avatar, Button, MosaicMark } = window.LighthouseDesignSystem_68eba0;

  const ANSWERS = (q) => {
    const t = (q || '').toLowerCase();
    if (t.includes('platform') || t.includes('what is'))
      return 'Lighthouse is your customer-success command centre for Tes. It unifies CRM, account health, behaviour-data signals and playbooks — so you can spot at-risk schools early and act before renewal. Everything here is scoped to your 30 accounts.';
    if (t.includes('risk'))
      return '3 accounts dropped into the critical band this week. Riverside High fell to a health score of 38 (down 12) after a 40% drop in Class Charts logins, and Greenfield MAT slipped to 52 following a leadership change. Shall I open a retention playbook for Riverside?';
    if (t.includes('playbook'))
      return 'Head to Playbooks → New. Pick a trigger (e.g. health score below 50), add your steps — an automated email, a task for the account owner, a check-in — and Lighthouse runs it across every matching account. Clone the "Renewal rescue" template to start.';
    if (t.includes('headteacher') || t.includes('changed'))
      return '4 schools recorded a headteacher change in the last 90 days: Oakwood Academy, St Mary\u2019s CofE Primary, Greenfield MAT and Archbishop Ilsley. Leadership changes are a renewal-risk signal — want me to flag all four for a check-in?';
    return 'Across your portfolio: 16 of 30 accounts are healthy, 9 are on watch and 5 are critical. The biggest mover this week is Riverside High (down 12). Ask about a specific account, or pick a suggestion to dig in.';
  };

  const SUGGESTIONS = [
    ['What is this platform?', 'triage'],
    ['Show at-risk accounts', 'triage'],
    ['How do I create a playbook?', 'playbooks'],
    ['Which schools changed headteacher recently?', 'champion'],
  ];

  function Composer() {
    return React.createElement(window.LighthouseDesignSystem_68eba0.Composer, {
      answer: ANSWERS,
      suggestions: SUGGESTIONS.map(([label, icon]) => ({ label, icon })),
      followups: ['Open a retention playbook', 'Show at-risk accounts', 'Export to CSV'],
    });
  }

  const ACCOUNTS = [
    ['R', 'Riverside High', 'Secondary · State', 38, '▼12', 'linear-gradient(135deg,#C9275E,#E8843C)', '#C9275E'],
    ['G', 'Greenfield MAT', 'Multi-academy trust', 52, '▼6', 'linear-gradient(135deg,#E8843C,#F2C13D)', '#B5611F'],
    ['S', "St Mary's CofE", 'Primary · Faith', 61, '▼3', 'linear-gradient(135deg,#6B4E9E,#2B7DC4)', '#B5611F'],
    ['O', 'Oakwood Academy', 'Secondary · Academy', 74, '▲4', 'linear-gradient(135deg,#3FB6A8,#5FB573)', '#247f76'],
  ];

  function HomeScreen() {
    const [tasks, setTasks] = React.useState([
      { id: 't1', title: 'Renewal call — Riverside High', time: '09:30', prio: 'High', done: false },
      { id: 't2', title: 'Review Q3 renewal forecast', time: '11:00', prio: 'Medium', done: false },
      { id: 't3', title: 'Prep QBR deck for Greenfield MAT', time: '14:00', prio: 'Medium', done: true },
      { id: 't4', title: "Reply to St Mary's adoption query", time: '16:30', prio: 'High', done: false },
    ]);
    const prioColor = { High: '#C9275E', Medium: '#B5611F', Low: '#247f76' };
    const prioBg = { High: '#fbe7ee', Medium: '#fdeede', Low: '#e2f4f1' };
    const left = tasks.filter(t => !t.done).length;
    const accent = '#9FCB3B';

    return React.createElement('div', { style: { maxWidth: '1240px', width: '100%', margin: '0 auto', padding: '40px 36px 72px' } },
      React.createElement('div', { style: { textAlign: 'center', margin: '18px 0 30px', animation: 'lh-fadeup .5s ease both' } },
        React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--tes-blue)', background: 'var(--tes-blue-100)', padding: '6px 13px', borderRadius: '999px', marginBottom: '20px' } },
          React.createElement('span', { style: { width: '7px', height: '7px', borderRadius: '999px', background: 'var(--tes-lime)', animation: 'lh-ringpulse 2.2s infinite' } }),
          'Tuesday 19 June · 14 accounts updated today'),
        React.createElement('h2', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '52px', lineHeight: 1.02, letterSpacing: '-.025em', color: 'var(--tes-ink)', margin: 0 } }, 'Good evening, Admin'),
        React.createElement('p', { style: { fontSize: '17px', color: 'var(--tes-n-600)', margin: '14px 0 0' } }, "Here's what's moving across your portfolio. Ask anything, or jump into a signal below.")
      ),
      React.createElement(Composer, null),

      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', margin: '54px 0 18px' } },
        React.createElement('div', null,
          React.createElement('h3', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '26px', color: 'var(--tes-ink)', margin: 0, letterSpacing: '-.02em' } }, 'Your dashboard'),
          React.createElement('p', { style: { margin: '5px 0 0', fontSize: '14px', color: 'var(--tes-n-500)' } }, 'Live signals across 30 accounts · updated 4 min ago')
        ),
        React.createElement(Button, { variant: 'ghost', iconLeft: React.createElement(Icon, { name: 'plus', size: 16, strokeWidth: 2 }) }, 'Add metric')
      ),

      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '16px' } },
        React.createElement(KpiCard, { label: 'Critical accounts', value: '1', unit: 'in critical band', accent: '#C9275E', trend: { dir: 'up', value: '1', tone: 'critical' }, spark: [0.2, 0.35, 0.3, 0.55, 0.5, 0.78, 0.92] }),
        React.createElement(KpiCard, { label: 'Portfolio health', value: React.createElement(React.Fragment, null, '16', React.createElement('span', { style: { fontSize: '24px', color: 'var(--tes-n-400)' } }, '/30')), unit: 'healthy', accent: '#5FB573', trend: { dir: 'up', value: '2', tone: 'positive' }, spark: [0.35, 0.42, 0.3, 0.5, 0.6, 0.68, 0.82] }),
        React.createElement(KpiCard, { label: 'Overdue tasks', value: '13', unit: 'past due', accent: '#E8843C', trend: { dir: 'up', value: '3', tone: 'warn' }, spark: [0.6, 0.4, 0.66, 0.36, 0.52, 0.3, 0.46] }),
        React.createElement(KpiCard, { label: 'Open triage', value: '4', unit: 'scored tickets', accent: '#2B7DC4', trend: { dir: 'down', value: '1', tone: 'info' }, spark: [0.75, 0.6, 0.66, 0.46, 0.5, 0.34, 0.3] }),
        React.createElement(KpiCard, { label: 'Adoption', value: '7,173', unit: 'req / week', accent: '#3FB6A8', trend: { dir: 'up', value: '12%', tone: 'teal' }, spark: [0.15, 0.28, 0.26, 0.48, 0.42, 0.7, 0.92] })
      ),

      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.45fr 1fr', gap: '16px', marginTop: '16px', alignItems: 'stretch' } },
        /* donut */
        React.createElement(Card, null,
          React.createElement('h4', { style: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', color: 'var(--tes-ink)', margin: '0 0 2px' } }, 'Portfolio health'),
          React.createElement('p', { style: { margin: '0 0 14px', fontSize: '12.5px', color: 'var(--tes-n-500)' } }, 'Across 30 accounts'),
          React.createElement('div', { style: { position: 'relative', width: '160px', height: '160px', margin: '4px auto 16px' } },
            React.createElement('svg', { width: 160, height: 160, viewBox: '0 0 120 120' },
              React.createElement('circle', { cx: 60, cy: 60, r: 50, fill: 'none', stroke: '#eef0f3', strokeWidth: 14 }),
              React.createElement('g', { transform: 'rotate(-90 60 60)' },
                React.createElement('circle', { cx: 60, cy: 60, r: 50, fill: 'none', stroke: '#5FB573', strokeWidth: 14, strokeLinecap: 'round', strokeDasharray: '167.5 314.2' }),
                React.createElement('circle', { cx: 60, cy: 60, r: 50, fill: 'none', stroke: '#E8843C', strokeWidth: 14, strokeLinecap: 'round', strokeDasharray: '94.2 314.2', strokeDashoffset: -171.5 }),
                React.createElement('circle', { cx: 60, cy: 60, r: 50, fill: 'none', stroke: '#C9275E', strokeWidth: 14, strokeLinecap: 'round', strokeDasharray: '52.4 314.2', strokeDashoffset: -269.7 })
              )
            ),
            React.createElement('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
              React.createElement('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '32px', color: 'var(--tes-ink)', lineHeight: 1 } }, '53', React.createElement('span', { style: { fontSize: '18px', color: 'var(--tes-n-400)' } }, '%')),
              React.createElement('span', { style: { fontSize: '11.5px', color: 'var(--tes-n-500)', marginTop: '2px' } }, 'healthy')
            )
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
            [['Healthy', '#5FB573', 16], ['Watch', '#E8843C', 9], ['Critical', '#C9275E', 5]].map(([l, c, n]) =>
              React.createElement('div', { key: l, style: { display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px' } },
                React.createElement('span', { style: { width: '9px', height: '9px', borderRadius: '3px', background: c } }),
                React.createElement('span', { style: { flex: 1, color: 'var(--tes-n-700)' } }, l),
                React.createElement('span', { style: { fontWeight: 700, color: 'var(--tes-ink)' } }, n)))
          )
        ),
        /* at-risk */
        React.createElement(Card, null,
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' } },
            React.createElement('div', null,
              React.createElement('h4', { style: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', color: 'var(--tes-ink)', margin: '0 0 2px' } }, 'Accounts needing attention'),
              React.createElement('p', { style: { margin: 0, fontSize: '12.5px', color: 'var(--tes-n-500)' } }, 'Sorted by health-score movement')),
            React.createElement(Button, { variant: 'subtle' }, 'View all →')
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
            ACCOUNTS.map(([ini, name, sector, score, trend, bg, color]) =>
              React.createElement('div', { key: name, style: { display: 'flex', alignItems: 'center', gap: '13px', padding: '12px 8px', borderRadius: '11px', cursor: 'pointer' } },
                React.createElement(Avatar, { initial: ini, gradient: bg, size: 38 }),
                React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
                  React.createElement('div', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--tes-ink)' } }, name),
                  React.createElement('div', { style: { fontSize: '12px', color: 'var(--tes-n-500)', marginTop: '1px' } }, sector)),
                React.createElement('div', { style: { width: '96px', flex: 'none' } },
                  React.createElement('div', { style: { height: '6px', borderRadius: '999px', background: 'var(--tes-n-100)', overflow: 'hidden' } },
                    React.createElement('div', { style: { height: '100%', width: score + '%', borderRadius: '999px', background: color } })),
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '5px' } },
                    React.createElement('span', { style: { fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--tes-ink)' } }, score),
                    React.createElement('span', { style: { fontSize: '11px', fontWeight: 700, color } }, trend)))
              ))
          )
        ),
        /* your day */
        React.createElement(Card, { style: { display: 'flex', flexDirection: 'column' } },
          React.createElement('div', { style: { marginBottom: '14px' } },
            React.createElement('h4', { style: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', color: 'var(--tes-ink)', margin: '0 0 2px' } }, 'Your day'),
            React.createElement('p', { style: { margin: 0, fontSize: '12.5px', color: 'var(--tes-n-500)' } }, left + ' of ' + tasks.length + ' remaining')),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 auto' } },
            tasks.map(t => React.createElement('div', { key: t.id, onClick: () => setTasks(s => s.map(x => x.id === t.id ? { ...x, done: !x.done } : x)), style: { display: 'flex', alignItems: 'flex-start', gap: '11px', padding: '10px 8px', borderRadius: '10px', cursor: 'pointer' } },
              React.createElement('div', { style: { width: '20px', height: '20px', borderRadius: '6px', flex: 'none', marginTop: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: t.done ? 'none' : '2px solid var(--tes-n-300)', background: t.done ? accent : '#fff', transition: 'all .14s' } },
                t.done ? React.createElement(Icon, { name: 'check', size: 12, stroke: '#fff', strokeWidth: 3.2 }) : null),
              React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
                React.createElement('div', { style: { fontSize: '13.5px', fontWeight: 600, color: t.done ? 'var(--tes-n-400)' : 'var(--tes-ink)', textDecoration: t.done ? 'line-through' : 'none' } }, t.title),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', marginTop: '3px' } },
                  React.createElement('span', { style: { fontSize: '11.5px', fontWeight: 600, color: 'var(--tes-n-500)' } }, t.time),
                  React.createElement('span', { style: { fontSize: '10.5px', fontWeight: 700, color: prioColor[t.prio], background: prioBg[t.prio], padding: '1px 7px', borderRadius: '999px' } }, t.prio)))
            ))
          ),
          React.createElement('button', { style: { marginTop: '12px', width: '100%', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 700, color: 'var(--tes-slate)', background: 'var(--tes-n-100)', border: 'none', borderRadius: '9px', padding: '10px', cursor: 'pointer' } }, 'Go to Tasks →')
        )
      )
    );
  }

  window.HomeScreen = HomeScreen;
})();
