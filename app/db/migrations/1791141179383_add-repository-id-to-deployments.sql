ALTER TABLE deployments ADD COLUMN repository_id INTEGER REFERENCES repositories(id);
