import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

/** Run migrations to create required tables */
export async function migrate(): Promise<void> {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS coverage_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_type TEXT NOT NULL,
      window_name TEXT NOT NULL,
      resolution INTEGER,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_type_window
    ON coverage_snapshots (snapshot_type, window_name)
  `);

  // Keep only the latest snapshot per type+window+resolution
  // (old ones are cleaned up after loading)

  console.log('[DB] Migrations complete');
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
