import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { MosaicMark } from '../brand/MosaicMark.jsx';

/**
 * Composer — the "Ask Lighthouse" hero element. A mosaic-gradient-
 * bordered input with a navy send button, suggestion chips, and a
 * streamed response card (blinking caret + follow-up chips). Pass
 * `answer(query) => string` to drive the canned/streamed reply; wire
 * `onSubmit` to a real endpoint in production.
 */
function SuggestionChip({ label, icon, onClick }) {
  const [h, setH] = React.useState(false);
  return React.createElement('button', { onClick, onMouseEnter: () => setH(true), onMouseLeave: () => setH(false),
    style: { display: 'inline-flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--font-body)', fontSize: '13.5px', fontWeight: 600, color: h ? 'var(--tes-blue)' : 'var(--tes-slate)', background: '#fff', border: '1px solid ' + (h ? 'var(--tes-blue)' : 'var(--tes-n-200)'), borderRadius: '999px', padding: '9px 15px', cursor: 'pointer', transform: h ? 'translateY(-1px)' : 'none', boxShadow: h ? '0 4px 12px rgba(43,125,196,.12)' : 'none', transition: 'all .14s' } },
    icon ? React.createElement(Icon, { name: icon, size: 14, strokeWidth: 1.9 }) : null, label);
}

export function Composer({
  placeholder = 'Ask Lighthouse… (@ to mention an account)',
  suggestions = [],
  followups = ['Open a retention playbook', 'Show at-risk accounts', 'Export to CSV'],
  answer,
  onSubmit,
  userInitial = 'D',
  style,
}) {
  const [query, setQuery] = React.useState('');
  const [sent, setSent] = React.useState(null);
  const [streamed, setStreamed] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const ivRef = React.useRef(null);
  React.useEffect(() => () => clearInterval(ivRef.current), []);

  const run = (q) => {
    const text = (q || '').trim(); if (!text) return;
    if (onSubmit) onSubmit(text);
    const ans = (answer ? answer(text) : 'Here is what I found across your portfolio. (Wire `answer` or `onSubmit` to your assistant endpoint.)');
    clearInterval(ivRef.current);
    setSent(text); setStreaming(true); setStreamed(''); setQuery('');
    let i = 0;
    ivRef.current = setInterval(() => {
      i += 2;
      if (i >= ans.length) { clearInterval(ivRef.current); setStreamed(ans); setStreaming(false); }
      else setStreamed(ans.slice(0, i));
    }, 14);
  };

  return React.createElement('div', { style: { maxWidth: '780px', margin: '0 auto', ...style } },
    React.createElement('div', { style: { padding: '1.5px', borderRadius: '20px', background: 'linear-gradient(120deg,#6B4E9E,#2B7DC4,#3FB6A8,#9FCB3B,#E8843C,#C9275E)', boxShadow: '0 14px 40px rgba(34,38,51,.12)' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', background: '#fff', borderRadius: '18.5px', padding: '14px 14px 14px 22px' } },
        React.createElement(Icon, { name: 'sparkle', size: 22, stroke: 'var(--tes-blue)', strokeWidth: 1.7 }),
        React.createElement('input', { value: query, onChange: (e) => setQuery(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') run(query); }, placeholder, style: { flex: '1 1 auto', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: '17px', color: 'var(--tes-ink)' } }),
        React.createElement('button', { onClick: () => run(query), 'aria-label': 'Send', style: { flex: 'none', width: '46px', height: '46px', borderRadius: '13px', border: 'none', cursor: 'pointer', background: 'var(--tes-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
          React.createElement(Icon, { name: 'arrowUp', size: 20, stroke: '#fff', strokeWidth: 2 }))
      )
    ),
    suggestions.length ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '16px' } },
      suggestions.map(s => React.createElement(SuggestionChip, { key: s.label, label: s.label, icon: s.icon, onClick: () => run(s.label) }))
    ) : null,
    sent ? React.createElement('div', { style: { marginTop: '20px', background: '#fff', border: '1px solid var(--tes-n-200)', borderRadius: '16px', boxShadow: '0 8px 26px rgba(34,38,51,.08)', overflow: 'hidden', textAlign: 'left', animation: 'lh-fadeup .35s ease both' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '13px 20px', borderBottom: '1px solid var(--tes-n-100)', background: 'var(--tes-n-50)' } },
        React.createElement(Avatar, { initial: userInitial, size: 24, radius: 7 }),
        React.createElement('span', { style: { fontSize: '14.5px', fontWeight: 600, color: 'var(--tes-ink)' } }, sent)
      ),
      React.createElement('div', { style: { display: 'flex', gap: '13px', padding: '18px 20px' } },
        React.createElement(MosaicMark, { size: 26, radius: 5 }),
        React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, color: 'var(--tes-lime-deep)', letterSpacing: '.02em', marginBottom: '6px' } }, 'LIGHTHOUSE'),
          React.createElement('p', { style: { margin: 0, fontSize: '15px', lineHeight: 1.62, color: 'var(--tes-n-700)', textWrap: 'pretty' } }, streamed,
            streaming ? React.createElement('span', { style: { display: 'inline-block', width: '8px', height: '17px', background: 'var(--tes-blue)', marginLeft: '2px', verticalAlign: '-2px', animation: 'lh-blink 1s steps(1) infinite' } }) : null),
          (!streaming && followups.length) ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' } },
            followups.map(f => React.createElement('button', { key: f, onClick: () => run(f), style: { fontFamily: 'var(--font-body)', fontSize: '12.5px', fontWeight: 600, color: 'var(--tes-slate)', background: 'var(--tes-n-100)', border: 'none', borderRadius: '8px', padding: '7px 12px', cursor: 'pointer' } }, f))
          ) : null
        )
      )
    ) : null
  );
}
