import { composeStories, setProjectAnnotations } from '@storybook/react'
import { Window } from 'happy-dom'
import { act } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DeploymentDetailLoaderData } from '~/components/DeploymentDetailPage'
import preview from '../../../.storybook/preview'
import * as stories from './DeploymentDetail.stories'

setProjectAnnotations(preview)

const { Approved, DirectPush, ManuallyApproved, NotApproved, Pending, VerifiedViaSibling } = composeStories(stories)

describe('DeploymentDetail story baseline characterization', () => {
  it.each([
    '## Release notes\n\n```vue\n<template><div v-html="html"></div></template>\n<script>export default {}</script>\n```',
    '</p></div><script src="https://example.com/injected.js"></script><img src="x" onerror="alert(1)"><iframe src="https://example.com"></iframe><style>body{display:none}</style>',
  ])('renders GitHub PR Markdown without adding active HTML', (body) => {
    const loaderData = Approved.args.loaderData
    if (!loaderData) throw new Error('Approved story must include loader data')
    const githubPrData = loaderData.deployment.github_pr_data
    if (!githubPrData) throw new Error('Approved story must include PR data')
    const html = renderToStaticMarkup(
      <Approved
        loaderData={{
          ...loaderData,
          deployment: {
            ...loaderData.deployment,
            github_pr_data: { ...githubPrData, body } as NonNullable<
              DeploymentDetailLoaderData['deployment']['github_pr_data']
            >,
          },
        }}
      />,
    )
    const window = new Window()
    const document = window.document
    document.body.innerHTML = html

    expect(document.querySelector('script, template, iframe, style, img[onerror]')).toBeNull()
    if (body.startsWith('## Release notes')) {
      expect(document.querySelector('pre code')?.textContent).toContain('<script>export default {}</script>')
    }
    expect(document.body.textContent).toContain('Filer endret')
  })

  it('hydrates release-note code examples without errors and keeps controls interactive', async () => {
    const loaderData = Approved.args.loaderData
    if (!loaderData) throw new Error('Approved story must include loader data')
    const githubPrData = loaderData.deployment.github_pr_data
    if (!githubPrData) throw new Error('Approved story must include PR data')
    const page = (
      <Approved
        loaderData={{
          ...loaderData,
          deployment: {
            ...loaderData.deployment,
            github_pr_data: {
              ...githubPrData,
              body: '```vue\n<template><div>Example</div></template>\n<script>export default {}</script>\n```',
            } as NonNullable<DeploymentDetailLoaderData['deployment']['github_pr_data']>,
          },
        }}
      />
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
      const button = [...window.document.querySelectorAll('button')].find((element) =>
        element.textContent.includes('GitHub Checks'),
      )
      expect(button?.getAttribute('aria-expanded')).toBe('false')
      await act(async () => button?.click())
      expect(button?.getAttribute('aria-expanded')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      vi.unstubAllGlobals()
      await window.happyDOM.abort()
    }
  })

  it('Approved story keeps deployment summary and PR details', () => {
    const html = renderToStaticMarkup(<Approved />)

    expect(html).toContain('feat: Add new feature for pension calculation')
    expect(html).toContain('Godkjent')
    expect(html).toContain('Glad Fjord')
    expect(html).toContain('navikt/pensjon-pen')
    expect(html).toContain('#42')
    expect(html).toContain('GitHub Checks')
    expect(html).toContain('Godkjent av')
    expect(html).toContain('Kubernetes Resources')
  })

  it('NotApproved story keeps real non-approved warnings and follow-up actions', () => {
    const html = renderToStaticMarkup(<NotApproved />)

    expect(html).toContain('Ikke-godkjente commits')
    expect(html).toContain('Send Slack-varsel')
    expect(html).toContain('Registrer avvik')
    expect(html).toContain('Legg til kommentar')
    expect(html).toContain('Verifiser')
  })

  it('Pending story keeps pending label without status history section', () => {
    const html = renderToStaticMarkup(<Pending />)

    expect(html).toContain('Venter på verifisering')
    expect(html).toContain('Verifiser nå')
    expect(html).not.toContain('Statushistorikk')
  })

  it('DirectPush story keeps no-PR behavior from the real component', () => {
    const html = renderToStaticMarkup(<DirectPush />)

    expect(html).toContain('Direct Push')
    expect(html).toContain('Krever manuell godkjenning')
    expect(html).toContain('Se endringer på GitHub')
    expect(html).not.toContain('Pull Request</')
    expect(html).not.toContain('GitHub Checks')
  })

  it('ManuallyApproved story keeps manual approval alert visible', () => {
    const html = renderToStaticMarkup(<ManuallyApproved />)

    expect(html).toContain('Manuelt godkjent')
    expect(html).toContain('Gjennomgått i Slack med Rask Elv.')
    expect(html).toContain('Se Slack-dokumentasjon')
    expect(html).not.toContain('Krever manuell godkjenning')
  })

  it('VerifiedViaSibling story shows the sibling-specific label, not the generic "Godkjent" tag', () => {
    const html = renderToStaticMarkup(<VerifiedViaSibling />)

    expect(html).toContain('Verifisert via søskenapplikasjon')
    expect(html).not.toContain('>Godkjent<')
  })
})
