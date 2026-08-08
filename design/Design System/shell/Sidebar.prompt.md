The app sidebar — mosaic brand lockup, grouped nav (lime active accent + count badges), user row. Usually rendered for you by `AppShell`; use directly only for a custom shell.

```jsx
<Sidebar nav={LIGHTHOUSE_NAV} active="Home" onNav={setRoute} accent="#9FCB3B" />
```

Notes:
- `navy` switches to the dark variant; `accent` drives the active highlight + 3px bar + icon.
- Provide your own `nav` ({ workspace, admin }) to reuse for another product.
