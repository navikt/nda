ALTER TABLE repository_code_delivery_unresolved
  DROP CONSTRAINT repository_code_delivery_unresolved_reason_check;

ALTER TABLE repository_code_delivery_unresolved
  ADD CONSTRAINT repository_code_delivery_unresolved_reason_check
  CHECK (reason IN ('ancestry_unknown', 'ancestry_diverged', 'ancestry_behind', 'source_unauthorized', 'source_unknown'));
