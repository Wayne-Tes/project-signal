The Lighthouse text field — label above, hairline border, blue focus ring, inline magenta error.

```jsx
<Input label="Name" placeholder="Campaign name" />
<Input label="Template prompt" as="textarea" hint="Draft is reviewed before send." />
<Input label="Subject reference" error="This account does not exist." />
```

Notes:
- Pairs with `Select` in form groups; group labels above are uppercase eyebrow style.
- `error` replaces `hint` and turns the border magenta.
