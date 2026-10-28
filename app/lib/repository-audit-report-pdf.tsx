import { Document, Link, Page, renderToBuffer, Text, View } from '@react-pdf/renderer'
import { registerAuditReportFonts } from './audit-report-pdf/fonts'
import { styles } from './audit-report-pdf/styles'
import {
  buildRepositoryDeploymentApproval,
  buildRepositoryReportSections,
  buildRepositoryReportSummary,
  filterRepositoryReportSectionsForExport,
  formatRepositoryReportDate,
  formatRepositoryReportDateTime,
  isHttpUrl,
  REPOSITORY_REPORT_INTRO,
  REPOSITORY_REPORT_SECTION_INTRODUCTIONS,
  type ReportSection,
  type RepositoryReportOutputProps,
} from './repository-audit-report-output'

registerAuditReportFonts()

const pageStyle = process.env.NODE_ENV === 'test' ? { ...styles.page, fontFamily: 'Helvetica' } : styles.page

function RepositoryReportHeader({ subtitle }: { subtitle: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>RAPPORT OM ETTERLEVELSE</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  )
}

function PageNumber() {
  return (
    <Text
      style={styles.pageNumber}
      fixed
      render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
    />
  )
}

function RepositoryReportFooter({ props }: { props: RepositoryReportOutputProps }) {
  return (
    <View style={[styles.footer, { right: 80 }]} fixed>
      <Text style={styles.footerText}>
        {props.appName} | Generert {formatRepositoryReportDateTime(props.generatedAt)} | Deployment Audit System
      </Text>
      <Text style={styles.hashText}>SHA256: {props.contentHash}</Text>
    </View>
  )
}

