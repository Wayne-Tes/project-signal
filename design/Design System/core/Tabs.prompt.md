An underline tab bar that switches content in place. Keep labels short.

```jsx
const [tab, setTab] = React.useState('overview');
<Tabs
  tabs={[{id:'overview',label:'Overview'},{id:'analytics',label:'Analytics'}]}
  value={tab}
  onChange={setTab}
/>
```

Notes:
- Active = ink text + 2px ink underline; inactive = muted. Accepts plain strings too (`tabs={['Inbox','Archive','Snoozed']}` with the string as id).
- For filtering (not view-switching) use `Chip` rows instead.
