# Database Migrations

This project uses [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) for database schema management.

## Quick Start

### Run all pending migrations
```bash
pnpm run db:migrate
```

### Check migration status
```bash
# node-pg-migrate doesn't have a 'status' command
# To see what's applied, query the database:
psql $DATABASE_URL -c "SELECT * FROM pgmigrations ORDER BY run_on;"
```

### Create a new migration
```bash
pnpm run db:migrate:create my-new-migration
```

This creates a file: `app/db/migrations/TIMESTAMP_my-new-migration.sql`

### Rollback last migration
```bash
pnpm run db:migrate:down
```

## Migration Files

Migrations are stored in `app/db/migrations/` with format:
```
TIMESTAMP_migration-name.sql
```

Example:
```
1738255000000_initial-schema.sql
1738256400000_add-branch-and-merge-info.sql
1738257000000_add-manual-approval.sql
```

## Writing Migrations

### SQL-only migrations (recommended)
```sql
-- Up migration
ALTER TABLE deployments ADD COLUMN new_field VARCHAR(255);

-- Down migration (optional, at end of file)
-- Down:
-- ALTER TABLE deployments DROP COLUMN new_field;
```

### JavaScript migrations (for complex logic)
Create as `.js` file instead:
```javascript
export async function up(pgm) {
  pgm.addColumn('deployments', {
    new_field: { type: 'varchar(255)' }
  });
}

export async function down(pgm) {
  pgm.dropColumn('deployments', 'new_field');
}
```

## Migration Tracking

node-pg-migrate creates a `pgmigrations` table to track applied migrations.

## Environment

Migrations use the `DATABASE_URL` environment variable from `.env`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```

## Configuration

See `.node-pg-migrate.json` for configuration:
```json
{
  "database-url-var": "DATABASE_URL",
  "dir": "app/db/migrations",
  "migrations-table": "pgmigrations",
  "schema": "public",
  "migration-file-language": "sql"
}
```

## Best Practices

1. **Always test migrations locally first**
2. **Keep migrations small and focused**
3. **Make migrations reversible** (add down migrations)
4. **Never edit applied migrations** - create new ones instead
5. **Check applied migrations** in database before deploying

## Deployment

In production, run migrations before starting the app:
```bash
pnpm run db:migrate && pnpm start
```

Or add to Dockerfile/startup script.
