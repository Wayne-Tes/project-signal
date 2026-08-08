The admin list table — uppercase header row, hairline-separated rows, hover wash. Compose status cells with `Badge`, IDs in monospace.

```jsx
<DataTable
  columns={[
    { key: 'upn', header: 'UPN', mono: true },
    { key: 'name', header: 'Name' },
    { header: 'Role', render: r => <Badge tone={r.admin ? 'info' : 'neutral'}>{r.role}</Badge> },
    { header: 'Status', render: r => <Badge tone="positive">Active</Badge>, align: 'left' },
  ]}
  rows={users}
/>
```

Notes:
- Put a `DataTable` inside a `Card padding="0"` under a `PanelHeader` for a titled table panel.
- `render(row)` handles badges, links and truncated JSON; `mono` for IDs/keys/prefixes.
