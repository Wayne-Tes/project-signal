The Lighthouse brand mark — a 3×3 grid of rounded mosaic squares in the eight brand hues; use it in the sidebar brand lockup and as the assistant avatar.

```jsx
<MosaicMark size={32} />
<MosaicMark size={26} radius={5} />   {/* assistant avatar, tighter corners */}
```

Notes:
- Colours are fixed (the brand mosaic) and not themeable — that is intentional.
- `size` scales everything; `gap` and `radius` auto-derive but can be overridden.
- Recreated from screenshots — swap for the official Tes vector when available.
