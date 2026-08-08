/* Lighthouse — Tasks (Kanban). Stat tiles, filter chip rows, four
   status columns; cards carry priority + source chips and an inline
   Move select (the accessible fallback for drag). */
(function () {
  const Icon = window.LHIcon;
  const { KpiCard, Card, Chip, Badge, Select } = window.LighthouseDesignSystem_68eba0;

  const COLUMNS = ['To do', 'In progress', 'Waiting on customer', 'Done'];
  const SEED = [
    { id: 1, col: 'To do', title: 'Renewal call — Riverside High', prio: 'high', source: 'playbook', due: '18/06/2026', overdue: true },
    { id: 2, col: 'To do', title: 'Chase SIS import ticket — Greenfield MAT', prio: 'high', source: 'ticket', due: '22/06/2026' },
    { id: 3, col: 'To do', title: 'Draft adoption nudge for St Mary\u2019s', prio: 'medium', source: 'manual', due: '24/06/2026' },
    { id: 4, col: 'In progress', title: 'Prep QBR deck — Greenfield MAT', prio: 'medium', source: 'manual', due: '23/06/2026' },
    { id: 5, col: 'In progress', title: 'Review Q3 renewal forecast', prio: 'low', source: 'email', due: '25/06/2026' },
    { id: 6, col: 'Waiting on customer', title: 'Awaiting signed DPA — Oakwood', prio: 'medium', source: 'email', due: '30/06/2026' },
    { id: 7, col: 'Done', title: 'Onboarding check-in — Archbishop Ilsley', prio: 'low', source: 'playbook', due: '12/06/2026' },
  ];
  const PRIO = { high: 'critical', medium: 'warn', low: 'neutral' };

  function TaskCard({ t, onMove }) {
    const [hover, setHover] = React.useState(false);
    return React.createElement('div', { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
      style: { background: '#fff', border: '1px solid var(--tes-n-200)', borderRadius: 'var(--radius-lg)', padding: '14px', boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-xs)', transform: hover ? 'translateY(-2px)' : 'none', transition: 'all .14s' } },
      React.createElement('div', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--tes-ink)', lineHeight: 1.4 } }, t.title),
      React.createElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '10px 0' } },
        React.createElement(Badge, { tone: PRIO[t.prio] }, t.prio),
        React.createElement(Badge, { tone: 'neutral' }, t.source)),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
        React.createElement('span', { style: { fontSize: '12px', color: t.overdue ? 'var(--status-critical)' : 'var(--tes-n-500)', fontWeight: t.overdue ? 700 : 400 } }, (t.overdue ? 'Overdue · ' : 'Due ') + t.due),
        React.createElement('div', { style: { width: '108px' } },
          React.createElement(Select, { value: t.col, onChange: (e) => onMove(t.id, e.target.value), options: COLUMNS, style: { padding: '5px 26px 5px 9px', fontSize: '12px' } })))
    );
  }

  function TasksScreen() {
    const [tasks, setTasks] = React.useState(SEED);
    const [prio, setPrio] = React.useState('all');
    const [mine, setMine] = React.useState(false);
    const move = (id, col) => setTasks(s => s.map(t => t.id === id ? { ...t, col, overdue: col === 'Done' ? false : t.overdue } : t));
    const shown = tasks.filter(t => prio === 'all' || t.prio === prio);

    return React.createElement('div', { style: { maxWidth: '1240px', width: '100%', margin: '0 auto', padding: '32px 36px 72px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '20px' } },
        React.createElement('div', null,
          React.createElement('h2', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '26px', color: 'var(--tes-ink)', margin: 0, letterSpacing: '-.02em' } }, 'Tasks'),
          React.createElement('p', { style: { margin: '5px 0 0', fontSize: '14px', color: 'var(--tes-n-500)' } }, 'Customer-success work across your accounts.')),
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--tes-slate)', cursor: 'pointer' } },
          React.createElement('input', { type: 'checkbox', checked: mine, onChange: () => setMine(v => !v) }), 'Mine only')),

      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '20px' } },
        React.createElement(KpiCard, { label: 'Created (30d)', value: '24', accent: '#2B7DC4' }),
        React.createElement(KpiCard, { label: 'Completed', value: '11', accent: '#5FB573' }),
        React.createElement(KpiCard, { label: 'Overdue now', value: '1', accent: '#C9275E', trend: { dir: 'up', value: '1', tone: 'critical' } }),
        React.createElement(KpiCard, { label: 'Avg completion', value: '2.4', unit: 'days', accent: '#3FB6A8' })),

      React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '22px', alignItems: 'center' } },
        React.createElement('span', { style: { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--tes-n-500)', marginRight: '4px' } }, 'Priority'),
        ['all', 'low', 'medium', 'high'].map(p => React.createElement(Chip, { key: p, active: prio === p, onClick: () => setPrio(p) }, p))),

      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', alignItems: 'start' } },
        COLUMNS.map(col => {
          const items = shown.filter(t => t.col === col);
          return React.createElement('div', { key: col },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px 12px' } },
              React.createElement('span', { style: { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--tes-n-600)' } }, col),
              React.createElement('span', { style: { fontSize: '11.5px', fontWeight: 700, color: 'var(--tes-n-400)' } }, items.length)),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--tes-n-50)', borderRadius: 'var(--radius-lg)', padding: '12px', minHeight: '120px' } },
              items.length ? items.map(t => React.createElement(TaskCard, { key: t.id, t, onMove: move }))
                : React.createElement('div', { style: { fontSize: '12.5px', color: 'var(--tes-n-400)', textAlign: 'center', padding: '20px 0' } }, 'Nothing here'))
          );
        })
      )
    );
  }

  window.TasksScreen = TasksScreen;
})();
