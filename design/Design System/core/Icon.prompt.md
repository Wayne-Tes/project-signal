The Lighthouse line-icon set — thin 1.8px stroke, rounded (Lucide vocabulary). Use it for nav, panel-header tiles, buttons and inline affordances.

```jsx
<Icon name="health" />
<Icon name="bell" size={22} stroke="var(--tes-slate)" />
<Button iconLeft={<Icon name="plus" size={16} strokeWidth={2} />}>Add metric</Button>
```

Names: home, inbox, health, radar, champion, tasks, triage, playbooks, ledger, opportunities, meetings, skills, chat, reports, jobs, design, search, bell, palette, plus, arrowUp, sparkle, chevronDown, robot, trendUp, check, archive, snooze.

Notes:
- `extraPaths={[ 'M…' ]}` renders a one-off glyph not in the map.
- Stands in for the codebase's icon set; swap real glyphs in if available. No emoji.
