import { join } from 'node:path'
import { Document, Font, Link, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer'
import type {
  AuditReportData,
  DeviationEntry,
  ManualApprovalEntry,
  UnverifiedCommitDeploymentEntry,
} from '~/db/audit-reports.server'
import {
  DEVIATIONS_INTRO,
  MANUAL_APPROVALS_INTRO,
  UNVERIFIED_COMMITS_INTRO_PDF,
  UNVERIFIED_COMMITS_NOTE,
} from '~/lib/audit-report-texts'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
  type DeviationFollowUpRole,
  type DeviationIntent,
  type DeviationSeverity,
} from '~/lib/deviation-constants'
import { formatPercentages } from '~/lib/format-percentages'

const fontBasePath =
  typeof window === 'undefined' && process.env.NODE_ENV === 'production' ? join(process.cwd(), 'fonts') : null

Font.register({
  family: 'Source Sans Pro',
  fonts: [
    {
      src: fontBasePath
        ? join(fontBasePath, 'source-sans-3-regular.ttf')
        : 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-400-normal.ttf',
      fontWeight: 400,
    },
    {
      src: fontBasePath
        ? join(fontBasePath, 'source-sans-3-italic.ttf')
        : 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-400-italic.ttf',
      fontWeight: 400,
      fontStyle: 'italic',
    },
    {
      src: fontBasePath
        ? join(fontBasePath, 'source-sans-3-semibold.ttf')
        : 'https://cdn.jsdelivr.net/fontsource/fonts/source-sans-pro@latest/latin-600-normal.ttf',
      fontWeight: 600,
    },
  ],
})

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Source Sans Pro',
    fontSize: 10,
    padding: 40,
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 20,
    borderBottom: '2px solid #005B82',
    paddingBottom: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 600,
    color: '#005B82',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    color: '#262626',
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#005B82',
    marginBottom: 8,
    borderBottom: '1px solid #C6C2BF',
    paddingBottom: 4,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  infoItem: {
    width: '50%',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 9,
    color: '#595959',
  },
  infoValue: {
    fontSize: 10,
    fontWeight: 600,
  },
  summaryBox: {
    backgroundColor: '#E6F0F5',
    padding: 15,
    borderRadius: 4,
    marginBottom: 15,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 10,
    color: '#005B82',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 10,
  },
  summaryValue: {
    fontSize: 10,
    fontWeight: 600,
  },
  statusApproved: {
    color: '#06893A',
    fontSize: 14,
    fontWeight: 600,
  },
  noticeBox: {
    backgroundColor: '#FFF4E0',
    padding: 12,
    borderRadius: 4,
    borderLeft: '3px solid #D47500',
    marginBottom: 15,
  },
  noticeTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: '#D47500',
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 9,
    color: '#262626',
    marginBottom: 4,
    lineHeight: 1.4,
  },
  table: {
    marginBottom: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#E6E3E1',
    padding: 6,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: 600,
    color: '#262626',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 6,
    borderBottom: '1px solid #E6E3E1',
  },
  tableRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  deploymentCard: {
    borderBottom: '1px solid #E6E3E1',
    padding: 6,
  },
  deploymentCardAlt: {
    backgroundColor: '#FAFAFA',
  },
  deploymentRow1: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  deploymentRow2: {
    flexDirection: 'row',
  },
  deploymentRow3: {
    flexDirection: 'row',
    marginTop: 2,
  },
  tableCell: {
    fontSize: 8,
  },
  r1col1: { width: '5%' },
  r1col2: { width: '8%' },
  r1col3: { width: '87%' },
  r2col1: { width: '5%' },
  r2col2: { width: '8%' },
  r2col3: { width: '8%' },
  r2col4: { width: '10%' },
  r2col5: { width: '14%' },
  r2col6: { width: '14%' },
  r2col7: { width: '14%' },
  r2col8: { width: '27%' },
  manualBox: {
    backgroundColor: '#FFF4E0',
    padding: 10,
    borderRadius: 4,
    marginBottom: 8,
    borderLeft: '3px solid #D47500',
  },
  manualTitle: {
    fontSize: 9,
    fontWeight: 600,
    marginBottom: 4,
  },
  manualDetail: {
    fontSize: 8,
    marginBottom: 2,
  },
  contributorTable: {
    marginBottom: 10,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTop: '1px solid #C6C2BF',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#595959',
  },
  hashText: {
    fontSize: 7,
    fontFamily: 'Courier',
    color: '#595959',
    marginTop: 5,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 30,
    right: 40,
    fontSize: 8,
    color: '#595959',
  },
  methodologyBox: {
    backgroundColor: '#F5F5F5',
    padding: 12,
    borderRadius: 4,
    marginBottom: 10,
  },
  methodologyTitle: {
    fontSize: 10,
    fontWeight: 600,
    marginBottom: 6,
  },
  methodologyText: {
    fontSize: 9,
    lineHeight: 1.4,
    marginBottom: 4,
  },
  link: {
    color: '#005B82',
    textDecoration: 'underline',
  },
})

