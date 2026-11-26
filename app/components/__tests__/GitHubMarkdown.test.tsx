import { Window } from 'happy-dom'
import { act } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { GitHubMarkdown } from '~/components/GitHubMarkdown'

function parse(markdown: string) {
  const window = new Window()
  window.document.body.innerHTML = renderToStaticMarkup(
    <GitHubMarkdown sourceUrl="https://github.com/navikt/example/pull/42">{markdown}</GitHubMarkdown>,
  )
  return window.document
}

describe('GitHubMarkdown', () => {
  it.each([
    ['NOTE', 'Merknad fra PR-beskrivelsen'],
    ['WARNING', 'Advarsel fra PR-beskrivelsen'],
  ])('distinguishes GitHub %s notes from NDA alerts', (marker, label) => {
    const document = parse(`> [!${marker}]
> Innhold med **utheving** og [lenke](https://github.com/navikt/example).`)

    const note = document.querySelector('[role="note"]')
    expect(note?.textContent).toContain(label)
    expect(note?.textContent).not.toContain(`[!${marker}]`)
    expect(note?.querySelector('strong')?.textContent).toBe('utheving')
    expect(note?.querySelector('a')?.href).toBe('https://github.com/navikt/example')
    expect(document.querySelector('[role="alert"], [role="status"]')).toBeNull()
  })

  it('renders GitHub tables, task lists, callouts and collapsed release notes', () => {
    const document = parse(`> [!NOTE]
> Beskrivelsen er forkortet.

| Pakke | Endring |
| --- | ---: |
| [example](https://github.com/navikt/example) | \`1.0\` → \`2.0\` |

- [x] Gjennomgått
- [ ] Dokumentert

<details open>
<summary><strong>Release notes</strong></summary>

### Versjon 2.0

Forbedret tilgjengelighet.

</details>`)

    expect(document.querySelector('table th')?.textContent).toBe('Pakke')
    expect(document.querySelectorAll('table tbody tr')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('[!NOTE]')
    expect(document.body.textContent).toContain('Beskrivelsen er forkortet.')
    expect([...document.querySelectorAll('li svg title')].map((title) => title.textContent)).toEqual([
      'Fullført',
      'Ikke fullført',
    ])
    expect(document.querySelector('input')).toBeNull()
    const button = document.querySelector('button')
    expect(button?.textContent).toBe('Release notes')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('details')).toBeNull()
  })

  it('removes executable HTML, unsafe links and attacker-controlled attributes', () => {
    const document = parse(`<script>window.injected = true</script>
<style>body { display: none }</style>
<iframe src="https://example.com">Frame</iframe>
<svg><text>Untrusted SVG</text><script>window.injected = true</script></svg>
<template><script>window.injected = true</script></template>
<form action="/danger"><button>Send</button></form>
<div id="root" style="display:none" onclick="alert(1)">Trygg tekst</div>
<a href="javascript:alert(1)">Utrygg lenke</a>
<a href="data:text/html,test">Data-lenke</a>
<a href="https://github.com/navikt/example" onclick="alert(1)">Trygg lenke</a>
<img src="https://example.com/track" onerror="alert(1)" alt="Badge">

[Kodet URL](javascript&#58;alert%281%29)`)

    expect(document.querySelector('script, style, iframe, template, form, img, input')).toBeNull()
    expect(document.querySelector('[onclick], [onerror], [style], #root')).toBeNull()
    expect(document.body.textContent).not.toContain('window.injected')
    expect(document.body.textContent).not.toContain('Untrusted SVG')
    expect(document.body.textContent).toContain('Trygg tekst')
    expect(document.body.textContent).toContain('Badge')
    const links = [...document.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    expect(links[0].href).toBe('https://github.com/navikt/example')
    expect(links[0].target).toBe('_blank')
    expect(links[0].rel).toBe('noopener noreferrer')
  })

  it('keeps script examples as code and resolves relative links on GitHub', () => {
    const document = parse(`\`\`\`vue
<script>export default {}</script>
<template><div>Eksempel</div></template>
\`\`\`

[Relativ lenke](../43)
[Ugyldig lenke](http://[)`)

    expect(document.querySelector('script, template')).toBeNull()
    expect(document.querySelector('pre code')?.textContent).toContain('<script>export default {}</script>')
    expect(document.querySelector('a')?.href).toBe('https://github.com/navikt/example/43')
    expect(document.querySelectorAll('a')).toHaveLength(1)
  })

  it('hydrates sanitized HTML and opens release notes without nested interactive elements', async () => {
    const page = (
      <GitHubMarkdown>{`<details open>
<summary><a href="https://github.com">Release notes</a></summary>

\`\`\`vue
<script>export default {}</script>
\`\`\`

<p><div>Ugyldig nesting repareres</div></p>
<img src="x" onerror="alert(1)">
<table>
<caption>Oppsummering</caption>
<tbody><tr><td>Endring</td></tr></tbody>
<tfoot><tr><td>Totalt</td></tr></tfoot>
</table>
</details>`}</GitHubMarkdown>
    )
    const window = new Window()
    window.document.body.innerHTML = renderToString(page)
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', window.document)
    vi.stubGlobal('navigator', window.navigator)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { hydrateRoot } = await import('react-dom/client')
    const errors: unknown[] = []
    const root = hydrateRoot(window.document.body as unknown as HTMLElement, page, {
      onRecoverableError: (error) => errors.push(error),
    })

    try {
      await act(async () => {})
      expect(errors).toEqual([])
      const button = window.document.querySelector('button')
      expect(button?.querySelector('a')).toBeNull()
      expect(button?.getAttribute('aria-expanded')).toBe('false')
      await act(async () => button?.click())
      expect(button?.getAttribute('aria-expanded')).toBe('true')
      expect(window.document.querySelector('pre code')?.textContent).toContain('<script>export default {}</script>')
      expect(window.document.querySelector('script, img')).toBeNull()
      expect(window.document.querySelector('caption')?.textContent).toBe('Oppsummering')
      expect(window.document.querySelector('tfoot')?.textContent).toBe('Totalt')
    } finally {
      await act(async () => root.unmount())
      vi.unstubAllGlobals()
      await window.happyDOM.abort()
    }
  })
})
