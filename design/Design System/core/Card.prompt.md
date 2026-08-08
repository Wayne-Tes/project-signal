The base white surface for Lighthouse content — hairline border, soft shadow, 14px radius.

```jsx
<Card>Static content</Card>
<Card interactive>Clickable card — lifts on hover</Card>
<Card accent="var(--band-critical)">Card with a 3px top accent bar</Card>
```

Notes:
- `interactive` adds the hover lift; use it for clickable cards only.
- `accent` paints the 3px top bar (KPI/band cards use a mosaic hue).
- Compose `PanelHeader` inside a `padding="0"` card for section panels.
