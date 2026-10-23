import { Document, Link, Page, renderToBuffer, Text, View } from '@react-pdf/renderer'
import { registerAuditReportFonts } from './audit-report-pdf/fonts'
import { styles } from './audit-report-pdf/styles'
import {
  buildRepositoryReportSections,
  buildRepositoryReportSummary,
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

function RepositoryReportHeader({ subtitle, fixed = false }: { subtitle: string; fixed?: boolean }) {
  return (
    <View
      style={fixed ? [styles.header, { position: 'absolute', top: 40, left: 40, right: 40 }] : styles.header}
      fixed={fixed}
    >
      <Text style={styles.title}>RAPPORT OM ETTERLEVELSE</Text>
      <Text style={styles.subtitle}>Leveranser · Repositorybasert vurdering · {subtitle}</Text>
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
      <RepositoryReportHeader subtitle="Sammendrag" />
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
      <RepositoryReportHeader subtitle="Vurderingsgrunnlag" />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Slik vurderes leveransen</Text>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>A. Avgrensning av kodeleveransen</Text>
          <Text style={styles.methodologyText}>
            En leveranse er avgrenset av lagret base- og head-SHA for repositoryet. Base er eksklusiv og head er
            inklusiv. Hver unik kodeleveranse vurderes én gang; deployments viser hvilke utrullinger som bruker den.
          </Text>
        </View>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>B. Kodedekning</Text>
          <Text style={styles.methodologyText}>
            Commits i intervallet må ha dokumentert dekning gjennom godkjent pull request eller gyldig manuell
            godkjenning. Ufullstendig GitHub-historikk, ukjent identitet eller manglende godkjenning gir ikke full
            dekning.
          </Text>
          <Text style={styles.methodologyText}>For pull request-godkjenning gjelder fireøyne-prinsippet:</Text>
          <Text style={styles.methodologyText}>• PR-en må være godkjent av minst én annen person.</Text>
          <Text style={styles.methodologyText}>• Godkjenningen må være gitt etter siste relevante commit.</Text>
          <Text style={styles.methodologyText}>• Siste commit-forfatter kan ikke være godkjenneren.</Text>
          <Text style={styles.methodologyText}>
            Repositoryets innstilling for implisitt godkjenning kan godkjenne PR-er som oppfyller konfigurert regelverk;
            innstillingen vises i kodeleveransens evidens.
          </Text>
        </View>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>C. Deploymentkilde og repositorytillatelse</Text>
          <Text style={styles.methodologyText}>
            Rapporten kontrollerer applikasjonens repositorykobling og lagret workflow-run-kilde. Workflowens branch,
            trigger og snapshot må samsvare med deploymentets repository, run og commit. Ukjent eller avvikende
            kildegrunnlag blokkerer godkjenning.
          </Text>
        </View>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>D. Manuell etterkontroll</Text>
          <Text style={styles.methodologyText}>
            Manuelle godkjenninger viser både tidspunktet kontrollen ble utført og tidspunktet den ble registrert.
            Tilbakekalt eller identitetsutdatert historikk vises som sporbarhet, men teller ikke som gyldig dekning.
          </Text>
        </View>
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyTitle}>E. Baseline</Text>
          <Text style={styles.methodologyText}>
            Et tomt intervall der base og head er like dokumenterer ikke godkjenning av tidligere kode. Slike tilfeller
            krever avklart baseline og blokkerer rapportgenerering inntil grunnlaget er avklart.
          </Text>
        </View>
        {testRequirement !== 'none' && (
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>F. Testkrav før leveranse</Text>
            <Text style={styles.methodologyText}>
              {testRequirement === 'unit_tests'
                ? 'Applikasjonen er konfigurert med krav om at enhetstester må være vellykket før en leveranse kan gjennomføres.'
                : testRequirement === 'integration_tests'
                  ? 'Applikasjonen er konfigurert med krav om at integrasjonstester må være vellykket før en leveranse kan gjennomføres.'
                  : `Applikasjonens testkrav er ${testRequirement}.`}
            </Text>
          </View>
        )}
        <Text style={styles.methodologyText}>
          Rapportens modellversjoner: format {reportData.schemaVersion}, verifisering{' '}
          {reportData.verificationSchemaVersion}.
        </Text>
      </View>
      <RepositoryReportFooter props={props} />
      <PageNumber />
    </Page>
  )
}

