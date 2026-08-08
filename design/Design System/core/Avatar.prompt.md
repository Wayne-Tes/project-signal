A rounded-square gradient avatar with initials — use for users, accounts and the assistant.

```jsx
<Avatar name="dev-admin" />
<Avatar initial="R" gradient="linear-gradient(135deg,#C9275E,#E8843C)" />  {/* at-risk */}
<Avatar name="Greenfield MAT" size={44} />
```

Notes:
- Default gradient is the Tes blue→purple; use mosaic pairings to signal category/risk.
- For the brand/assistant identity itself, use `MosaicMark`, not Avatar.
