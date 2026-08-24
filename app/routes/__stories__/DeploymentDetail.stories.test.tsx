import { composeStories, setProjectAnnotations } from '@storybook/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import preview from '../../../.storybook/preview'
import * as stories from './DeploymentDetail.stories'

setProjectAnnotations(preview)

const { Approved, DirectPush, ManuallyApproved, MoveBaseline, NotApproved, Pending } = composeStories(stories)

describe('DeploymentDetail story baseline characterization', () => {
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

  it('MoveBaseline story shows the move-baseline action for tech leads', () => {
    const html = renderToStaticMarkup(<MoveBaseline />)

    expect(html).toContain('Flytt baseline hit')
    expect(html).toContain('Foreslått baseline')
  })

  it('Approved story does not offer the move-baseline action without eligibility', () => {
    const html = renderToStaticMarkup(<Approved />)

    expect(html).not.toContain('Flytt baseline hit')
  })
})
