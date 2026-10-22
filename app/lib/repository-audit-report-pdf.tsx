import { Document, Page, renderToBuffer, Text, View } from '@react-pdf/renderer'
import { buildRepositoryReportSections, type RepositoryReportOutputProps } from './repository-audit-report-output'

function createRepositoryAuditReportDocument(props: RepositoryReportOutputProps) {
  return (
    <Document title={`Repositorybasert leveranserapport – ${props.appName}`} author="NDA">
      {buildRepositoryReportSections(props).map((section) => (
        <Page key={section.title} size="A4" style={{ padding: 32, fontFamily: 'Helvetica', fontSize: 9 }}>
          <Text style={{ fontSize: 15, marginBottom: 12 }}>Repositorybasert leveranserapport</Text>
          <Text style={{ fontSize: 12, marginBottom: 12 }}>{section.title}</Text>
          {section.rows.length === 0 && <Text>Ingen registrerte oppføringer.</Text>}
          {section.rows.map((row) => (
            <View key={JSON.stringify(row)} style={{ marginBottom: 10 }} wrap>
              {row.map((value, column) => (
                <Text key={section.headers[column]} style={{ marginBottom: 3 }}>
                  {section.headers[column]}: {value}
                </Text>
              ))}
            </View>
          ))}
          <Text
            fixed
            style={{ position: 'absolute', bottom: 18, left: 32, fontSize: 8 }}
            render={({ pageNumber, totalPages }) => `${props.reportId} · ${pageNumber} / ${totalPages}`}
          />
        </Page>
      ))}
    </Document>
  )
}

export async function generateRepositoryAuditReportPdf(props: RepositoryReportOutputProps): Promise<Buffer> {
  return renderToBuffer(createRepositoryAuditReportDocument(props))
}
