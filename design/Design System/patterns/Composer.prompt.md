The "Ask Lighthouse" composer — the hero element on Home and Chat. Mosaic-gradient border, navy send button, suggestion chips, and a streamed response card.

```jsx
<Composer
  suggestions={[
    { label: 'Show at-risk accounts', icon: 'triage' },
    { label: 'How do I create a playbook?', icon: 'playbooks' },
  ]}
  answer={(q) => myCannedAnswer(q)}
  onSubmit={(q) => analytics.track('ask', q)}
/>
```

Notes:
- Provide `answer(query)` for a canned/streamed demo reply, or wire `onSubmit` to the real assistant endpoint.
- On Chat, pin it to the bottom with suggestions centred above.
