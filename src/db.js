const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'jobtracker',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'yourpassword',
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id          SERIAL PRIMARY KEY,
        company     TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT '',
        portal_url  TEXT,
        status      TEXT NOT NULL DEFAULT 'applied',
        notes       TEXT,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE applications
      ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

      UPDATE applications
      SET status_changed_at = CASE
        WHEN status_changed_at IS NOT NULL THEN status_changed_at
        WHEN status = 'applied' THEN COALESCE(applied_at, created_at, NOW())
        ELSE COALESCE(updated_at, created_at, NOW())
      END;

      ALTER TABLE applications
      ALTER COLUMN status_changed_at SET DEFAULT NOW();

      ALTER TABLE applications
      ALTER COLUMN status_changed_at SET NOT NULL;

      -- Trigger to auto-update updated_at
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS set_updated_at ON applications;
      CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON applications
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    `);
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
