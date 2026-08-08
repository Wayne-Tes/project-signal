/* Lighthouse — Signal inbox. Tabs + one white card per account with
   severity-graded signal lines, each citing its source. */
(function () {
  const Icon = window.LHIcon;
  const { Tabs, Card, Button, Badge } = window.LighthouseDesignSystem_68eba0;

  const DIGESTS = [
    {
      account: 'Riverside High', date: '19 Jun, 08:00',
      groups: [
        { sev: 'critical', label: 'Critical blockers', lines: [
          ['Class Charts logins down 41% week-on-week — lowest since onboarding.', 'usage[3]'],
          ['Renewal owner has not replied to two outreach emails in 14 days.', 'crm[7]'],
        ]},
        { sev: 'warn', label: 'Engagement concerns', lines: [
          ['Behaviour-points entry concentrated in 2 of 9 departments.', 'usage[5]'],
        ]},
      ],
    },
    {
      account: 'Greenfield MAT', date: '19 Jun, 08:00',
      groups: [
        { sev: 'critical', label: 'Critical blockers', lines: [
          ['Headteacher change recorded at lead school — primary champion has left.', 'gias[1]'],
        ]},
        { sev: 'warn', label: 'Engagement concerns', lines: [
          ['Trust-wide rollout paused; 3 of 6 schools yet to activate.', 'crm[2]'],
          ['Support ticket open 9 days on SIS data import.', 'tickets[4]'],
        ]},
      ],
    },
  ];

  const SEV = { critical: { tone: 'critical', heading: 'var(--status-critical)' }, warn: { tone: 'warn', heading: 'var(--status-warn)' } };

  function InboxScreen() {
    const [tab, setTab] = React.useState('inbox');
    return React.createElement('div', { style: { maxWidth: '1240px', width: '100%', margin: '0 auto', padding: '32px 36px 72px' } },
      React.createElement('div', { style: { marginBottom: '6px' } },
        React.createElement('h2', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '26px', color: 'var(--tes-ink)', margin: 0, letterSpacing: '-.02em' } }, 'Signal inbox'),
        React.createElement('p', { style: { margin: '5px 0 0', fontSize: '14px', color: 'var(--tes-n-500)' } }, 'Severity-graded daily digests per account — every line cites its source.')),
      React.createElement('div', { style: { margin: '22px 0 24px' } },
        React.createElement(Tabs, { tabs: [{ id: 'inbox', label: 'Inbox' }, { id: 'archive', label: 'Archive' }, { id: 'snoozed', label: 'Snoozed' }], value: tab, onChange: setTab })),

      tab === 'inbox' ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        DIGESTS.map((d, i) => React.createElement(Card, { key: d.account, padding: '0', style: { animation: `lh-fadeup .5s ease ${0.04 + i * 0.08}s both` } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--tes-n-100)' } },
            React.createElement('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '17px', color: 'var(--tes-ink)' } }, d.account),
            React.createElement('span', { style: { fontSize: '12.5px', color: 'var(--tes-n-500)' } }, d.date)),
          React.createElement('div', { style: { padding: '6px 22px 18px' } },
            d.groups.map(g => React.createElement('div', { key: g.label, style: { marginTop: '14px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
                React.createElement('span', { style: { width: '8px', height: '8px', borderRadius: '999px', background: SEV[g.sev].heading } }),
                React.createElement('span', { style: { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: SEV[g.sev].heading } }, g.label)),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                g.lines.map(([line, cite], j) => React.createElement('div', { key: j, style: { display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '14px', color: 'var(--tes-n-700)', lineHeight: 1.5 } },
                  React.createElement('span', { style: { flex: '1 1 auto' } }, line),
                  React.createElement('span', { style: { flex: 'none', marginTop: '1px' } }, React.createElement(Badge, { tone: SEV[g.sev].tone }, cite))
                )))
            )),
            React.createElement('div', { style: { display: 'flex', gap: '10px', marginTop: '18px' } },
              React.createElement(Button, { variant: 'ghost', size: 'sm', iconLeft: React.createElement(Icon, { name: 'archive', size: 15 }) }, 'Archive'),
              React.createElement(Button, { variant: 'ghost', size: 'sm', iconLeft: React.createElement(Icon, { name: 'snooze', size: 15 }) }, 'Snooze'))
          )
        ))
      ) : React.createElement(Card, { style: { textAlign: 'center', padding: '56px 24px', color: 'var(--tes-n-500)', fontSize: '14px' } }, tab === 'archive' ? 'No archived digests.' : 'Nothing snoozed.')
    );
  }

  window.InboxScreen = InboxScreen;
})();
