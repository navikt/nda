import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ErstattRapport,
  RepositoryBlocked,
  RepositoryReady,
} from '~/routes/__stories__/AuditReportGenerateSection.stories'
import { AuditReportGenerateSection } from '../AuditReportGenerateSection'

function render(extra: Partial<Parameters<typeof AuditReportGenerateSection>[0]> = {}) {
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <AuditReportGenerateSection
          appId={1}
          appUrl="/team/team-fjord/env/prod-gcp/app/test"
          auditReports={[]}
          readinessUserMappings={{}}
          isCheckingReadiness={false}
          isGeneratingReport={false}
          pendingJobId={null}
          {...RepositoryReady.args}
          {...extra}
        />
      ),
    },
  ])
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

describe('report model selection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers repository generation only for readiness from the same model and period', () => {
    expect(render()).toContain('value="generate_report"')
    expect(render({ readinessAssessmentModel: 'application' })).not.toContain('value="generate_report"')
    expect(render({ readinessPeriodKey: 'yearly:2024-01-01' })).not.toContain('value="generate_report"')
  })

  it('explains repository blockers without application-status labels', () => {
    const markup = render(RepositoryBlocked.args)
    expect(markup).toContain('Repository er ikke tillatt for applikasjonen')
    expect(markup).toContain('Ukjent workflow-trigger')
    expect(markup).toContain('view=repository')
    expect(markup).not.toContain('value="generate_report"')
    expect(markup).not.toContain('Legacy')
  })

  it('requires a replacement reason only for an active report of the selected model', () => {
    const applicationReports = ErstattRapport.args?.auditReports ?? []
    expect(render({ auditReports: applicationReports })).not.toContain('Begrunnelse for ny rapport')
    expect(
      render({
        auditReports: applicationReports.map((report) => ({ ...report, assessment_model: 'repository' })),
      }),
    ).toContain('Begrunnelse for ny rapport')
  })
})
