---
applyTo: "**/*.stories.*,app/routes/__stories__/**,app/components/**"
---

# Storybook & Component Extraction

Route files are thin orchestrators. Non-trivial UI belongs in `app/components/` so it can be Storybook-tested without mocking loaders/actions.

## Extraction Steps

1. Create `app/components/ComponentName.tsx` — accept data via props, not `useLoaderData()`
2. Keep `Form` from react-router — works via the `createMemoryRouter` wrapper in `.storybook/preview.tsx`
3. Export the component and its prop types
4. Update the route to import and pass loader data as props
5. Write stories — never duplicate JSX from route files inline in stories

## Story Template

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MyComponent } from '~/components/MyComponent'

const meta: Meta<typeof MyComponent> = {
  title: 'Features/MyComponent',
  component: MyComponent,
}
export default meta
type Story = StoryObj<typeof MyComponent>

export const Default: Story = {
  args: { /* mock data matching component props */ },
}
```

Stories live in `app/routes/__stories__/`.

## Test Data Conventions

- **Person names**: "Adjektiv Substantiv" (Norwegian) — e.g. "Glad Fjord", "Rask Elv"
- **NAV-idents**: Z99xxxx format — e.g. "Z990001", "Z990042"
  - Exception: NAV-ident validator tests may use various formats
