A centred empty / not-yet state — floating icon tile, Poppins title, muted line, optional action. Keep copy honest and specific.

```jsx
<EmptyState
  icon={<CalendarIcon/>}
  title="No meetings in your scope"
  description="Calendar meetings linked to your accounts will appear here once synced."
  action={<Button>Connect calendar</Button>}
/>
```

Notes:
- Use for genuine empties ("no history yet"), not as a placeholder for unbuilt features.
- The icon tile gently floats; respect reduced-motion in production.
