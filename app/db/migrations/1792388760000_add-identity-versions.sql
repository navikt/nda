CREATE SEQUENCE identity_version_sequence AS BIGINT NO CYCLE;

ALTER TABLE users ADD COLUMN identity_version BIGINT;
ALTER TABLE user_github_accounts ADD COLUMN identity_version BIGINT;

UPDATE users SET identity_version = nextval('identity_version_sequence');
UPDATE user_github_accounts SET identity_version = nextval('identity_version_sequence');

ALTER TABLE users ALTER COLUMN identity_version SET NOT NULL;
ALTER TABLE user_github_accounts ALTER COLUMN identity_version SET NOT NULL;

CREATE FUNCTION assign_user_identity_version() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.identity_version := nextval('identity_version_sequence');
  ELSIF NEW.nav_ident IS DISTINCT FROM OLD.nav_ident
     OR (NEW.deleted_at IS NULL) IS DISTINCT FROM (OLD.deleted_at IS NULL) THEN
    NEW.identity_version := nextval('identity_version_sequence');
  ELSE
    NEW.identity_version := OLD.identity_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION assign_github_account_identity_version() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.identity_version := nextval('identity_version_sequence');
  ELSIF NEW.github_username IS DISTINCT FROM OLD.github_username
     OR NEW.nav_ident IS DISTINCT FROM OLD.nav_ident
     OR (NEW.deleted_at IS NULL) IS DISTINCT FROM (OLD.deleted_at IS NULL) THEN
    NEW.identity_version := nextval('identity_version_sequence');
  ELSE
    NEW.identity_version := OLD.identity_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_identity_version
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION assign_user_identity_version();

CREATE TRIGGER github_accounts_identity_version
BEFORE INSERT OR UPDATE ON user_github_accounts
FOR EACH ROW EXECUTE FUNCTION assign_github_account_identity_version();
