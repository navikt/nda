CREATE TABLE IF NOT EXISTS risks_and_controls (
  id SERIAL PRIMARY KEY,
  section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('risk', 'control')),
  short_title TEXT NOT NULL,
  long_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'mitigated', 'accepted', 'closed')),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_risks_controls_section ON risks_and_controls(section_id);
CREATE INDEX IF NOT EXISTS idx_risks_controls_category ON risks_and_controls(category);
CREATE INDEX IF NOT EXISTS idx_risks_controls_search ON risks_and_controls USING gin (
  (to_tsvector('norwegian', short_title) || to_tsvector('norwegian', long_title))
);
