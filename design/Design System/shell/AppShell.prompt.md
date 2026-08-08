The complete Lighthouse chrome in one component — sidebar + glassy top bar + assistant FAB. Wrap any route's content as children.

```jsx
const [route, setRoute] = React.useState('Home');
<AppShell active={route} onNav={setRoute}>
  <YourScreen />
</AppShell>
```

Notes:
- Appearance (sidebar Light/Navy + accent) persists to localStorage and applies app-wide — built in. Pass `persistAppearance={false}` to opt out.
- Pass `nav` to reuse the shell for a different product; defaults to `LIGHTHOUSE_NAV`.
- Content should be a `max-width:1240px` centred wrapper with `40px 36px 72px` padding (see PageHeader + the UI kit screens).