function CoverPage({
  props,
  summary,
}: {
  props: RepositoryReportOutputProps
  summary: ReturnType<typeof buildRepositoryReportSummary>
}) {
  const { reportData } = props
  const metadata = new Map(summary.metadata)

  return (
    <Page size="A4" style={pageStyle}>
      <RepositoryReportHeader subtitle="Leveranser" />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dokumentinformasjon</Text>
        <View style={styles.infoGrid}>
          {[
            ['Applikasjon', metadata.get('Applikasjon') ?? 'Ukjent'],
            ['Repository', metadata.get('Repository') ?? 'Ukjent'],
            ['Team', metadata.get('Team') ?? 'Ukjent'],
            ['Miljø', metadata.get('Miljø') ?? 'Ukjent'],
            ['Periode', metadata.get('Periode') ?? 'Ukjent'],
            ['Dokument-ID', metadata.get('Dokument-ID') ?? 'Ukjent'],
          ].map(([label, value]) => (
            <View key={label} style={styles.infoItem}>
              <Text style={styles.infoLabel}>{label}</Text>
              <Text style={styles.infoValue}>{value}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryTitle}>Sammendrag</Text>
        {summary.values.map(([label, value]) => (
          <View key={label} style={styles.summaryRow}>
            <Text style={label === 'Status' ? styles.statusApproved : styles.summaryLabel}>
              {label === 'Status' ? value : `${label}:`}
            </Text>
            {label !== 'Status' && <Text style={styles.summaryValue}>{value}</Text>}
          </View>
        ))}
      </View>
      <View style={styles.methodologyBox}>
        <Text style={styles.methodologyTitle}>Om rapporten</Text>
        <Text style={styles.methodologyText}>{REPOSITORY_REPORT_INTRO}</Text>
        <Text style={styles.methodologyText}>
          Vurderingen bygger på lagret kildegrunnlag på genereringstidspunktet, inkludert eventuell etterkontroll. Den
          dokumenterer ikke at godkjenningen forelå før deployment.
        </Text>
      </View>
      <View style={styles.methodologyBox}>
        <Text style={styles.methodologyTitle}>Vurderingsgrunnlag</Text>
        {summary.context.map(([label, value]) => (
          <View key={label} style={{ marginBottom: 6 }}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.methodologyText}>{value}</Text>
          </View>
        ))}
      </View>
      {reportData.deployments.length === 0 && (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>Ingen deployments i perioden</Text>
          <Text style={styles.noticeText}>
            Ingen produksjonsendringer ble registrert for denne applikasjonen i perioden{' '}
            {formatRepositoryReportDate(props.periodStart)} - {formatRepositoryReportDate(props.periodEnd)}.
          </Text>
        </View>
      )}
      <RepositoryReportFooter props={props} />
      <PageNumber />
    </Page>
  )
}

function MethodologyPage({ props }: { props: RepositoryReportOutputProps }) {
  const { reportData } = props
  const testRequirement = reportData.app.testRequirement ?? 'none'
  return (
    <Page size="A4" style={pageStyle}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Godkjenningsmetoder (fire øyne-prinsipp)</Text>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>A. Pull request-godkjenning</Text>
          <Text style={styles.methodologyText}>
            • Pull request må være godkjent av minst én annen person enn siste relevante commit-forfatter.
          </Text>
          <Text style={styles.methodologyText}>
            • Godkjenningen må gjelde siste relevante commit. Godkjenninger før senere commits teller ikke.
          </Text>
          <Text style={styles.methodologyText}>
            • Godkjente stacked pull requests kan dekke commits når stacken når default branch. Konfigurert implisitt
            godkjenning vises i kodeleveransens evidens.
          </Text>
        </View>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>B. Manuell godkjenning (etterkontroll)</Text>
          <Text style={styles.methodologyText}>
            • En manuell kontroll må dekke kodeintervallet og være knyttet til godkjennerens registrerte identitet.
          </Text>
          <Text style={styles.methodologyText}>
            • Kontrolltidspunkt, registreringstidspunkt og dokumentasjon vises. Tilbakekalt eller endret historikk
            teller ikke som gyldig dekning.
          </Text>
        </View>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>C. Repositorybasert kodeleveranse</Text>
          <Text style={styles.methodologyText}>
            En kodeleveranse er avgrenset av lagret base- og head-SHA. Base er eksklusiv og head er inklusiv. Hver
            kodeleveranse vurderes én gang, selv om flere deployments bruker den. Commits må ha full dekning fra
            godkjent pull request eller gyldig manuell godkjenning.
          </Text>
        </View>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>D. Deploymentkilde og repositorytillatelse</Text>
          <Text style={styles.methodologyText}>
            Workflowens repository, branch, trigger, run og snapshot må samsvare med deploymentet. Repositoryet må være
            tillatt for applikasjonen, og deploymentet må komme fra default branch. Ukjent eller avvikende kildegrunnlag
            blokkerer rapportgenerering.
          </Text>
        </View>
        {testRequirement !== 'none' && (
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>E. Testkrav før leveranse</Text>
            <Text style={styles.methodologyText}>
              {testRequirement === 'unit_tests'
                ? 'Applikasjonen er konfigurert med krav om at enhetstester må være vellykket før en leveranse kan gjennomføres.'
                : testRequirement === 'integration_tests'
                  ? 'Applikasjonen er konfigurert med krav om at integrasjonstester må være vellykket før en leveranse kan gjennomføres.'
                  : `Applikasjonens testkrav er ${testRequirement}.`}
            </Text>
          </View>
        )}
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>F. Baseline</Text>
          <Text style={styles.methodologyText}>
            Et tomt kodeintervall dokumenterer ikke godkjenning av tidligere kode. Baseline eller kodeintervaller uten
            endringer må avklares separat og kan ikke brukes som godkjent kodeleveranse i denne rapporten.
          </Text>
        </View>
      </View>
      <RepositoryReportFooter props={props} />
      <PageNumber />
    </Page>
  )
}

function VerificationPage({ props }: { props: RepositoryReportOutputProps }) {
  return (
    <Page size="A4" style={pageStyle}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sikkerhet og dataintegritet</Text>
        {[
          [
            '1. Repositoryidentitet',
            'Repository kobles med uforanderlig GitHub-ID. Historiske deployments erstattes ikke med applikasjonens nåværende repository.',
          ],
          [
            '2. Lagret deploymentkilde',
            'Workflow-run-snapshot må samsvare med repository-ID, run-ID og full commit-SHA. Run-forsøk kontrolleres når det er angitt i deploymentets kilde-URL.',
          ],
          [
            '3. Lagret rapport',
            'Rapportgrunnlaget lagres sammen med genererte PDF- og Excel-filer, rapportmetadata og hash av rapportgrunnlaget. Senere oppdateringer av kildedata endrer ikke det lagrede rapportgrunnlaget eller rapportfilene.',
          ],
          [
            '4. Etterprøvbarhet',
            'PDF-en inneholder dokument-ID, genereringstidspunkt og SHA256-hash. Lenkene i deploymenttabellen åpner repositoryvisningen for videre oppfølging. Visningen viser gjeldende vurdering, som kan endres etter rapportgenerering.',
          ],
        ].map(([title, text]) => (
          <View key={title} style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>{title}</Text>
            <Text style={styles.methodologyText}>{text}</Text>
          </View>
        ))}
      </View>
      <RepositoryReportFooter props={props} />
      <PageNumber />
    </Page>
  )
}

function DataSourcesPage({ props }: { props: RepositoryReportOutputProps }) {
  return (
    <Page size="A4" style={pageStyle}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verifisering</Text>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyText}>
            Dette dokumentet er generert automatisk av Deployment Audit System. Rapporten viser vurderingen på
            genereringstidspunktet, og senere endringer i kildedata påvirker ikke dokumentet.
          </Text>
          <Text style={styles.methodologyText}>Datagrunnlag hentet fra:</Text>
          <Text style={styles.methodologyText}>• Nais Console API (deployments)</Text>
          <Text style={styles.methodologyText}>
            • Lagrede GitHub-snapshots (repositories, commits, pull requests, reviews, workflow runs og
            stack-sammenligninger)
          </Text>
          <Text style={styles.methodologyText}>
            • Intern database (repositorykoblinger, identiteter, manuelle godkjenninger og avvik)
          </Text>
          <Text style={[styles.methodologyText, { marginTop: 8 }]}>
            Rapportens modellversjoner: format {props.reportData.schemaVersion}, verifisering{' '}
            {props.reportData.verificationSchemaVersion}. Data kan verifiseres mot originalkildene ved behov.
          </Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>Dokument-ID: {props.reportId}</Text>
        <Text style={styles.hashText}>SHA256: {props.contentHash}</Text>
      </View>
      <PageNumber />
    </Page>
  )
}