interface AuditReportPdfProps {
  appName: string
  repository: string
  teamSlug: string
  environmentName: string
  year: number
  periodLabel?: string
  periodStart: Date
  periodEnd: Date
  reportData: AuditReportData
  contentHash: string
  reportId: string
  generatedAt: Date
  testRequirement?: 'none' | 'unit_tests' | 'integration_tests'
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const year = d.getFullYear()
  return `${day}.${month}.${year}`
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const UNVERIFIED_REASON_LABELS: Record<string, string> = {
  no_pr: 'Ingen PR funnet',
  no_approved_reviews: 'Ingen godkjent review',
  approval_before_last_commit: 'Godkjenning før siste commit',
  pr_not_approved: 'PR ikke godkjent',
}

function formatUnverifiedReason(reason: string): string {
  return UNVERIFIED_REASON_LABELS[reason] || reason
}

export function AuditReportPdfDocument(props: AuditReportPdfProps) {
  const {
    appName,
    repository,
    teamSlug,
    environmentName,
    periodLabel,
    periodStart,
    periodEnd,
    reportData,
    contentHash,
    reportId,
    generatedAt,
    testRequirement,
  } = props

  const totalDeployments = reportData.deployments.length
  const prApprovedCount = reportData.deployments.filter((d) => d.method === 'pr').length
  const manuallyApprovedCount = reportData.deployments.filter((d) => d.method === 'manual').length
  const baselineCount = reportData.deployments.filter((d) => d.method === 'baseline').length
  const legacyCount = reportData.deployments.filter((d) => d.method === 'legacy').length
  const [prDisplay, manualDisplay, baselineDisplay, legacyDisplay] = formatPercentages(
    [prApprovedCount, manuallyApprovedCount, baselineCount, legacyCount],
    totalDeployments,
  )

  const deploymentsByMonth = new Map<string, typeof reportData.deployments>()
  for (const d of reportData.deployments) {
    const date = new Date(d.date)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!deploymentsByMonth.has(monthKey)) {
      deploymentsByMonth.set(monthKey, [])
    }
    deploymentsByMonth.get(monthKey)?.push(d)
  }

  const sortedMonths = Array.from(deploymentsByMonth.keys()).sort()

