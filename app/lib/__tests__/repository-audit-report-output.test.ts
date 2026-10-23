import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
import { generateRepositoryAuditReportExcel } from '../repository-audit-report-excel.server'
import {
  buildRepositoryReportSections,
  buildRepositoryReportSummary,
  REPOSITORY_REPORT_SECTION_INTRODUCTIONS,
} from '../repository-audit-report-output'
import { generateRepositoryAuditReportPdf } from '../repository-audit-report-pdf'
import { repositoryReportFixture } from './fixtures/repository-audit-report'

describe('repository report exports', () => {
  it('keeps deployment rows separate from shared code evidence and preserves after-control dates', () => {
    const props = repositoryReportFixture()
    const sections = buildRepositoryReportSections(props)
    expect(sections.find((section) => section.title === 'Deployments')?.rows).toHaveLength(2)
    expect(sections.find((section) => section.title === 'Commits')?.rows).toHaveLength(1)
    const history = sections.find((section) => section.title === 'Manuell historikk')
    expect(history?.rows[0]).toContain('20.01.2026, 01:00\n21.01.2026, 01:00')
    expect(JSON.stringify(sections)).toContain('inkludert etterkontroll')
    expect(JSON.stringify(sections)).toContain(props.reportData.deliveries[0].baseSha)
    expect(JSON.stringify(sections)).toContain('50')
    expect(sections.find((section) => section.title === 'Deployments')?.rows[0][0]).toContain('15.01.2026')
    expect(sections.find((section) => section.title === 'Deployments')?.rows[0][0]).toContain('Glad Fjord')
    expect(sections.find((section) => section.title === 'Deployments')?.rows[0][3]).toContain('Triggered via push')
    expect(sections.find((section) => section.title === 'Deployments')?.rows[0][4]).toContain('Aktiv')
    expect(JSON.stringify(sections.find((section) => section.title === 'Kodeleveranser')?.rows)).toContain(
      'Hele intervallet er dekket',
    )
    expect(JSON.stringify(sections.find((section) => section.title === 'Commits')?.rows)).toContain(
      'Dekket av manuell godkjenning',
    )
    expect(JSON.stringify(sections.find((section) => section.title === 'PR-evidens')?.rows)).toContain(
      'Review trukket tilbake',
    )
    expect(sections.find((section) => section.title === 'PR-evidens')?.rows[0][2]).toBe('Glad Fjord / Rask Elv')
    expect(sections.find((section) => section.title === 'Kilder')?.rows[0][1]).toBe('Sammenligning')
    expect(JSON.stringify(sections.find((section) => section.title === 'Manuell historikk')?.rows)).toContain('Gyldig')
    expect(sections.find((section) => section.title === 'Identiteter')?.rows[0][4]).toBe('Nei')
    expect(buildRepositoryReportSummary(props).values).toContainEqual([
      'Unike reviewers',
      '1 GitHub-konto / 1 NAV-ident',
    ])
    expect(sections.find((section) => section.title === 'Avvik')?.rows[0][2]).toContain(
      'Direkte push uten forhåndsgodkjenning',
    )
    expect(buildRepositoryReportSummary(props).values).toContainEqual(['Registrerte avvik', '1 (1 åpne)'])
    expect(sections.find((section) => section.title === 'Deployments')?.rows[0][1]).toContain('Endringsopphav')
    expect(sections.find((section) => section.title === 'Deployments')?.cellLinks?.[0]?.[0]).toContain('/deployments/1')
    expect(sections.find((section) => section.title === 'Sammendrag')?.rows).toContainEqual([
      'Repository',
      'navikt/test',
    ])
  })

  it('excludes revoked manual approvals and dismissed reviews from reviewer counts', () => {
    const props = repositoryReportFixture()
    props.reportData.deliveries[0].manualApprovals[0].status = 'revoked'
    expect(buildRepositoryReportSummary(props).values).toContainEqual([
      'Unike reviewers',
      '1 GitHub-konto / 0 NAV-identer',
    ])
  })

  it('counts only eligible approvals after the last commit from another author', () => {
    const props = repositoryReportFixture()
    const pullRequest = props.reportData.deliveries[0].evidence.pullRequestsByNumber[42]
    if (!pullRequest) throw new Error('Missing fixture pull request')
    const existingCommit = pullRequest.commits?.[0]
    const headSha = pullRequest.headSha
    if (!existingCommit || !headSha) throw new Error('Missing fixture pull request commits')
    pullRequest.commits = [
      {
        ...existingCommit,
        sha: 'a'.repeat(40),
        authorDate: '2026-01-15T00:00:00Z',
        committerDate: '2026-01-15T00:00:00Z',
      },
      {
        ...existingCommit,
        sha: headSha,
        authorDate: '2026-01-16T00:00:00Z',
        committerDate: '2026-01-16T00:00:00Z',
      },
    ]
    pullRequest.commitCount = 2
    pullRequest.reviews = [
      {
        id: 3,
        username: 'stale-reviewer',
        state: 'APPROVED',
        submittedAt: '2026-01-15T12:00:00Z',
        body: null,
        commitId: pullRequest.commits[0].sha,
      },
      {
        id: 4,
        username: 'gladfjord',
        state: 'APPROVED',
        submittedAt: '2026-01-17T00:00:00Z',
        body: null,
        commitId: headSha,
      },
      {
        id: 5,
        username: 'valid-reviewer',
        state: 'APPROVED',
        submittedAt: '2026-01-17T00:00:00Z',
        body: null,
        commitId: headSha,
      },
    ]

    expect(buildRepositoryReportSummary(props).values).toContainEqual([
      'Unike reviewers',
      '1 GitHub-konto / 1 NAV-ident',
    ])
  })

  it('counts approvals that qualify through configured implicit approval', () => {
    const props = repositoryReportFixture()
    const delivery = props.reportData.deliveries[0]
    delivery.evidence.implicitApprovalMode = 'all'
    const pullRequest = delivery.evidence.pullRequestsByNumber[42]
    if (!pullRequest) throw new Error('Missing fixture pull request')
    const latestCommit = pullRequest.commits?.[0]
    if (!latestCommit) throw new Error('Missing fixture pull request commits')
    pullRequest.reviews = [
      {
        id: 3,
        username: 'implicit-reviewer',
        state: 'APPROVED',
        submittedAt: '2026-01-15T12:00:00Z',
        body: null,
        commitId: latestCommit.sha,
      },
    ]

    expect(buildRepositoryReportSummary(props).values).toContainEqual([
      'Unike reviewers',
      '1 GitHub-konto / 1 NAV-ident',
    ])
  })

  it('counts commit authors even when they have no identity mapping', () => {
    const props = repositoryReportFixture()
    expect(buildRepositoryReportSummary(props).values).toContainEqual(['Unike bidragsytere', '1 person'])

    props.reportData.deliveries[0].interval.commits[0].authorLogin = null
    props.reportData.deliveries[0].interval.commits[0].authorUsername = 'unmapped-user'
    props.reportData.deliveries[0].authorIdentities = []
    expect(buildRepositoryReportSummary(props).values).toContainEqual(['Unike bidragsytere', '1 person'])
  })

  it('produces a readable workbook with frozen evidence and no legacy deployment-method counts', async () => {
    const workbook = new ExcelJS.Workbook()
    const bytes = await generateRepositoryAuditReportExcel(repositoryReportFixture())
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
    expect(workbook.getWorksheet('Deployments')?.rowCount).toBe(4)
    expect(workbook.getWorksheet('Deployments')?.getRow(1).getCell(1).value).toContain('listet separat')
    expect(workbook.getWorksheet('Deployments')?.getRow(2).values).toContain('Deployment / tidspunkt')
    expect(workbook.getWorksheet('Commits')?.rowCount).toBe(3)
    expect(workbook.getWorksheet('Manuell historikk')?.getRow(3).values).toContain(
      '20.01.2026, 01:00\n21.01.2026, 01:00',
    )
    expect(JSON.stringify(workbook.getWorksheet('Sammendrag')?.getSheetValues())).toContain(
      'Rapporten gjelder applikasjonens deployments',
    )
    expect(JSON.stringify(workbook.getWorksheet('Sammendrag')?.getSheetValues())).not.toContain('Via Pull Request')
    expect(JSON.stringify(workbook.getWorksheet('Sammendrag')?.getSheetValues())).toContain('Unike reviewers')
    expect(JSON.stringify(workbook.getWorksheet('Sammendrag')?.getSheetValues())).toContain('navikt/test')
    expect(workbook.getWorksheet('Avvik')?.getCell(3, 3).value).toContain('Direkte push uten forhåndsgodkjenning')
    expect(workbook.getWorksheet('Deployments')?.getCell(3, 1).value).toMatchObject({
      text: expect.stringContaining('1 / nais-1'),
      hyperlink: expect.stringContaining('/deployments/1'),
    })
    expect(workbook.getWorksheet('Commits')?.getCell(3, 2).value).toMatchObject({
      hyperlink: expect.stringContaining(`/commit/${'b'.repeat(40)}`),
    })
    expect(workbook.getWorksheet('PR-evidens')?.getCell(3, 2).value).toMatchObject({
      text: expect.stringContaining('#42'),
      hyperlink: expect.stringContaining('/pull/42'),
    })
    for (const [sheetName, introduction] of Object.entries(REPOSITORY_REPORT_SECTION_INTRODUCTIONS)) {
      expect(workbook.getWorksheet(sheetName)?.getRow(1).getCell(1).value).toBe(introduction)
    }
  })

  it('does not create spreadsheet hyperlinks for non-HTTP deployment sources', async () => {
    const props = repositoryReportFixture()
    props.reportData.deployments[0].source.triggerUrl = 'javascript:alert(1)'
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(await generateRepositoryAuditReportExcel(props)).buffer)
    expect(typeof workbook.getWorksheet('Deployments')?.getCell(3, 4).value).toBe('string')
  })

  it('renders a PDF with stored report data', async () => {
    const pdf = await generateRepositoryAuditReportPdf(repositoryReportFixture())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1000)
  })

  it('renders multi-page deployment and long commit evidence without overflow warnings', async () => {
    const props = repositoryReportFixture()
    const deployment = props.reportData.deployments[0]
    props.reportData.deployments = Array.from({ length: 40 }, (_, index) => ({
      ...deployment,
      id: index + 1,
      naisDeploymentId: `nais-${index + 1}`,
    }))
    const longMessage = 'Lang commitbeskrivelse '.repeat(300)
    const newlineHeavyMessage = 'Linje\n'.repeat(100)
    const longDeviation = 'Lang avviksbeskrivelse '.repeat(300)
    const delivery = props.reportData.deliveries[0]
    const firstCommit = delivery.interval.commits[0]
    if (!firstCommit) throw new Error('Missing fixture interval commit')
    firstCommit.message = longMessage
    delivery.interval.commits.push({ ...firstCommit, sha: 'd'.repeat(40), message: newlineHeavyMessage })
    delivery.interval.totalCommits = 2
    delivery.interval.listedCommits = 2
    delivery.interval.summary = { covered: 0, notCovered: 2, unknown: 0 }
    delivery.assessment.commits.push({
      sha: 'd'.repeat(40),
      status: 'covered',
      reason: 'manual_approval',
    })
    delivery.assessment.totalCommits = 2
    delivery.assessment.listedCommits = 2
    props.reportData.deviations[0].reason = longDeviation
    const warn = vi.spyOn(console, 'warn')
    try {
      const pdf = await generateRepositoryAuditReportPdf(props)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(warn.mock.calls.flat().join(' ')).not.toContain('bigger than available page height')
      expect(warn.mock.calls.flat().join(' ')).not.toContain('Node of type VIEW')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Uint8Array.from(await generateRepositoryAuditReportExcel(props)).buffer)
      expect(workbook.getWorksheet('Commits')?.getCell(3, 3).value).toBe(longMessage)
      expect(workbook.getWorksheet('Avvik')?.getCell(3, 3).value).toContain(longDeviation)
    } finally {
      warn.mockRestore()
    }
  })

  it('supports an explicitly empty period', async () => {
    const props = repositoryReportFixture()
    props.reportData.deployments = []
    props.reportData.deliveries = []
    expect(JSON.stringify(buildRepositoryReportSections(props))).toContain('Ingen deployments registrert')
    expect(await generateRepositoryAuditReportExcel(props)).toBeInstanceOf(Buffer)
    expect(await generateRepositoryAuditReportPdf(props)).toBeInstanceOf(Buffer)
  })

  it('rejects exports if any deployment no longer satisfies readiness', async () => {
    const props = repositoryReportFixture()
    props.reportData.deployments[0].source.repositoryAuthorization = null
    await expect(generateRepositoryAuditReportExcel(props)).rejects.toThrow('not ready')
    await expect(generateRepositoryAuditReportPdf(props)).rejects.toThrow('not ready')
  })
})