function repositoryMonthKey(date: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(date))
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  return `${year}-${month}`
}

function repositoryMonthName(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('nb-NO', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
}

function DeploymentPages({ props, sections }: { props: RepositoryReportOutputProps; sections: ReportSection[] }) {
  const section = sections.find((item) => item.title === 'Deployments')
  if (!section) return null
  const deployments = props.reportData.deployments.flatMap((deployment, index) => {
    const row = section.rows[index]
    return row ? [{ deployment, row, index }] : []
  })
  const deploymentsByMonth = new Map<string, typeof deployments>()
  for (const item of deployments) {
    const monthKey = repositoryMonthKey(item.deployment.createdAt)
    const monthDeployments = deploymentsByMonth.get(monthKey) ?? []
    monthDeployments.push(item)
    deploymentsByMonth.set(monthKey, monthDeployments)
  }
  let runningTotal = 0

  return Array.from(deploymentsByMonth.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthKey, monthDeployments]) => {
      const monthOffset = runningTotal
      runningTotal += monthDeployments.length
      return (
        <Page key={monthKey} size="A4" style={[pageStyle, { paddingBottom: 100 }]}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Deployments - {repositoryMonthName(monthKey)} ({monthDeployments.length} stk)
            </Text>
            <View style={styles.table}>
              <View style={styles.tableHeader} fixed>
                <Text style={[styles.tableHeaderCell, styles.r1col1]}>#</Text>
                <Text style={[styles.tableHeaderCell, styles.r1col2]}>Dato</Text>
                <Text style={[styles.tableHeaderCell, styles.r1col3]}>Tittel</Text>
              </View>
              <View
                style={[
                  styles.tableHeader,
                  { borderTopLeftRadius: 0, borderTopRightRadius: 0, backgroundColor: '#F0EDEB' },
                ]}
                fixed
              >
                <Text style={[styles.tableHeaderCell, styles.r2col1]} />
                <Text style={[styles.tableHeaderCell, styles.r2col2]}>Commit</Text>
                <Text style={[styles.tableHeaderCell, styles.r2col3]}>Metode</Text>
                <Text style={[styles.tableHeaderCell, styles.r2col4]}>Referanse</Text>
                <Text style={[styles.tableHeaderCell, styles.r2col5]}>PR-forf.</Text>
                <Text style={[styles.tableHeaderCell, styles.r2col6]}>Deployer</Text>
                <Text style={[styles.tableHeaderCell, styles.r2col7]}>Godkjenner</Text>
                <Text style={[styles.tableHeaderCell, styles.r2col8]}>Nais ID</Text>
              </View>
              {monthDeployments.map(({ deployment, row, index }, monthIndex) => {
                const deploymentDate = formatRepositoryReportDate(deployment.createdAt)
                const [deploymentTitle, ...changeOriginLines] = row[1].split('\n')
                const changeOrigin = changeOriginLines.join('\n')
                const commitSha = deployment.commitSha
                const approval = buildRepositoryDeploymentApproval(props.reportData, deployment.deliveryId)
                const deploymentUrl = section.cellLinks?.[index]?.[0]
                const commitUrl = section.cellLinks?.[index]?.[2]
                return (
                  <View
                    key={deployment.id}
                    style={[styles.deploymentCard, monthIndex % 2 === 1 ? styles.deploymentCardAlt : {}]}
                  >
                    <View style={styles.deploymentRow1}>
                      <Text style={[styles.tableCell, styles.r1col1]}>
                        {deploymentUrl && isHttpUrl(deploymentUrl) ? (
                          <Link src={deploymentUrl} style={styles.link}>
                            {String(monthOffset + monthIndex + 1)}
                          </Link>
                        ) : (
                          String(monthOffset + monthIndex + 1)
                        )}
                      </Text>
                      <Text style={[styles.tableCell, styles.r1col2]}>{deploymentDate}</Text>
                      <Text style={[styles.tableCell, styles.r1col3, { fontWeight: 600 }]}>
                        {deploymentTitle || 'Ukjent'}
                        {'\n'}
                        <Text style={{ fontSize: 6, color: '#888888', fontWeight: 400 }}>
                          Deployment-ID {deployment.id}
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.deploymentRow2}>
                      <Text style={styles.r2col1} />
                      <Text style={[styles.tableCell, styles.r2col2]}>
                        {commitSha && commitUrl && isHttpUrl(commitUrl) ? (
                          <Link src={commitUrl} style={styles.link}>
                            {commitSha.slice(0, 7)}
                          </Link>
                        ) : (
                          'Ukjent'
                        )}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col3]}>{approval.method}</Text>
                      <Text style={[styles.tableCell, styles.r2col4]}>
                        {approval.references.map((reference, referenceIndex) => (
                          <Text key={reference.label}>
                            {referenceIndex > 0 ? '\n' : ''}
                            {reference.url ? (
                              <Link src={reference.url} style={styles.link}>
                                {reference.label}
                              </Link>
                            ) : (
                              reference.label
                            )}
                          </Text>
                        ))}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col5]}>{approval.authors}</Text>
                      <Text style={[styles.tableCell, styles.r2col6]}>
                        {row[0].split('\n')[2]?.replace('Deployer: ', '') ?? 'Ukjent'}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col7]}>{approval.approvers}</Text>
                      <Text style={[styles.tableCell, styles.r2col8, { fontSize: 6, color: '#888888' }]}>
                        {deployment.naisDeploymentId}
                      </Text>
                    </View>
                    {changeOrigin && (
                      <View style={styles.deploymentRow3}>
                        <Text style={styles.r2col1} />
                        <Text style={[styles.tableCell, { width: '95%', fontStyle: 'italic', color: '#595959' }]}>
                          {changeOrigin}
                        </Text>
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          </View>
          <RepositoryReportFooter props={props} />
          <PageNumber />
        </Page>
      )
    })
}

