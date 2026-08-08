A native select styled to match Input — chevron affordance, blue focus ring. Used for form selects and inline kanban Move/Priority/Owner.

```jsx
<Select label="Audience" options={['All accounts','At-risk only','Multi-academy trusts']} />
<Select options={[{value:'todo',label:'To do'},{value:'doing',label:'In progress'}]} value={col} onChange={e=>move(e.target.value)} />
```

Notes:
- Pass `options` (strings or {value,label}) or `<option>` children.
- Without a `label` it's a compact inline control (kanban cards).
