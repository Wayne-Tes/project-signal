The glassy sticky top bar — page title, ⌘K search, Appearance popover (sidebar Light/Navy + accent), notification bell, user/scope pill. `AppShell` owns the appearance state and passes the handlers in.

```jsx
<TopBar title="Health" navy={navy} accent={accent} onSidebar={setSidebar} onAccent={setAccent} />
```
