import { StyleSheet } from '@react-pdf/renderer'

export const styles = StyleSheet.create({
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
