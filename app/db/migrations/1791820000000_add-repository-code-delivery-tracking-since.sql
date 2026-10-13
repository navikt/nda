ALTER TABLE repositories
  ADD COLUMN code_delivery_tracking_since TIMESTAMP WITH TIME ZONE;

UPDATE repositories SET code_delivery_tracking_since = now() WHERE code_delivery_tracking;

CREATE FUNCTION set_code_delivery_tracking_since() RETURNS trigger AS $$
BEGIN
  IF NEW.code_delivery_tracking AND NEW.code_delivery_tracking_since IS NULL THEN
    NEW.code_delivery_tracking_since := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repositories_set_code_delivery_tracking_since
  BEFORE INSERT OR UPDATE OF code_delivery_tracking ON repositories
  FOR EACH ROW EXECUTE FUNCTION set_code_delivery_tracking_since();

CREATE INDEX idx_deployments_unlinked_code_delivery_candidates
  ON deployments (repository_id, created_at, id)
  WHERE repository_code_delivery_id IS NULL AND repository_id IS NOT NULL;
