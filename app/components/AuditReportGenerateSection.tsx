import { CheckmarkCircleIcon, ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Select,
  Textarea,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useState } from 'react'
import { Form, Link } from 'react-router'
import type { AuditReadinessCheck, AuditReportSummary } from '~/db/audit-reports.server'
import { toDateString } from '~/lib/date-utils'
import { getFourEyesStatusLabel } from '~/lib/four-eyes-status'
import {
  findExistingReportForPeriod,
  getCompletedPeriods,
  REPORT_PERIOD_TYPE_LABELS,
  type ReportPeriod,
  type ReportPeriodType,
} from '~/lib/report-periods'
import type { UserMappings } from '~/lib/user-display'
import { UserName } from './UserName'

interface AuditReportGenerateSectionProps {
  appId: number
  appUrl: string
  auditReports: AuditReportSummary[]
  auditStartYear?: number
  readinessData?: AuditReadinessCheck
  /** The period key (e.g. "yearly:2025-01-01") that readinessData was checked for. */
  readinessPeriodKey?: string
  readinessUserMappings: UserMappings
  isCheckingReadiness: boolean
  isGeneratingReport: boolean
  pendingJobId: string | null
}

export function AuditReportGenerateSection({
  appId,
  appUrl,
  auditReports,
  auditStartYear,
  readinessData,
  readinessPeriodKey,
  readinessUserMappings,
  isCheckingReadiness,
  isGeneratingReport,
  pendingJobId,
}: AuditReportGenerateSectionProps) {
  const [periodType, setPeriodType] = useState<ReportPeriodType>('yearly')
  const availablePeriods = getCompletedPeriods(periodType, new Date(), auditStartYear)
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(0)
  const selectedPeriod = availablePeriods[selectedPeriodIndex] || availablePeriods[0]

  const existingReportForPeriod = selectedPeriod ? findExistingReportForPeriod(auditReports, selectedPeriod) : undefined
  const [supersedeReason, setSupersedeReason] = useState('')

  // Reset supersede reason when period selection changes
  const currentPeriodKey = selectedPeriod ? `${selectedPeriod.type}:${toDateString(selectedPeriod.startDate)}` : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset side-effect on period change
  useEffect(() => {
    setSupersedeReason('')
  }, [currentPeriodKey])

  // Only show readiness data if it matches the currently selected period
  const readinessMatchesPeriod = readinessPeriodKey === currentPeriodKey

  return (
    <Form method="post">
      <input type="hidden" name="app_id" value={appId} />
      {selectedPeriod && (
        <>
          <input type="hidden" name="year" value={selectedPeriod.year} />
          <input type="hidden" name="period_type" value={selectedPeriod.type} />
          <input type="hidden" name="period_label" value={selectedPeriod.label} />
          <input type="hidden" name="period_start" value={toDateString(selectedPeriod.startDate)} />
          <input type="hidden" name="period_end" value={toDateString(selectedPeriod.endDate)} />
        </>
      )}
      <VStack gap="space-16">
        {/* Steg 1: Velg periode og kontroller grunnlag */}
        <HStack gap="space-16" align="end" wrap>
          <Select
            label="Rapporttype"
            value={periodType}
            onChange={(e) => {
              setPeriodType(e.target.value as ReportPeriodType)
              setSelectedPeriodIndex(0)
            }}
            size="small"
            style={{ minWidth: '140px' }}
          >
            {Object.entries(REPORT_PERIOD_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          <Select
            label="Periode"
            value={String(selectedPeriodIndex)}
            onChange={(e) => setSelectedPeriodIndex(Number(e.target.value))}
            size="small"
            style={{ minWidth: '180px' }}
          >
            {availablePeriods.map((period, index) => (
              <option key={period.label} value={index}>
                {period.label}
              </option>
            ))}
          </Select>

          <Button
            type="submit"
            name="action"
            value="check_readiness"
            variant="secondary"
            size="small"
            loading={isCheckingReadiness}
            disabled={!selectedPeriod || !!pendingJobId}
          >
            Kontroller grunnlag
          </Button>
        </HStack>

        {/* Steg 2: Readiness-resultat */}
        {readinessData && readinessMatchesPeriod && (
          <ReadinessResult readinessData={readinessData} appUrl={appUrl} userMappings={readinessUserMappings} />
        )}

        {/* Steg 3: Generer/Erstatt rapport (bare når klar) */}
        {readinessData?.is_ready && readinessMatchesPeriod && (
          <GenerateAction
            selectedPeriod={selectedPeriod}
            existingReportForPeriod={existingReportForPeriod}
            supersedeReason={supersedeReason}
            onSupersedeReasonChange={setSupersedeReason}
            isGeneratingReport={isGeneratingReport}
            pendingJobId={pendingJobId}
          />
        )}
      </VStack>
    </Form>
  )
}

function ReadinessResult({
  readinessData,
  appUrl,
  userMappings,
}: {
  readinessData: AuditReadinessCheck
  appUrl: string
  userMappings: UserMappings
}) {
  return (
    <Box padding="space-16" borderRadius="4" background={readinessData.is_ready ? 'success-soft' : 'warning-soft'}>
      <VStack gap="space-8">
        <HStack gap="space-8" align="center">
          {readinessData.is_ready ? (
            <>
              <CheckmarkCircleIcon aria-hidden fontSize="1.5rem" />
              <Heading size="xsmall" level="3">
                Klar for leveranserapport
              </Heading>
            </>
          ) : (
            <>
              <ExclamationmarkTriangleIcon aria-hidden fontSize="1.5rem" />
              <Heading size="xsmall" level="3">
                Ikke klar
              </Heading>
            </>
          )}
        </HStack>

        <HStack gap="space-24" wrap>
          <div>
            <Detail>Totalt deployments</Detail>
            <BodyShort weight="semibold">{readinessData.total_deployments}</BodyShort>
          </div>
          <div>
            <Detail>Godkjent</Detail>
            <BodyShort weight="semibold">{readinessData.approved_count}</BodyShort>
          </div>
          {readinessData.legacy_count > 0 && (
            <div>
              <Detail>Legacy</Detail>
              <BodyShort weight="semibold">{readinessData.legacy_count}</BodyShort>
            </div>
          )}
          <div>
            <Detail>Venter godkjenning</Detail>
            <BodyShort weight="semibold">{readinessData.pending_count}</BodyShort>
          </div>
          {readinessData.missing_approver_count > 0 && (
            <div>
              <Detail>Mangler godkjenner</Detail>
              <BodyShort weight="semibold">{readinessData.missing_approver_count}</BodyShort>
            </div>
          )}
        </HStack>

        {readinessData.pending_count > 0 && (
          <DeploymentList
            label="Deployments som mangler godkjenning:"
            deployments={readinessData.pending_deployments}
            appUrl={appUrl}
            userMappings={userMappings}
          />
        )}

        {readinessData.missing_approver_count > 0 && (
          <DeploymentList
            label="Godkjente deployments som mangler godkjenner-data:"
            deployments={readinessData.missing_approver_deployments}
            appUrl={appUrl}
            userMappings={userMappings}
          />
        )}
      </VStack>
    </Box>
  )
}

function DeploymentList({
  label,
  deployments,
  appUrl,
  userMappings,
}: {
  label: string
  deployments: AuditReadinessCheck['pending_deployments']
  appUrl: string
  userMappings: UserMappings
}) {
  return (
    <div>
      <Detail>{label}</Detail>
      <VStack gap="space-4">
        {deployments.map((d) => (
          <HStack key={d.id} gap="space-8" align="center">
            <AkselLink as={Link} to={`${appUrl}/deployments/${d.id}`}>
              {d.commit_sha?.substring(0, 7) || 'N/A'}
            </AkselLink>
            <BodyShort size="small">
              {new Date(d.created_at).toLocaleDateString('no-NO')} •{' '}
              <UserName username={d.deployer_username} userMappings={userMappings} link={false} /> •{' '}
              {getFourEyesStatusLabel(d.four_eyes_status)}
            </BodyShort>
          </HStack>
        ))}
      </VStack>
    </div>
  )
}

function GenerateAction({
  selectedPeriod,
  existingReportForPeriod,
  supersedeReason,
  onSupersedeReasonChange,
  isGeneratingReport,
  pendingJobId,
}: {
  selectedPeriod: ReportPeriod | undefined
  existingReportForPeriod: AuditReportSummary | undefined
  supersedeReason: string
  onSupersedeReasonChange: (reason: string) => void
  isGeneratingReport: boolean
  pendingJobId: string | null
}) {
  return (
    <VStack gap="space-12">
      {existingReportForPeriod && (
        <Alert variant="warning" size="small">
          <VStack gap="space-8">
            <BodyShort size="small" weight="semibold">
              Det finnes allerede en rapport for {selectedPeriod?.label}
            </BodyShort>
            <BodyShort size="small">
              Eksisterende rapport ({existingReportForPeriod.report_id}) vil bli markert som erstattet. Du må oppgi en
              begrunnelse for hvorfor rapporten genereres på nytt.
            </BodyShort>
            <Textarea
              label="Begrunnelse for ny rapport"
              name="supersede_reason"
              value={supersedeReason}
              onChange={(e) => onSupersedeReasonChange(e.target.value)}
              description="Forklar hvorfor rapporten må genereres på nytt"
              size="small"
              minRows={2}
            />
          </VStack>
        </Alert>
      )}

      <div>
        <Button
          type="submit"
          name="action"
          value="generate_report"
          variant="primary"
          size="small"
          loading={(isGeneratingReport && !pendingJobId) || !!pendingJobId}
          disabled={!!pendingJobId || (!!existingReportForPeriod && !supersedeReason.trim())}
        >
          {pendingJobId ? 'Genererer...' : existingReportForPeriod ? 'Erstatt rapport' : 'Generer rapport'}
        </Button>
      </div>
    </VStack>
  )
}
