The dashboard signature card: a metric figure with a coloured accent bar, trend pill and an animated sparkline. Lay several in a 4–5-up grid.

```jsx
<KpiCard
  label="Critical accounts"
  value="1"
  unit="in critical band"
  accent="var(--band-critical)"
  trend={{ dir: 'up', value: '1', tone: 'critical' }}
  spark={[0.2,0.35,0.3,0.55,0.5,0.75,0.9]}
/>
```

Suggested accent mapping: Critical→magenta, Health→green, Overdue→orange, Triage→blue, Adoption→teal. Figures stay ink (not coloured) — colour rides on the accent bar, sparkline and trend pill. `spark` is an array of 0..1 heights; omit it for a plain stat tile.
