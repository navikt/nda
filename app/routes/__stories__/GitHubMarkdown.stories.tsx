import type { Meta, StoryObj } from '@storybook/react'
import { GitHubMarkdown } from '~/components/GitHubMarkdown'

const meta: Meta<typeof GitHubMarkdown> = {
  title: 'Components/GitHubMarkdown',
  component: GitHubMarkdown,
  parameters: { router: { skip: true } },
}

export default meta

type Story = StoryObj<typeof meta>

export const Renovate: Story = {
  args: {
    sourceUrl: 'https://github.com/navikt/example/pull/42',
    children: `> [!NOTE]
> Beskrivelsen er forkortet.

Denne PR-en inneholder følgende oppdateringer:

| Pakke | Endring |
| --- | --- |
| [@example/ui](https://github.com/navikt/example) | \`1.0.0\` → \`1.1.0\` |

---

### Release notes

<details>
<summary>@example/ui</summary>

### Versjon 1.1.0

- Forbedret tilgjengelighet.
- Rettet en feil i visningen.

\`\`\`vue
<template>
  <div>Eksempel</div>
</template>
<script>
  export default {}
</script>
\`\`\`

</details>`,
  },
}

export const TaskList: Story = {
  args: {
    children: `## Endringer

- [x] Oppdatert dokumentasjon
- [ ] Gjennomgang

Se [veiledningen](https://github.com/navikt/example).

> Dette er et vanlig sitat.

### Nummerert liste

3. Første punkt
4. Andre punkt`,
  },
}
