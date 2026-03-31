# Storybook for deployment-audit

## Motivasjon

Storybook gir oss et isolert miljø for å utvikle og dokumentere UI-komponenter uavhengig av backend-logikk og routing. Dette er spesielt nyttig for:

- **Visuell dokumentasjon** av komponentvarianter og states
- **Utvikling av nye komponenter** uten å navigere i appen
- **Tilgjengelighetssjekking** av komponenter
- **Tema-testing** (dark/light mode) på isolerte komponenter

## Kjøring

```bash
pnpm run storybook
```

Åpner på http://localhost:6006

## Teknisk oppsett

### React Router Vite plugin konflikt

React Router sin Vite plugin krever en Vite config-fil, men Storybook håndterer sin egen Vite-konfigurasjon. Løsningen er å lage en separat Vite-config for Storybook som bruker `@vitejs/plugin-react` direkte i stedet for React Router sitt oppsett.

- `.storybook/vite.config.ts` - Separat Vite config uten React Router plugin
- `.storybook/main.ts` - Peker til denne via `core.builder.options.viteConfigPath`

### Aksel Design System

Preview-filen (`preview.tsx`) setter opp:
- Import av Aksel CSS (`@navikt/ds-css`)
- `Theme`-dekorator fra Aksel som wrapper alle stories
- Tema-velger i Storybook toolbar for å bytte mellom light/dark

## Filstruktur for stories

Stories bør ligge ved siden av komponentene:

```
app/components/
├── MyComponent.tsx
├── MyComponent.stories.tsx    # Stories for komponenten
```

Eller i en dedikert mappe:

```
app/components/__stories__/
├── Examples.stories.tsx       # Sammensatte eksempler
```

## Eksempel på story

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Tag } from "@navikt/ds-react";

const meta: Meta<typeof Tag> = {
  title: "Components/StatusTag",
  component: Tag,
};

export default meta;
type Story = StoryObj<typeof Tag>;

export const Approved: Story = {
  render: () => <Tag variant="success">Godkjent</Tag>,
};

export const NotApproved: Story = {
  render: () => <Tag variant="error">Ikke godkjent</Tag>,
};
```

## Fremtidige planer

- [ ] Legg til stories for alle gjenbrukbare komponenter
- [ ] Dokumenter komponent-props med autodocs
- [ ] Vurder Chromatic for visuell regresjonstesting
