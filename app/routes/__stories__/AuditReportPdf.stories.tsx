import { PDFViewer } from '@react-pdf/renderer'
import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'
import type {
  AuditDeploymentEntry,
  AuditReportData,
  ContributorEntry,
  DeviationEntry,
  ManualApprovalEntry,
  ReviewerEntry,
} from '~/db/audit-reports.server'
import { AuditReportPdfDocument } from '~/lib/audit-report-pdf'

const PdfWrapper = (props: ComponentProps<typeof AuditReportPdfDocument>) => (
  <PDFViewer width="100%" height="900px" style={{ border: 'none' }}>
    <AuditReportPdfDocument {...props} />
  </PDFViewer>
)

const meta: Meta<typeof PdfWrapper> = {
  title: 'Features/AuditReportPdf',
  component: PdfWrapper,
  parameters: {
    router: { skip: true },
    layout: 'fullscreen',
  },
}
export default meta
type Story = StoryObj<typeof PdfWrapper>

const prDeployments: AuditDeploymentEntry[] = [
  {
    id: 1,
    nais_deployment_id: 'deploy-001',
    title: 'feat: ny beregningslogikk for dagpenger',
    date: '2025-02-14T10:30:00Z',
    commit_sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    method: 'pr',
    pr_number: 142,
    pr_url: 'https://github.com/navikt/dp-rapportering/pull/142',
    pr_author: 'gladfjord',
    pr_author_display_name: 'Glad Fjord',
    deployer: 'raskelv',
    deployer_display_name: 'Rask Elv',
    approver: 'stilleskog',
    approver_display_name: 'Stille Skog',
  },
  {
    id: 2,
    nais_deployment_id: 'deploy-002',
    title: 'fix: korriger avrunding i utbetalingsberegning',
    date: '2025-03-05T14:15:00Z',
    commit_sha: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    method: 'pr',
    pr_number: 158,
    pr_url: 'https://github.com/navikt/dp-rapportering/pull/158',
    pr_author: 'modigbjork',
    pr_author_display_name: 'Modig Bjørk',
    deployer: 'gladfjord',
    deployer_display_name: 'Glad Fjord',
    approver: 'raskelv',
    approver_display_name: 'Rask Elv',
  },
  {
    id: 3,
    nais_deployment_id: 'deploy-003',
    title: 'chore: oppdater avhengigheter',
    date: '2025-04-20T09:00:00Z',
    commit_sha: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    method: 'pr',
    pr_number: 171,
    pr_url: 'https://github.com/navikt/dp-rapportering/pull/171',
    pr_author: 'stilleskog',
    pr_author_display_name: 'Stille Skog',
    deployer: 'modigbjork',
    deployer_display_name: 'Modig Bjørk',
    approver: 'gladfjord',
    approver_display_name: 'Glad Fjord',
  },
]

const baselineDeployment: AuditDeploymentEntry = {
  id: 10,
  nais_deployment_id: 'deploy-baseline',
  title: 'Baseline — versjon ved oppstart av NDA-overvåking',
  date: '2025-01-01T00:00:00Z',
  commit_sha: 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
  method: 'baseline',
  deployer: 'nais-system',
  deployer_display_name: 'NAIS System',
  approver: 'Rask Elv',
}

const manualDeployment: AuditDeploymentEntry = {
  id: 20,
  nais_deployment_id: 'deploy-manual',
  title: 'hotfix: kritisk feil i personregister-oppslag',
  date: '2025-06-10T22:00:00Z',
  commit_sha: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
  method: 'manual',
  deployer: 'gladfjord',
  deployer_display_name: 'Glad Fjord',
  approver: 'Modig Bjørk',
  slack_link: 'https://nav-it.slack.com/archives/C12345/p1234567890',
}

