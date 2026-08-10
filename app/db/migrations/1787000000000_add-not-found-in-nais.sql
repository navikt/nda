-- Track when a monitored application was last confirmed missing from the Nais GraphQL API
-- (e.g. decommissioned, renamed, or moved to another team/environment).
-- NULL means the app was found (or has not been checked) in the most recent sync.
ALTER TABLE monitored_applications ADD COLUMN IF NOT EXISTS not_found_in_nais_at TIMESTAMPTZ;
