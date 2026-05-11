import type { Meta, StoryObj } from '@storybook/react'
import { AuditReportGenerateSection } from '~/components/AuditReportGenerateSection'
import type { AuditReadinessCheck, AuditReportSummary } from '~/db/audit-reports.server'

const meta: Meta<typeof AuditReportGenerateSection> = {
  title: 'Features/AuditReportGenerateSection',
  component: AuditReportGenerateSection,
  args: {
    appId: 1,
    appUrl: '/team/testteam/env/prod-gcp/app/test-app',
    auditReports: [],
    readinessUserMappings: {},
    isCheckingReadiness: false,
    isGeneratingReport: false,
    pendingJobId: null,
  },
}
export default meta
type Story = StoryObj<typeof AuditReportGenerateSection>

const readyReadiness: AuditReadinessCheck = {
  is_ready: true,
  total_deployments: 42,
  approved_count: 40,
  legacy_count: 2,
  pending_count: 0,
  pending_deployments: [],
  missing_approver_count: 0,
  missing_approver_deployments: [],
}

const notReadyReadiness: AuditReadinessCheck = {
  is_ready: false,
  total_deployments: 42,
  approved_count: 35,
  legacy_count: 2,
  pending_count: 3,
  pending_deployments: [
    {
      id: 101,
      created_at: new Date('2025-06-15'),
      commit_sha: 'abc1234567890',
      deployer_username: 'gladfjord',
      four_eyes_status: 'pending',
    },
    {
      id: 102,
      created_at: new Date('2025-07-20'),
      commit_sha: 'def4567890123',
      deployer_username: 'raskelv',
      four_eyes_status: 'pending',
    },
    {
      id: 103,
      created_at: new Date('2025-08-10'),
      commit_sha: 'ghi7890123456',
      deployer_username: 'stilleskog',
      four_eyes_status: 'unverified',
    },
  ],
  missing_approver_count: 2,
  missing_approver_deployments: [
    {
      id: 201,
      created_at: new Date('2025-03-10'),
      commit_sha: 'jkl0123456789',
      deployer_username: 'modigbjork',
      four_eyes_status: 'approved',
    },
    {
      id: 202,
      created_at: new Date('2025-04-22'),
      commit_sha: 'mno3456789012',
      deployer_username: 'gladfjord',
      four_eyes_status: 'approved',
    },
  ],
}

const existingReport: AuditReportSummary = {
  id: 1,
  report_id: 'AUDIT-2025-test-app-prod-gcp-abcdef12-1a2b3c4d5e6f',
  app_name: 'test-app',
  team_slug: 'testteam',
  environment_name: 'prod-gcp',
  year: 2025,
  period_type: 'yearly',
  period_label: '2025',
  period_start: new Date(2025, 0, 1),
  total_deployments: 42,
  pr_approved_count: 38,
  manually_approved_count: 2,
  generated_at: new Date('2025-12-15'),
  archived_at: null,
  archived_by: null,
  archive_reason: null,
  superseded_at: null,
  superseded_by: null,
  supersede_reason: null,
  superseded_by_report_id: null,
}

/** Før kontroll — bare periode-velgere og "Kontroller grunnlag"-knapp. */
export const FørKontroll: Story = {
  args: {},
}

/** Klar for rapport — readiness er OK, "Generer rapport"-knappen vises. */
export const KlarForRapport: Story = {
  args: {
    readinessData: readyReadiness,
    readinessPeriodKey: 'yearly:2025-01-01',
  },
}

/** Ikke klar — readiness feiler, ingen generer-knapp. */
export const IkkeKlar: Story = {
  args: {
    readinessData: notReadyReadiness,
    readinessPeriodKey: 'yearly:2025-01-01',
    readinessUserMappings: {
      gladfjord: { display_name: 'Glad Fjord', nav_ident: null },
      raskelv: { display_name: 'Rask Elv', nav_ident: null },
      stilleskog: { display_name: 'Stille Skog', nav_ident: null },
      modigbjork: { display_name: 'Modig Bjørk', nav_ident: null },
    },
  },
}

/** Erstatting — eksisterende rapport funnet, begrunnelsesfelt vises over knapp. */
export const ErstattRapport: Story = {
  args: {
    readinessData: readyReadiness,
    readinessPeriodKey: 'yearly:2025-01-01',
    auditReports: [existingReport],
  },
}

/** Genererer — knapp i loading-tilstand. */
export const Genererer: Story = {
  args: {
    readinessData: readyReadiness,
    readinessPeriodKey: 'yearly:2025-01-01',
    pendingJobId: 'job-123',
  },
}

/** Kontrollerer — "Kontroller grunnlag" i loading-tilstand. */
export const Kontrollerer: Story = {
  args: {
    isCheckingReadiness: true,
  },
}
