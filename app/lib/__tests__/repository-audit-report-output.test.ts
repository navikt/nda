import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
import { generateRepositoryAuditReportExcel } from '../repository-audit-report-excel.server'
import {
  buildRepositoryDeploymentApproval,
  buildRepositoryReportSections,
  buildRepositoryReportSummary,
  filterRepositoryReportSectionsForExport,
  REPOSITORY_REPORT_SECTION_INTRODUCTIONS,
} from '../repository-audit-report-output'
import { generateRepositoryAuditReportPdf } from '../repository-audit-report-pdf'
import { repositoryReportFixture } from './fixtures/repository-audit-report'

describe('repository report exports', () => {
  it('uses the Apply source ID in shared report sections and Excel while preserving legacy IDs', async () => {
    const props = repositoryReportFixture()
    props.reportData.deployments[0].naisDeploymentId = null
    props.reportData.deployments[0].deploymentSourceId = 'nais-apply:123:1:1:2:image'

    const sections = buildRepositoryReportSections(props)
    const deployments = sections.find((section) => section.title === 'Deployments')
    expect(deployments?.rows[0][0]).toContain('1 / nais-apply:123:1:1:2:image')
    expect(deployments?.rows[1][0]).toContain('2 / nais-2')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(await generateRepositoryAuditReportExcel(props)).buffer)
    expect(workbook.getWorksheet('Deployments')?.getCell(3, 1).value).toMatchObject({
      text: expect.stringContaining('1 / nais-apply:123:1:1:2:image'),
    })
    expect(workbook.getWorksheet('Deployments')?.getCell(4, 1).value).toMatchObject({
      text: expect.stringContaining('2 / nais-2'),
    })
    const pdf = await generateRepositoryAuditReportPdf(props)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('shows only manual evidence used to approve the delivery', () => {
    const props = repositoryReportFixture()
    const approval = buildRepositoryDeploymentApproval(props.reportData, 7)
    expect(approval).toEqual({
      method: 'Manuell',
      references: [{ label: 'Manuell #20', url: null }],
      authors: '—',
      approvers: 'Rask Elv',
    })
    props.reportData.deliveries[0].manualApprovals[0].status = 'revoked'
    expect(buildRepositoryDeploymentApproval(props.reportData, 7).approvers).toBe('—')
  })

  it('excludes manual evidence for a different commit author even if that identity remains in the delivery', () => {
    const props = repositoryReportFixture()
    const delivery = props.reportData.deliveries[0]
    delivery.manualApprovals.push({
      ...delivery.manualApprovals[0],
      id: 21,
      authorLogin: 'fjellbris',
      authorNavIdent: 'Z990003',
      reviewerNavIdent: 'Z990004',
    })
    delivery.authorIdentities.push({
      ...delivery.authorIdentities[0],
      githubUsername: 'fjellbris',
      activeNavIdent: 'Z990003',
    })

    const approval = buildRepositoryDeploymentApproval(props.reportData, 7)
    expect(approval.references).toEqual([{ label: 'Manuell #20', url: null }])
    expect(approval.approvers).toBe('Rask Elv')
  })

  it('shows a single manual reference when one approval covers multiple commits', () => {
    const props = repositoryReportFixture()
    const delivery = props.reportData.deliveries[0]
    const sha = 'c'.repeat(40)
    delivery.interval.commits.push({ ...delivery.interval.commits[0], sha })
    delivery.assessment.commits.push({ sha, status: 'covered', reason: 'manual_approval' })
    delivery.manualApprovals.push({ ...delivery.manualApprovals[0], sha })

    const approval = buildRepositoryDeploymentApproval(props.reportData, 7)
    expect(approval.references).toEqual([{ label: 'Manuell #20', url: null }])
    expect(approval.approvers).toBe('Rask Elv')
  })

  it('includes multiple PRs and manual approvals covering the interval', () => {
    const props = repositoryReportFixture()
    const delivery = props.reportData.deliveries[0]
    const pr = delivery.evidence.pullRequestsByNumber[42]
    if (!pr) throw new Error('Missing fixture pull request')
    delivery.evidence.pullRequestsByNumber[43] = {
      ...pr,
      number: 43,
      authorLogin: 'fjellbris',
    }
    for (const [number, sha] of [
      [42, 'c'.repeat(40)],
      [43, 'd'.repeat(40)],
    ] as const) {
      delivery.assessment.commits.push({ sha, status: 'covered', reason: 'approved_pr' })
      delivery.interval.commits.push({
        ...delivery.interval.commits[0],
        sha,
        pullRequestNumber: number,
        status: 'covered',
        reason: 'approved_review',
      })
    }
    const approval = buildRepositoryDeploymentApproval(props.reportData, 7)
    expect(approval.method).toBe('PR + Manuell')
    expect(approval.references.map((reference) => reference.label)).toEqual(['PR #42', 'PR #43', 'Manuell #20'])
    expect(approval.authors).toBe('Glad Fjord\nFjell Bris')
    expect(approval.approvers).toBe('Rask Elv')
    expect(approval.references[0].url).toBe('https://github.com/navikt/test/pull/42')
  })

  it('includes the merger when approval depends on implicit approval', () => {
    const props = repositoryReportFixture()
    const delivery = props.reportData.deliveries[0]
    const pr = delivery.evidence.pullRequestsByNumber[42]
    if (!pr?.reviews) throw new Error('Missing fixture pull request')
    delivery.evidence.implicitApprovalMode = 'all'
    pr.mergedByLogin = 'fjellbris'
    pr.reviews[0].submittedAt = '2026-01-15T00:00:00Z'
    pr.reviews[0].commitId = 'a'.repeat(40)
    delivery.assessment.commits[0].reason = 'approved_pr'
    delivery.interval.commits[0].status = 'covered'
    delivery.interval.commits[0].reason = 'implicit_approval'
    delivery.interval.commits[0].pullRequestNumber = 42

    expect(buildRepositoryDeploymentApproval(props.reportData, 7).approvers).toBe('Rask Elv\nFjell Bris')
  })

  it('excludes stale reviews when a current review covers a PR with implicit approval enabled', () => {
    const props = repositoryReportFixture()
    const delivery = props.reportData.deliveries[0]
    const pr = delivery.evidence.pullRequestsByNumber[42]
    if (!pr?.reviews) throw new Error('Missing fixture pull request')
    delivery.evidence.implicitApprovalMode = 'all'
    pr.mergedByLogin = 'fjellbris'
    pr.reviews.push({
      ...pr.reviews[0],
      id: 3,
      username: 'stale-reviewer',
      submittedAt: '2026-01-15T00:00:00Z',
      commitId: 'a'.repeat(40),
    })
    delivery.assessment.commits[0].reason = 'approved_pr'
    delivery.interval.commits[0].status = 'covered'
    delivery.interval.commits[0].reason = 'approved_review'
    delivery.interval.commits[0].pullRequestNumber = 42

    expect(buildRepositoryDeploymentApproval(props.reportData, 7).approvers).toBe('Rask Elv')
  })

  it('keeps deployment rows separate from shared code evidence and preserves after-control dates', () => {
    const props = repositoryReportFixture()
    const sections = buildRepositoryReportSections(props)
    expect(filterRepositoryReportSectionsForExport(sections).map((section) => section.title)).toEqual([
      'Sammendrag',
      'Deployments',
      'Manuell historikk',
      'Avvik',
    ])
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
    expect(sections.find((section) => section.title === 'Deployments')?.cellLinks?.[0]?.[0]).toContain(
      '/deployments/1?view=repository',
    )
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

  it('counts eligible reviewers from a stacked pull request used for approved interval coverage', () => {
    const props = repositoryReportFixture()
    const delivery = props.reportData.deliveries[0]
    const pullRequest = delivery.evidence.pullRequestsByNumber[42]
    if (!pullRequest) throw new Error('Missing fixture pull request')
    const stackedPullRequestNumber = 43
    const stackedPullRequest = {
      ...pullRequest,
      number: stackedPullRequestNumber,
      baseBranch: 'feature/base',
      authorLogin: 'gladfjord',
      reviews: [
        {
          id: 6,
          username: 'stacked-reviewer',
          state: 'APPROVED' as const,
          submittedAt: '2026-01-17T00:00:00Z',
          body: null,
          commitId: pullRequest.headSha,
        },
      ],
    }
    delivery.evidence.pullRequestsByNumber[stackedPullRequestNumber] = stackedPullRequest
    delivery.interval.commits[0].status = 'covered'
    delivery.interval.commits[0].reason = 'approved_review'
    delivery.interval.commits[0].pullRequestNumber = stackedPullRequestNumber

    expect(buildRepositoryReportSummary(props).values).toContainEqual([
      'Unike reviewers',
      '2 GitHub-kontoer / 1 NAV-ident',
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
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Sammendrag',
      'Deployments',
      'Manuell historikk',
      'Avvik',
    ])
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
      hyperlink: expect.stringContaining('/deployments/1?view=repository'),
    })
    expect(workbook.getWorksheet('Avvik')?.getCell(3, 1).value).toMatchObject({
      hyperlink: expect.stringContaining('/deployments/1?view=repository'),
    })
    for (const [sheetName, introduction] of Object.entries(REPOSITORY_REPORT_SECTION_INTRODUCTIONS).filter(
      ([sheetName]) => ['Deployments', 'Manuell historikk', 'Avvik'].includes(sheetName),
    )) {
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

  it('renders many deployments and long goal and approval evidence without overflow warnings', async () => {
    const props = repositoryReportFixture()
    const deployment = props.reportData.deployments[0]
    props.reportData.deployments = Array.from({ length: 40 }, (_, index) => ({
      ...deployment,
      id: index + 1,
      naisDeploymentId: `nais-${index + 1}`,
    }))
    const firstGoalLink = deployment.goalLinks[0]
    if (!firstGoalLink) throw new Error('Missing fixture deployment goal link')
    props.reportData.deployments[0].goalLinks = Array.from({ length: 40 }, (_, index) => ({
      ...firstGoalLink,
      objectiveTitle: `Mål ${index}\n${'Lang målbeskrivelse '.repeat(8)}`,
      keyResultTitle: `Resultat ${index}\n${'Lang resultatbeskrivelse '.repeat(8)}`,
    }))
    const newlineHeavyMessage = 'Linje\n'.repeat(100)
    const longDeviation = 'Lang avviksbeskrivelse '.repeat(300)
    props.reportData.deliveries[0].manualApprovals[0].documentation = newlineHeavyMessage
    props.reportData.deviations[0].reason = longDeviation
    const warn = vi.spyOn(console, 'warn')
    try {
      const pdf = await generateRepositoryAuditReportPdf(props)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(warn.mock.calls.flat().join(' ')).not.toContain('bigger than available page height')
      expect(warn.mock.calls.flat().join(' ')).not.toContain('Node of type VIEW')
      const deploymentRows = buildRepositoryReportSections(props).find((section) => section.title === 'Deployments')
      expect(deploymentRows?.rows[0]?.[1]).toContain('Mål 39\n')
      expect(deploymentRows?.rows[0]?.[1]).toContain('Resultat 39\n')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(Uint8Array.from(await generateRepositoryAuditReportExcel(props)).buffer)
      expect(workbook.getWorksheet('Commits')).toBeUndefined()
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