function EvidenceCards({
  props,
  section,
  title,
  introduction,
}: {
  props: RepositoryReportOutputProps
  section: ReportSection | undefined
  title: string
  introduction: string
}) {
  if (!section || section.rows.length === 0) return null
  return (
    <Page size="A4" style={[pageStyle, { paddingBottom: 100 }]}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {title} ({section.rows.length})
        </Text>
        <Text style={{ fontSize: 9, color: '#595959', marginBottom: 10 }}>{introduction}</Text>
        {section.rows.map((row, rowIndex) => (
          <View key={JSON.stringify(row)} style={styles.manualBox}>
            {row.map((value, columnIndex) => {
              const url = section.cellLinks?.[rowIndex]?.[columnIndex]
              const displayValue = formatPdfCell(value, section.headers[columnIndex])
              return (
                <View key={section.headers[columnIndex]}>
                  <Text style={columnIndex === 0 ? styles.manualTitle : styles.manualDetail}>
                    {columnIndex === 0
                      ? `${section.title === 'Manuell historikk' ? 'Kodeleveranse' : 'Deployment'} `
                      : `${section.headers[columnIndex]}: `}
                    {url && isHttpUrl(url) ? (
                      <Link src={url} style={styles.link}>
                        {displayValue}
                      </Link>
                    ) : (
                      displayValue
                    )}
                  </Text>
                </View>
              )
            })}
          </View>
        ))}
      </View>
      <RepositoryReportFooter props={props} />
      <PageNumber />
    </Page>
  )
}

