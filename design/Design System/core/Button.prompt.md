Buttons for every Lighthouse action — use `primary` (navy) for the main action on a page/form, `ghost` for secondary actions, `danger` for destructive ones (erase, revoke), `subtle` for inline text links ("View all →").

```jsx
<Button onClick={save}>Create campaign</Button>
<Button variant="ghost" iconLeft={<PlusIcon/>}>Add metric</Button>
<Button variant="danger">Request erasure</Button>
<Button variant="subtle" iconRight={<span>→</span>}>View all</Button>
```

Notes:
- `size="sm"` for dense rows/tables; default `md` elsewhere.
- Hover brightens/darkens + lifts 1px (primary/danger). Focus shows the blue ring.
- One primary per view; don't stack multiple navy buttons side by side.
