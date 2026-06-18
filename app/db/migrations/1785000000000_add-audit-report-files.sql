-- Introduce audit_report_files child table to support multiple file formats (pdf, xlsx)
-- Migrates existing pdf_data from audit_reports and drops the column

CREATE TABLE audit_report_files (
  audit_report_id INTEGER NOT NULL REFERENCES audit_reports(id) ON DELETE CASCADE,
  format          TEXT    NOT NULL CHECK (format IN ('pdf', 'xlsx')),
  data            BYTEA   NOT NULL,
  PRIMARY KEY (audit_report_id, format)
);

INSERT INTO audit_report_files (audit_report_id, format, data)
  SELECT id, 'pdf', pdf_data FROM audit_reports WHERE pdf_data IS NOT NULL;

ALTER TABLE audit_reports DROP COLUMN IF EXISTS pdf_data;
