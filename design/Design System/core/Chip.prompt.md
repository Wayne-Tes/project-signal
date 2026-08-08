A toggle pill for filter rows — Tasks, Triage, Sector radar, Opportunities. Start each row with an "All" chip active.

```jsx
<Chip active>All</Chip>
<Chip onClick={() => setPrio('high')}>high</Chip>
<Chip onClick={() => setPrio('medium')}>medium</Chip>
```

Notes:
- Active = blue tint (`--tes-blue-100`) + blue text + blue border; inactive = `--tes-n-100` + muted text; hover gains a blue border.
- For non-toggle category labels (event types, sources), use `Badge mosaic=…` instead.