  const formatMonthName = (monthKey: string) => {
    const [year, month] = monthKey.split('-')
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1)
    return date.toLocaleDateString('no-NO', { month: 'long', year: 'numeric' })
  }

  return (
    <Document>
      {/* Page 1: Summary */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>RAPPORT OM ETTERLEVELSE</Text>
          <Text style={styles.subtitle}>Leveranser</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dokumentinformasjon</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Applikasjon</Text>
              <Text style={styles.infoValue}>{appName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Repository</Text>
              <Text style={styles.infoValue}>{repository}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Team</Text>
              <Text style={styles.infoValue}>{teamSlug}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Miljø</Text>
              <Text style={styles.infoValue}>{environmentName}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Periode</Text>
              <Text style={styles.infoValue}>
                {periodLabel ? `${periodLabel} — ` : ''}
                {formatDate(periodStart)} - {formatDate(periodEnd)}
              </Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Dokument-ID</Text>
              <Text style={styles.infoValue}>{reportId}</Text>
            </View>
          </View>
        </View>

        <View style={styles.summaryBox}>
          <Text style={styles.summaryTitle}>Sammendrag</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Status:</Text>
            <Text style={styles.statusApproved}>✓ GODKJENT</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Totalt antall deployments:</Text>
            <Text style={styles.summaryValue}>{totalDeployments}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Via Pull Request:</Text>
            <Text style={styles.summaryValue}>
              {prApprovedCount} ({prDisplay}%)
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Manuelt godkjent:</Text>
            <Text style={styles.summaryValue}>
              {manuallyApprovedCount} ({manualDisplay}%)
            </Text>
          </View>
          {legacyCount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Legacy (se forklaring):</Text>
              <Text style={styles.summaryValue}>
                {legacyCount} ({legacyDisplay}%)
              </Text>
            </View>
          )}
          {baselineCount > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Baseline (se forklaring):</Text>
              <Text style={styles.summaryValue}>
                {baselineCount} ({baselineDisplay}%)
              </Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Unike bidragsytere:</Text>
            <Text style={styles.summaryValue}>{reportData.contributors.length} personer</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Unike reviewers:</Text>
            <Text style={styles.summaryValue}>{reportData.reviewers.length} personer</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Generert: {formatDateTime(generatedAt)} | Deployment Audit System</Text>
          <Text style={styles.hashText}>SHA256: {contentHash}</Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
        />
      </Page>

      {/* Godkjenningsmetoder page */}
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Godkjenningsmetoder (fire øyne-prinsipp)</Text>
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>A. Pull Request-godkjenning</Text>
            <Text style={styles.methodologyText}>• PR må være godkjent (approved) av minst én annen person</Text>
            <Text style={styles.methodologyText}>• Siste commit må være før godkjenning (ingen post-commits)</Text>
            <Text style={styles.methodologyText}>• Siste commit kan ikke være fra reviewer</Text>
          </View>
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>B. Manuell godkjenning (etterkontroll)</Text>
            <Text style={styles.methodologyText}>• Krever kommentar med begrunnelse</Text>
            <Text style={styles.methodologyText}>• Godkjenner og tidspunkt registreres</Text>
          </View>
          {legacyCount > 0 && (
            <View style={styles.methodologyBox}>
              <Text style={styles.methodologyTitle}>C. Legacy deployments ({legacyCount} stk)</Text>
              <Text style={styles.methodologyText}>
                Nais-API-et inneholdt ikke commit-SHA for deployments i januar og enkelte dager i februar 2025. Disse
                deployments er derfor kartlagt manuelt med informasjon fra Slack-kanalen #pensjon-produksjon-deploy.
              </Text>
              <Text style={styles.methodologyText}>
                Kartleggingen er utført med to sett øyne: én person la inn mappingen og en annen bekreftet at den var
                korrekt. Personen som er oppført som godkjenner for disse deployments er den som bekreftet mappingen,
                ikke nødvendigvis den som godkjente selve kodeendringen.
              </Text>
              <Text style={styles.methodologyText}>
                For deployments som er resultat av sammenslåing uten forutgående godkjenning, er det lagt inn
                kommentarer basert på meldinger fra Slack-kanalen #pensjon-merge-uten-godkjenning.
              </Text>
            </View>
          )}
          {baselineCount > 0 && (
            <View style={styles.methodologyBox}>
              <Text style={styles.methodologyTitle}>D. Baseline deployment ({baselineCount} stk)</Text>
              <Text style={styles.methodologyText}>
                En baseline er det første registrerte deploymentet for en applikasjon som ble lagt til i NDA. Det
                markerer startpunktet for revisjonsperioden — kildekoden som applikasjonen allerede kjørte på da
                NDA-overvåking ble aktivert.
              </Text>
              <Text style={styles.methodologyText}>
                Siden et baseline-deployment ikke er et nytt produksjonssett, finnes det ingen tilhørende pull request
                eller review-prosess å verifisere. Deploymentet godkjennes i stedet eksplisitt av en person med
                godkjennerrolle i NDA, som bekrefter at den registrerte versjonen er riktig utgangspunkt for perioden.
                Godkjenneren er oppgitt i «Godkjenner»-kolonnen for dette deploymentet.
              </Text>
            </View>
          )}
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
        />
      </Page>

      {/* Security methodology page */}
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sikkerhet og dataintegritet</Text>

          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>1. Kryptografisk verifisert deploy-kjede</Text>
            <Text style={styles.methodologyText}>
              Alle deployments til Nais-plattformen krever et OIDC-token utstedt av GitHub Actions. Dette tokenet er
              kryptografisk signert med GitHub sin private nøkkel og inneholder claims som identifiserer actor
              (bruker/workflow), commit SHA, repository og branch. Tokenet kan ikke forfalskes uten tilgang til GitHub
              sin private signeringsnøkkel.
            </Text>
          </View>

          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>2. Validering i Nais-plattformen</Text>
            <Text style={styles.methodologyText}>
              Nais Console validerer hvert deploy-token mot GitHub sin offentlige nøkkel og verifiserer at tokenet
              kommer fra et autorisert repository. Kun repositories som eksplisitt er konfigurert i Nais Console får
              deploye til det aktuelle namespacet. Metadata fra tokenet, inkludert commit SHA og actor, lagres permanent
              for hver deployment.
            </Text>
          </View>

          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>3. Uavhengig verifisering mot GitHub</Text>
            <Text style={styles.methodologyText}>
              For hver deployment henter denne applikasjonen commit-informasjon direkte fra GitHub API. Systemet
              identifiserer tilhørende pull request og verifiserer at PR-en ble godkjent av en annen person enn
              forfatteren. Det kontrolleres spesifikt at godkjenningen ble gitt etter siste commit i PR-en, slik at
              endringer etter godkjenning fanges opp.
            </Text>
          </View>

          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>4. Komplett sporbarhet</Text>
            <Text style={styles.methodologyText}>
              Deployments som ikke har en gyldig PR-godkjenning (f.eks. direct push til main) krever manuell godkjenning
              med dokumentasjon via Slack-lenke. Dette sikrer at fire-øyne-prinsippet etterleves for alle
              produksjonsendringer, enten via forhåndsgodkjenning (PR) eller etterkontroll (manuell).
            </Text>
          </View>

          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyTitle}>5. Uavhengig av branch protection</Text>
            <Text style={styles.methodologyText}>
              Siden dette systemet utfører uavhengig verifisering av alle deployments mot GitHub, er det ikke avhengig
              av at branch protection-regler er konfigurert på repository-nivå. Systemet fanger opp alle tilfeller der
              kode er deployet uten forutgående godkjenning, og krever manuell dokumentasjon for disse.
            </Text>
          </View>

          {testRequirement && testRequirement !== 'none' && (
            <View style={styles.methodologyBox}>
              <Text style={styles.methodologyTitle}>6. Testkrav før leveranse</Text>
              <Text style={styles.methodologyText}>
                {testRequirement === 'unit_tests' &&
                  'Applikasjonen er konfigurert med krav om at enhetstester må være vellykket før en leveranse kan gjennomføres. Dette sikrer at grunnleggende funksjonalitet er verifisert før kode rulles ut til produksjon.'}
                {testRequirement === 'integration_tests' &&
                  'Applikasjonen er konfigurert med krav om at integrasjonstester må være vellykket før en leveranse kan gjennomføres. Dette sikrer at samspillet mellom komponenter er verifisert før kode rulles ut til produksjon.'}
              </Text>
            </View>
          )}
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
        />
      </Page>

      {/* Final page: Verification */}
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verifisering</Text>
          <View style={styles.methodologyBox}>
            <Text style={styles.methodologyText}>
              Dette dokumentet er generert automatisk av Deployment Audit System.
            </Text>
            <Text style={styles.methodologyText}>Datagrunnlag hentet fra:</Text>
            <Text style={styles.methodologyText}>• Nais Console API (deployments)</Text>
            <Text style={styles.methodologyText}>• GitHub API (pull requests, reviews, commits)</Text>
            <Text style={styles.methodologyText}>• Intern database (godkjenninger i NDA)</Text>
            <Text style={[styles.methodologyText, { marginTop: 8 }]}>
              Alle data kan verifiseres mot originalkildene ved behov.
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Dokument-ID: {reportId}</Text>
          <Text style={styles.hashText}>SHA256: {contentHash}</Text>
        </View>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
        />
      </Page>

      {/* Appendix: Pages for deployments - one page per month */}
      {sortedMonths.map((monthKey, monthIdx) => {
        const monthDeployments = deploymentsByMonth.get(monthKey) || []
        let runningTotal = 0
        for (let i = 0; i < monthIdx; i++) {
          runningTotal += deploymentsByMonth.get(sortedMonths[i])?.length || 0
        }

        return (
          <Page key={monthKey} size="A4" style={styles.page}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Deployments - {formatMonthName(monthKey)} ({monthDeployments.length} stk)
              </Text>
              <View style={styles.table}>
                {/* Header row 1 - fixed to repeat on each page */}
                <View style={styles.tableHeader} fixed>
                  <Text style={[styles.tableHeaderCell, styles.r1col1]}>#</Text>
                  <Text style={[styles.tableHeaderCell, styles.r1col2]}>Dato</Text>
                  <Text style={[styles.tableHeaderCell, styles.r1col3]}>Tittel</Text>
                </View>
                {/* Header row 2 - fixed to repeat on each page */}
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
                {monthDeployments.map((d, idx) => (
                  <View key={d.id} style={[styles.deploymentCard, idx % 2 === 1 ? styles.deploymentCardAlt : {}]}>
                    {/* Row 1: #, Dato, Tittel */}
                    <View style={styles.deploymentRow1}>
                      <Text style={[styles.tableCell, styles.r1col1]}>{runningTotal + idx + 1}</Text>
                      <Text style={[styles.tableCell, styles.r1col2]}>{formatDate(d.date)}</Text>
                      <Text style={[styles.tableCell, styles.r1col3, { fontWeight: 600 }]}>{d.title || '-'}</Text>
                    </View>
                    {/* Row 2: Commit, Metode, Referanse, Deployer, Godkjenner, Nais ID */}
                    <View style={styles.deploymentRow2}>
                      <Text style={[styles.r2col1]} />
                      <Text style={[styles.tableCell, styles.r2col2]}>
                        {d.commit_sha && !d.commit_sha.startsWith('refs/') ? (
                          <Link src={`https://github.com/${repository}/commit/${d.commit_sha}`} style={styles.link}>
                            {d.commit_sha.substring(0, 7)}
                          </Link>
                        ) : (
                          '-'
                        )}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col3]}>
                        {d.method === 'pr'
                          ? 'PR'
                          : d.method === 'legacy'
                            ? 'Legacy'
                            : d.method === 'baseline'
                              ? 'Baseline'
                              : 'Manuell'}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col4]}>
                        {d.method === 'legacy' || d.method === 'baseline' ? (
                          '-'
                        ) : d.pr_number && d.pr_url ? (
                          <Link src={d.pr_url} style={styles.link}>
                            PR #{d.pr_number}
                          </Link>
                        ) : d.pr_number ? (
                          <Link src={`https://github.com/${repository}/pull/${d.pr_number}`} style={styles.link}>
                            PR #{d.pr_number}
                          </Link>
                        ) : d.slack_link ? (
                          <Link src={d.slack_link} style={styles.link}>
                            Slack
                          </Link>
                        ) : (
                          'Slack'
                        )}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col5, { color: '#595959' }]}>
                        {d.pr_author_display_name || d.pr_author || '-'}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col6, { color: '#595959' }]}>
                        {d.deployer_display_name || d.deployer}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col7, { color: '#595959' }]}>
                        {d.approver ? d.approver_display_name || d.approver : '-'}
                      </Text>
                      <Text style={[styles.tableCell, styles.r2col8, { fontSize: 6, color: '#888888' }]}>
                        {d.nais_deployment_id || ''}
                      </Text>
                    </View>
                    {/* Row 3: Endringsopphav (conditional) */}
                    {d.goal_links && d.goal_links.length > 0 && (
                      <View style={styles.deploymentRow3}>
                        <Text style={[styles.r2col1]} />
                        <Text style={[styles.tableCell, { width: '95%', fontStyle: 'italic', color: '#595959' }]}>
                          Endringsopphav:{' '}
                          {d.goal_links
                            .map(
                              (link) =>
                                `${link.team_name} ${link.period_label} — ${link.objective_title}${link.key_result_title ? ` → ${link.key_result_title}` : ''}`,
                            )
                            .join('; ')}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {appName} | {formatMonthName(monthKey)} | Totalt: {totalDeployments} deployments
              </Text>
            </View>
            <Text
              style={styles.pageNumber}
              render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
            />
          </Page>
        )
      })}

      {/* Appendix: Manual approvals (if any) */}
      {reportData.manual_approvals.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Godkjenninger i NDA ({reportData.manual_approvals.length})</Text>
            <Text style={{ fontSize: 9, color: '#595959', marginBottom: 10 }}>{MANUAL_APPROVALS_INTRO}</Text>
            {reportData.manual_approvals.map((approval: ManualApprovalEntry) => (
              <View key={approval.deployment_id} style={styles.manualBox} wrap={false}>
                <Text style={styles.manualTitle}>
                  Deployment #{approval.deployment_id} - {formatDate(approval.date)}
                </Text>
                {approval.title && <Text style={[styles.manualDetail, { fontWeight: 600 }]}>{approval.title}</Text>}
                <Text style={[styles.manualDetail, { fontSize: 7, color: '#666666' }]}>
                  Nais ID: {approval.nais_deployment_id || 'N/A'}
                </Text>
                <Text style={styles.manualDetail}>
                  Commit:{' '}
                  {approval.commit_sha ? (
                    <Link src={`https://github.com/${repository}/commit/${approval.commit_sha}`} style={styles.link}>
                      {approval.commit_sha.substring(0, 7)}
                    </Link>
                  ) : (
                    'N/A'
                  )}
                </Text>
                <Text style={styles.manualDetail}>Deployer: {approval.deployer_display_name || approval.deployer}</Text>
                <Text style={styles.manualDetail}>Årsak: {approval.reason}</Text>
                {approval.registered_by && (
                  <Text style={styles.manualDetail}>
                    Registrert av: {approval.registered_by_display_name || approval.registered_by}
                  </Text>
                )}
                <Text style={styles.manualDetail}>
                  Godkjent av: {approval.approved_by_display_name || approval.approved_by}
                </Text>
                <Text style={styles.manualDetail}>Godkjent: {formatDateTime(approval.approved_at)}</Text>
                <Text style={styles.manualDetail}>
                  Slack:{' '}
                  {approval.slack_link ? (
                    <Link src={approval.slack_link} style={styles.link}>
                      {approval.slack_link}
                    </Link>
                  ) : (
                    '-'
                  )}
                </Text>
                <Text style={styles.manualDetail}>Kommentar: {approval.comment}</Text>
              </View>
            ))}
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
          />
        </Page>
      )}

      {reportData.deviations && reportData.deviations.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Avvik ({reportData.deviations.length})</Text>
            <Text style={{ fontSize: 9, color: '#595959', marginBottom: 10 }}>{DEVIATIONS_INTRO}</Text>
            {reportData.deviations.map((deviation: DeviationEntry) => (
              <View key={`${deviation.deployment_id}-${deviation.date}`} style={styles.manualBox} wrap={false}>
                <Text style={styles.manualTitle}>
                  Deployment #{deviation.deployment_id} - {formatDate(deviation.date)}
                </Text>
                <Text style={[styles.manualDetail, { fontSize: 7, color: '#666666' }]}>
                  Commit:{' '}
                  {deviation.commit_sha ? (
                    <Link src={`https://github.com/${repository}/commit/${deviation.commit_sha}`} style={styles.link}>
                      {deviation.commit_sha.substring(0, 7)}
                    </Link>
                  ) : (
                    'N/A'
                  )}
                </Text>
                <Text style={styles.manualDetail}>Beskrivelse: {deviation.reason}</Text>
                {deviation.breach_type && <Text style={styles.manualDetail}>Type brudd: {deviation.breach_type}</Text>}
                {deviation.intent && (
                  <Text style={styles.manualDetail}>
                    Intensjon: {DEVIATION_INTENT_LABELS[deviation.intent as DeviationIntent] || deviation.intent}
                  </Text>
                )}
                {deviation.severity && (
                  <Text style={styles.manualDetail}>
                    Alvorlighetsgrad:{' '}
                    {DEVIATION_SEVERITY_LABELS[deviation.severity as DeviationSeverity] || deviation.severity}
                  </Text>
                )}
                {deviation.follow_up_role && (
                  <Text style={styles.manualDetail}>
                    Oppfølgingsansvarlig:{' '}
                    {DEVIATION_FOLLOW_UP_ROLE_LABELS[deviation.follow_up_role as DeviationFollowUpRole] ||
                      deviation.follow_up_role}
                  </Text>
                )}
                <Text style={styles.manualDetail}>
                  Registrert av: {deviation.registered_by_name || deviation.registered_by}
                </Text>
                <Text style={styles.manualDetail}>
                  Status: {deviation.resolved_at ? `Løst ${formatDateTime(deviation.resolved_at)}` : 'Åpen'}
                </Text>
                {deviation.resolution_note && (
                  <Text style={styles.manualDetail}>Løsning: {deviation.resolution_note}</Text>
                )}
              </View>
            ))}
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
          />
        </Page>
      )}
      {reportData.unverified_commit_deployments && reportData.unverified_commit_deployments.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Ikke-godkjente commits ({reportData.unverified_commit_deployments.length} deployments)
            </Text>
            <Text style={{ fontSize: 9, color: '#595959', marginBottom: 4 }}>{UNVERIFIED_COMMITS_INTRO_PDF}</Text>
            {reportData.show_unverified_commits_note && (
              <Text style={{ fontSize: 8, color: '#7a7a7a', fontStyle: 'italic', marginBottom: 10 }}>
                {UNVERIFIED_COMMITS_NOTE}
              </Text>
            )}
            {reportData.unverified_commit_deployments.map((entry: UnverifiedCommitDeploymentEntry) => {
              const isApproved = entry.four_eyes_status === 'manually_approved'
              return (
                <View key={entry.deployment_id} style={styles.manualBox} wrap={false}>
                  <Text style={styles.manualTitle}>
                    Deployment #{entry.deployment_id} - {formatDate(entry.date)}
                  </Text>
                  {entry.title && <Text style={[styles.manualDetail, { fontWeight: 600 }]}>{entry.title}</Text>}
                  <Text style={styles.manualDetail}>
                    Commit:{' '}
                    {entry.commit_sha ? (
                      <Link src={`https://github.com/${repository}/commit/${entry.commit_sha}`} style={styles.link}>
                        {entry.commit_sha.substring(0, 7)}
                      </Link>
                    ) : (
                      'N/A'
                    )}
                  </Text>
                  <Text style={styles.manualDetail}>Deployer: {entry.deployer_display_name || entry.deployer}</Text>
                  <Text style={[styles.manualDetail, { fontWeight: 600, color: isApproved ? '#006A2E' : '#BA3A26' }]}>
                    {isApproved
                      ? `✓ Godkjent av: ${entry.approved_by_display_name || entry.approved_by}${entry.approved_at ? ` (${formatDateTime(entry.approved_at)})` : ''}`
                      : '✗ Ikke godkjent etter fire-øyne-prinsippet'}
                  </Text>
                  <Text style={[styles.manualDetail, { marginTop: 4, fontWeight: 600 }]}>
                    Ikke-godkjente commits ({entry.commits.length}):
                  </Text>
                  {entry.commits.map((commit) => (
                    <View key={commit.sha} style={{ marginLeft: 10, marginBottom: 3 }}>
                      <Text style={{ fontSize: 8 }}>
                        •{' '}
                        <Link src={commit.html_url} style={styles.link}>
                          {commit.sha.substring(0, 7)}
                        </Link>
                        {' - '}
                        {commit.message.length > 80 ? `${commit.message.substring(0, 80)}…` : commit.message}
                      </Text>
                      <Text style={{ fontSize: 7, color: '#666666', marginLeft: 10 }}>
                        av {commit.author} • {formatUnverifiedReason(commit.reason)}
                        {commit.pr_number ? ` (PR #${commit.pr_number})` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )
            })}
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
          />
        </Page>
      )}
    </Document>
  )
}

export async function generateAuditReportPdf(props: AuditReportPdfProps): Promise<Buffer> {
  const buffer = await renderToBuffer(<AuditReportPdfDocument {...props} />)
  return Buffer.from(buffer)
}
