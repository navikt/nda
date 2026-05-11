import type { Meta, StoryObj } from '@storybook/react'
import { type AuditReportItem, AuditReportList } from '../AuditReportList'

const meta: Meta<typeof AuditReportList> = {
  title: 'Components/AuditReportList',
  component: AuditReportList,
}

export default meta

type Story = StoryObj<typeof AuditReportList>

const activeReport: AuditReportItem = {
  id: 1,
  report_id: 'AUDIT-2025-pensjon-pen-prod-fss-a1b2c3',
  period_label: 'Årsrapport 2025',
  archived_at: null,
  archived_by: null,
  archive_reason: null,
  superseded_at: null,
  superseded_by: null,
  supersede_reason: null,
}

const archivedReport: AuditReportItem = {
  id: 2,
  report_id: 'AUDIT-2024-pensjon-pen-prod-fss-d4e5f6',
  period_label: 'Årsrapport 2024',
  archived_at: new Date('2026-03-15T10:30:00Z'),
  archived_by: 'S654321',
  archive_reason: 'Erstattet av korrigert rapport med oppdaterte avvikstall',
  superseded_at: null,
  superseded_by: null,
  supersede_reason: null,
}

const quarterlyReport: AuditReportItem = {
  id: 3,
  report_id: 'AUDIT-2025-Q3-pensjon-pen-prod-fss-g7h8i9',
  period_label: 'Q3 2025',
  archived_at: null,
  archived_by: null,
  archive_reason: null,
  superseded_at: null,
  superseded_by: null,
  supersede_reason: null,
}

const supersededReport: AuditReportItem = {
  id: 4,
  report_id: 'AUDIT-2025-pensjon-pen-prod-fss-x1y2z3',
  period_label: 'Årsrapport 2025',
  archived_at: null,
  archived_by: null,
  archive_reason: null,
  superseded_at: new Date('2026-05-10T14:00:00Z'),
  superseded_by: 'L123456',
  supersede_reason: 'Korrigert etter oppdatering av verifiseringsdata for tre leveranser',
}

const mockDisplayNameMap: Record<string, string> = {
  S654321: 'Stille Skog',
  L123456: 'Lys Fjord',
}

export const ActiveReports: Story = {
  args: {
    reports: [activeReport, quarterlyReport],
    showArchiveActions: true,
    displayNameMap: mockDisplayNameMap,
  },
}

export const WithArchivedReport: Story = {
  args: {
    reports: [activeReport, archivedReport, quarterlyReport],
    showArchiveActions: true,
    displayNameMap: mockDisplayNameMap,
  },
}

export const AllArchived: Story = {
  args: {
    reports: [
      archivedReport,
      {
        ...quarterlyReport,
        archived_at: new Date('2026-04-01T08:00:00Z'),
        archived_by: 'L123456',
        archive_reason: 'Feil i grunnlagsdata — PR-data manglet for tre leveranser',
      },
    ],
    showArchiveActions: true,
    displayNameMap: mockDisplayNameMap,
  },
}

export const WithSupersededReport: Story = {
  name: 'Med erstattet rapport',
  args: {
    reports: [activeReport, supersededReport, quarterlyReport],
    showArchiveActions: true,
    displayNameMap: mockDisplayNameMap,
  },
}

export const MixedStatuses: Story = {
  name: 'Alle statuser',
  args: {
    reports: [activeReport, supersededReport, archivedReport, quarterlyReport],
    showArchiveActions: true,
    displayNameMap: mockDisplayNameMap,
  },
}

export const ReadOnly: Story = {
  name: 'Uten arkiveringshandlinger',
  args: {
    reports: [activeReport, archivedReport],
    showArchiveActions: false,
    displayNameMap: mockDisplayNameMap,
  },
}

export const Empty: Story = {
  name: 'Ingen rapporter',
  args: {
    reports: [],
    showArchiveActions: true,
  },
}