function VerificationPage({ props }: { props: RepositoryReportOutputProps }) {
  return (
    <Page size="A4" style={pageStyle}>
      <RepositoryReportHeader subtitle="Sikkerhet og dataintegritet" />
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
            '3. Frosset rapportgrunnlag',
            'Normalisert evidens, godkjenningshistorikk, identitetsversjoner og kildereferanser lagres sammen med rapporten. Senere oppdateringer av rådata endrer ikke rapporten.',
          ],
          [
            '4. Etterprøvbarhet',
            'PDF-en inneholder dokument-ID, genereringstidspunkt og SHA256-hash. Excel-vedlegget viser kildesnapshottene som inngår i vurderingen.',
          ],
        ].map(([title, text]) => (
          <View key={title} style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>{title}</Text>
            <Text style={styles.methodologyText}>{text}</Text>
          </View>
        ))}
        <View style={styles.methodologyBox}>
          <Text style={styles.methodologyText}>Datagrunnlag hentet fra:</Text>
          <Text style={styles.methodologyText}>• Nais Console API (deployments)</Text>
          <Text style={styles.methodologyText}>
            • Lagrede GitHub-snapshots (commits, pull requests, reviews og workflow runs)
          </Text>
          <Text style={styles.methodologyText}>
            • Intern database (repositorykoblinger, identiteter og manuelle godkjenninger)
          </Text>
        </View>
      </View>
      <RepositoryReportFooter props={props} />
      <PageNumber />
    </Page>
  )
}

function EvidenceTables({ props, sections }: { props: RepositoryReportOutputProps; sections: ReportSection[] }) {
  return sections.map((section) => {
    const widths = columnWidths(section)
    return (
      <Page key={section.title} size="A4" style={[pageStyle, { paddingTop: 120, paddingBottom: 100 }]}>
        <RepositoryReportHeader subtitle={section.title} fixed />
        <Text style={[styles.methodologyText, { marginBottom: 10 }]}>
          {REPOSITORY_REPORT_SECTION_INTRODUCTIONS[section.title] ?? 'Evidens i repositorybasert rapportgrunnlag.'}
        </Text>
        <Text style={[styles.methodologyText, { marginBottom: 10 }]}>
          Lange celleverdier forkortes i PDF-en. Full tekst finnes i Excel-vedlegget.
        </Text>
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            {section.headers.map((header, index) => (
              <Text key={header} style={[styles.tableHeaderCell, { width: `${widths[index]}%` }]}>
                {header}
              </Text>
            ))}
          </View>
          {section.rows.map((row, rowIndex) => (
            <View key={JSON.stringify(row)} style={[styles.tableRow, rowIndex % 2 === 1 ? styles.tableRowAlt : {}]}>
              {row.map((value, columnIndex) => (
                <Text
                  key={section.headers[columnIndex]}
                  style={[styles.tableCell, { width: `${widths[columnIndex]}%`, paddingRight: 5 }]}
                >
                  {section.cellLinks?.[rowIndex]?.[columnIndex] &&
                  isHttpUrl(section.cellLinks[rowIndex][columnIndex]) ? (
                    <Link src={section.cellLinks[rowIndex][columnIndex]} style={styles.link}>
                      {formatPdfCell(value, section.headers[columnIndex]) || '—'}
                    </Link>
                  ) : (
                    formatPdfCell(value, section.headers[columnIndex]) || '—'
                  )}
                </Text>
              ))}
            </View>
          ))}
        </View>
        <RepositoryReportFooter props={props} />
        <PageNumber />
      </Page>
    )
  })
}

function columnWidths(section: ReportSection): number[] {
  const widths: Record<string, number[]> = {
    Deployments: [18, 24, 13, 20, 25],
    Kodeleveranser: [15, 22, 63],
    Commits: [10, 17, 24, 39, 10],
    'PR-evidens': [12, 22, 22, 25, 19],
    'Manuell historikk': [12, 22, 20, 20, 26],
    Kilder: [12, 25, 63],
    Identiteter: [12, 24, 16, 20, 28],
    Avvik: [16, 18, 40, 26],
  }
  return widths[section.title] ?? section.headers.map(() => 100 / section.headers.length)
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
      <EvidenceTables
        props={props}
        sections={sections.filter((section) => section.title !== 'Sammendrag' && section.rows.length > 0)}
      />
    </Document>
  )
}

export async function generateRepositoryAuditReportPdf(props: RepositoryReportOutputProps): Promise<Buffer> {
  const summary = buildRepositoryReportSummary(props)
  const sections = buildRepositoryReportSections(props, summary)
  return renderToBuffer(createRepositoryAuditReportDocument(props, sections, summary))
}
