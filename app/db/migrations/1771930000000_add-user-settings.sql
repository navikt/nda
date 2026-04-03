CREATE TABLE user_settings (
  nav_ident TEXT PRIMARY KEY,
  landing_page TEXT NOT NULL DEFAULT 'my-teams',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