const manualApprovals: ManualApprovalEntry[] = [
  {
    deployment_id: 20,
    nais_deployment_id: 'deploy-manual',
    title: 'hotfix: kritisk feil i personregister-oppslag',
    date: '2025-06-10T22:00:00Z',
    commit_sha: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    deployer: 'gladfjord',
    deployer_display_name: 'Glad Fjord',
    reason: 'Kritisk produksjonsfeil — personregister-oppslag feilet for alle brukere.',
    registered_by: 'gladfjord',
    registered_by_display_name: 'Glad Fjord',
    approved_by: 'modigbjork',
    approved_by_display_name: 'Modig Bjørk',
    approved_at: '2025-06-10T22:15:00Z',
    slack_link: 'https://nav-it.slack.com/archives/C12345/p1234567890',
    comment: 'Godkjent som hastedeploy — to sett øyne bekreftet kodeendringen.',
  },
]

const contributors: ContributorEntry[] = [
  { github_username: 'gladfjord', display_name: 'Glad Fjord', nav_ident: 'Z990001', deployment_count: 2 },
  { github_username: 'raskelv', display_name: 'Rask Elv', nav_ident: 'Z990002', deployment_count: 1 },
  { github_username: 'modigbjork', display_name: 'Modig Bjørk', nav_ident: 'Z990003', deployment_count: 1 },
  { github_username: 'stilleskog', display_name: 'Stille Skog', nav_ident: 'Z990004', deployment_count: 1 },
]

const reviewers: ReviewerEntry[] = [
  { github_username: 'stilleskog', display_name: 'Stille Skog', review_count: 2 },
  { github_username: 'raskelv', display_name: 'Rask Elv', review_count: 1 },
  { github_username: 'gladfjord', display_name: 'Glad Fjord', review_count: 1 },
  { github_username: 'modigbjork', display_name: 'Modig Bjørk', review_count: 1 },
]

const deviation: DeviationEntry = {
  deployment_id: 20,
  date: '2025-06-10T22:00:00Z',
  commit_sha: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
  reason: 'Hastedeploy uten ordinær PR-prosess — kritisk produksjonsfeil.',
  breach_type: 'emergency_deploy',
  intent: 'fix',
  severity: 'high',
  follow_up_role: 'tech_lead',
  registered_by: 'gladfjord',
  registered_by_name: 'Glad Fjord',
  resolved_at: '2025-06-12T10:00:00Z',
  resolution_note: 'Kodeendring gjennomgått i etterkant og godkjent av tech lead.',
}

const baseReportData: AuditReportData = {
  deployments: [...prDeployments],
  manual_approvals: [],
  contributors,
  reviewers,
  legacy_count: 0,
  deviations: [],
  unverified_commit_deployments: [],
}

const baseProps = {
  appName: 'dp-rapportering-personregister',
  repository: 'navikt/dp-rapportering',
  teamSlug: 'teamdagpenger',
  environmentName: 'prod-gcp',
  year: 2025,
  periodLabel: '2025',
  periodStart: new Date('2025-01-01'),
  periodEnd: new Date('2025-12-31'),
  contentHash: 'sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  reportId: 'AUDIT-2025-dp-rapportering-personregister-prod-gcp-abcdef12-1a2b3c4d',
  generatedAt: new Date('2025-12-20T13:45:00Z'),
  testRequirement: 'integration_tests' as const,
}

export const PrGodkjente: Story = {
  args: {
    ...baseProps,
    reportData: baseReportData,
  },
}

export const MedBaseline: Story = {
  args: {
    ...baseProps,
    reportData: {
      ...baseReportData,
      deployments: [baselineDeployment, ...prDeployments],
    },
  },
}

export const MedManuelOgAvvik: Story = {
  args: {
    ...baseProps,
    reportData: {
      ...baseReportData,
      deployments: [...prDeployments, manualDeployment],
      manual_approvals: manualApprovals,
      deviations: [deviation],
    },
  },
}

export const AlleTyper: Story = {
  args: {
    ...baseProps,
    reportData: {
      ...baseReportData,
      deployments: [baselineDeployment, ...prDeployments, manualDeployment],
      manual_approvals: manualApprovals,
      deviations: [deviation],
    },
  },
}

export const TomPeriode: Story = {
  args: {
    ...baseProps,
    reportData: {
      deployments: [],
      manual_approvals: [],
      contributors: [],
      reviewers: [],
      legacy_count: 0,
      deviations: [],
      unverified_commit_deployments: [],
    },
  },
}
