#!/usr/bin/env node

/**
 * Initialize database schema
 *
 * This will DROP all existing tables and create new tables.
 * Use this for a fresh database setup.
 *
 * Usage: pnpm run db:init
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from '../app/db/connection.server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initDatabase() {
  console.log('\n🔄 Initializing database schema...\n');
  console.log('⚠️  WARNING: This will DROP all existing tables!\n');

  const pool = getPool();
  const schemaSQL = readFileSync(join(__dirname, '../app/db/schema.sql'), 'utf-8');

  try {
    // Drop existing tables
    console.log('🗑️  Dropping existing tables...');
    await pool.query(`
      DROP TABLE IF EXISTS deployment_comments CASCADE;
      DROP TABLE IF EXISTS deployments CASCADE;
      DROP TABLE IF EXISTS repositories CASCADE;
      DROP TABLE IF EXISTS repository_alerts CASCADE;
      DROP TABLE IF EXISTS application_repositories CASCADE;
      DROP TABLE IF EXISTS monitored_applications CASCADE;
    `);
    console.log('✅ Old tables dropped\n');

    // Create new schema
    console.log('📝 Creating database schema...');
    await pool.query(schemaSQL);
    console.log('✅ Schema created successfully\n');

    // Verify tables
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

    console.log('📊 Database tables:');
    for (const row of result.rows) {
      console.log(`   ✓ ${row.table_name}`);
    }
    console.log();
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    await closePool();
  }
}

initDatabase()
  .then(() => {
    console.log('✨ Database initialization complete!\n');
    console.log('Next steps:');
    console.log('  1. Start the app: pnpm run dev');
    console.log('  2. Add monitored applications via UI');
    console.log('  3. Sync deployments\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  });