function formatPdfCell(value: string, header: string): string {
  const displayValue = header.toLowerCase().includes('sha')
    ? value.replaceAll(/[0-9a-f]{40}/gi, (sha) => `${sha.slice(0, 12)}…`)
    : value
  return displayValue.length > 600 ? `${displayValue.slice(0, 600)}… (forkortet; se Excel)` : displayValue
}

function createRepositoryAuditReportDocument(
  props: RepositoryReportOutputProps,
  sections: ReturnType<typeof buildRepositoryReportSections>,
  summary: ReturnType<typeof buildRepositoryReportSummary>,
) {
  return (
    <Document title={`Repositorybasert leveranserapport – ${props.appName}`} author="Deployment Audit System">
      <CoverPage props={props} summary={summary} />
      <MethodologyPage props={props} />
      <VerificationPage props={props} />
      <DataSourcesPage props={props} />
      <DeploymentPages props={props} sections={sections} />
      <EvidenceCards
        props={props}
        section={sections.find((section) => section.title === 'Manuell historikk')}
        title="Godkjenninger i NDA"
        introduction={REPOSITORY_REPORT_SECTION_INTRODUCTIONS['Manuell historikk']}
      />
      <EvidenceCards
        props={props}
        section={sections.find((section) => section.title === 'Avvik')}
        title="Avvik"
        introduction={REPOSITORY_REPORT_SECTION_INTRODUCTIONS.Avvik}
      />
    </Document>
  )
}

export async function generateRepositoryAuditReportPdf(props: RepositoryReportOutputProps): Promise<Buffer> {
  const summary = buildRepositoryReportSummary(props)
  const sections = filterRepositoryReportSectionsForExport(buildRepositoryReportSections(props, summary))
  return renderToBuffer(createRepositoryAuditReportDocument(props, sections, summary))
}
