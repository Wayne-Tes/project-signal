A small tinted pill for status and severity — pair it with a word/glyph, never colour alone.

```jsx
<Badge tone="positive">Active</Badge>
<Badge tone="critical">high</Badge>
<Badge tone="warn">review</Badge>
<Badge mosaic="#6B4E9E">head-change</Badge>   {/* categorical */}
```

Tone map: positive (Won/sent/active), info (Open/scope), warn (watch/medium), critical (high/failed/overdue), neutral (standard/manual), teal (adoption). For category chips (event types, sources) pass `mosaic` with the category's hue.
