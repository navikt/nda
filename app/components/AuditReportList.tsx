import { BodyShort, Box, Button, Detail, HStack, Label, Modal, Textarea, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher } from 'react-router'

export interface AuditReportItem {
  id: number
  report_id: string
  period_label: string
  archived_at: Date | null
  archived_by: string | null
  archive_reason: string | null
  superseded_at: Date | null
  superseded_by: string | null
  supersede_reason: string | null
}

interface AuditReportListProps {
  reports: AuditReportItem[]
  appId?: number
  showArchiveActions?: boolean
  displayNameMap?: Record<string, string>
}

export function AuditReportList({
  reports,
  appId,
  showArchiveActions = false,
  displayNameMap = {},
}: AuditReportListProps) {
  if (reports.length === 0) return null

  return (
    <VStack gap="space-8">
      <Label>Eksisterende rapporter</Label>
      <VStack gap="space-4">
        {reports.map((report) => {
          const isInactive = !!report.archived_at || !!report.superseded_at
          return (
            <Box
              key={report.id}
              padding="space-12"
              borderRadius="4"
              background={isInactive ? 'neutral-moderate' : 'default'}
              style={isInactive ? { opacity: 0.6 } : undefined}
            >
              <VStack gap="space-4">
                <HStack gap="space-16" align="center" wrap>
                  <BodyShort weight="semibold">{report.period_label}</BodyShort>
                  <Detail textColor="subtle">{report.report_id}</Detail>
                  <HStack gap="space-8">
                    <Link to={`/admin/audit-reports/${report.id}/view`} target="_blank">
                      Vis
                    </Link>
                    <Link to={`/admin/audit-reports/${report.id}/pdf`} target="_blank">
                      Last ned
                    </Link>
                  </HStack>
                  {showArchiveActions &&
                    !report.superseded_at &&
                    (report.archived_at ? (
                      <Form method="post">
                        <input type="hidden" name="action" value="restore_report" />
                        <input type="hidden" name="report_id" value={report.id} />
                        {appId != null && <input type="hidden" name="app_id" value={appId} />}
                        <Button type="submit" size="xsmall" variant="tertiary">
                          Gjenopprett
                        </Button>
                      </Form>
                    ) : (
                      <ArchiveReportButton reportId={report.id} appId={appId} />
                    ))}
                </HStack>
                {report.superseded_at && (
                  <Detail textColor="subtle">
                    Erstattet
                    {report.superseded_by
                      ? ` av ${displayNameMap[report.superseded_by.toUpperCase()] ?? report.superseded_by}`
                      : ''}
                    {report.supersede_reason ? `: ${report.supersede_reason}` : ''}
                  </Detail>
                )}
                {report.archived_at && !report.superseded_at && (
                  <Detail textColor="subtle">
                    Arkivert
                    {report.archived_by
                      ? ` av ${displayNameMap[report.archived_by.toUpperCase()] ?? report.archived_by}`
                      : ''}
                    : {report.archive_reason}
                  </Detail>
                )}
              </VStack>
            </Box>
          )
        })}
      </VStack>
    </VStack>
  )
}

function ArchiveReportButton({ reportId, appId }: { reportId: number; appId?: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const fetcher = useFetcher()

  useEffect(() => {
    if (fetcher.data && 'success' in fetcher.data) {
      dialogRef.current?.close()
      setReason('')
    }
  }, [fetcher.data])

  return (
    <>
      <Button type="button" size="xsmall" variant="tertiary-neutral" onClick={() => dialogRef.current?.showModal()}>
        Arkiver
      </Button>
      <Modal ref={dialogRef} header={{ heading: 'Arkiver rapport' }} closeOnBackdropClick>
        <Modal.Body>
          <fetcher.Form method="post">
            <input type="hidden" name="action" value="archive_report" />
            <input type="hidden" name="report_id" value={reportId} />
            {appId != null && <input type="hidden" name="app_id" value={appId} />}
            <VStack gap="space-16">
              <Textarea
                label="Begrunnelse for arkivering"
                name="archive_reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                description="Forklar hvorfor rapporten arkiveres"
                minRows={2}
              />
              <Modal.Footer>
                <Button
                  type="submit"
                  variant="danger"
                  size="small"
                  disabled={!reason.trim()}
                  loading={fetcher.state === 'submitting'}
                >
                  Arkiver
                </Button>
                <Button variant="secondary" size="small" type="button" onClick={() => dialogRef.current?.close()}>
                  Avbryt
                </Button>
              </Modal.Footer>
            </VStack>
          </fetcher.Form>
        </Modal.Body>
      </Modal>
    </>
  )
}
