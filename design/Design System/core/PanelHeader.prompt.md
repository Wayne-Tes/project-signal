The light section header that replaces the old navy bars — a mosaic-tinted icon tile + title/subtitle. Put it at the top of a `padding="0"` Card, body below.

```jsx
<Card padding="0">
  <PanelHeader
    tone="lime"
    icon={<HealthIcon/>}
    title="Band distribution"
    subtitle="Last computed 19/06/2026, 09:47:23"
    action={<Button variant="subtle">View all →</Button>}
  />
  <div style={{ padding: 22 }}>…body…</div>
</Card>
```

Notes:
- `tone` sets the icon-tile tint — pick the category's colour (blue=data, lime=health, magenta=risk…).
- Reserve a solid navy cap only for one genuine hero block per page, not routine panels.
