const express = require('express');
const router = express.Router();
const { pool } = require('./db');

const STALE_DAYS = parseInt(process.env.STALE_DAYS || '3');
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = new Set(['applied', 'interview', 'offer', 'waitlisted', 'rejected', 'accepted', 'withdrawn', 'ghosted']);
const CLOSED_STATUSES = ['rejected', 'accepted', 'withdrawn', 'ghosted'];
const SAFE_URL_REGEX = /^https?:\/\//i;

function normalizePortalUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!SAFE_URL_REGEX.test(trimmed)) return null;
  return trimmed;
}

function normalizeAppliedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Accept date-only input from <input type="date"> and normalize to noon UTC
  // to avoid timezone shifts when rendering calendar dates in local time.
  if (DATE_ONLY_REGEX.test(trimmed)) return `${trimmed}T12:00:00Z`;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

// GET /api/applications — list all, with stale flag
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *,
        (NOW() - last_checked_at) > INTERVAL '1 day' * $1 AS is_stale,
        EXTRACT(EPOCH FROM (NOW() - last_checked_at)) / 86400 AS days_since_check
      FROM applications
      WHERE user_id = $2
      ORDER BY applied_at DESC
    `, [STALE_DAYS, req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/applications/export — download all applications as JSON
router.get('/export', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT company, role, portal_url, status, notes,
             applied_at, status_changed_at, last_checked_at, created_at
      FROM applications
      WHERE user_id = $1
      ORDER BY applied_at DESC
    `, [req.session.userId]);

    const filename = `job-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/applications/import — bulk insert from JSON export
router.post('/import', async (req, res) => {
  const rows = req.body;

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Expected a JSON array' });
  }
  if (rows.length === 0) {
    return res.status(400).json({ error: 'File contains no records' });
  }
  if (rows.length > 10000) {
    return res.status(400).json({ error: 'Too many records (max 10,000)' });
  }

  // Validate all rows before inserting anything
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 1;
    if (typeof r !== 'object' || r === null || Array.isArray(r)) {
      errors.push({ row: rowNum, error: 'Each record must be an object' });
      continue;
    }
    if (!r.company || typeof r.company !== 'string' || !r.company.trim()) {
      errors.push({ row: rowNum, error: 'company is required' });
    }
    if (r.status && !VALID_STATUSES.has(r.status)) {
      errors.push({ row: rowNum, error: `Invalid status: "${r.status}"` });
    }
    if (r.portal_url && !SAFE_URL_REGEX.test(String(r.portal_url))) {
      errors.push({ row: rowNum, error: 'portal_url must start with http:// or https://' });
    }
    if (r.applied_at && normalizeAppliedAt(r.applied_at) === undefined) {
      errors.push({ row: rowNum, error: 'Invalid applied_at date' });
    }
    if (r.status_changed_at && isNaN(new Date(r.status_changed_at).getTime())) {
      errors.push({ row: rowNum, error: 'Invalid status_changed_at date' });
    }
    if (r.last_checked_at && isNaN(new Date(r.last_checked_at).getTime())) {
      errors.push({ row: rowNum, error: 'Invalid last_checked_at date' });
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO applications
           (company, role, portal_url, status, notes,
            applied_at, status_changed_at, last_checked_at, user_id)
         VALUES ($1, $2, $3, $4, $5,
           COALESCE($6::timestamptz, NOW()),
           COALESCE($7::timestamptz, NOW()),
           COALESCE($8::timestamptz, NOW()),
           $9)`,
        [
          r.company.trim(),
          r.role || '',
          normalizePortalUrl(r.portal_url),
          r.status || 'applied',
          r.notes || null,
          r.applied_at || null,
          r.status_changed_at || null,
          r.last_checked_at || null,
          req.session.userId,
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ imported: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Import failed' });
  } finally {
    client.release();
  }
});

// GET /api/applications/stale — only stale ones (for alert banner)
router.get('/stale', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *,
        EXTRACT(EPOCH FROM (NOW() - last_checked_at)) / 86400 AS days_since_check
      FROM applications
      WHERE (NOW() - last_checked_at) > INTERVAL '1 day' * $1
        AND status != ALL($2::text[])
        AND user_id = $3
      ORDER BY last_checked_at ASC
    `, [STALE_DAYS, CLOSED_STATUSES, req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/applications — create new
router.post('/', async (req, res) => {
  const { company, role, portal_url, status, notes, applied_at } = req.body;
  if (!company) return res.status(400).json({ error: 'Company name is required' });
  if (status && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const normalizedAppliedAt = normalizeAppliedAt(applied_at);
  if (normalizedAppliedAt === undefined) {
    return res.status(400).json({ error: 'Invalid applied_at date format' });
  }
  const normalizedPortalUrl = normalizePortalUrl(portal_url);
  if (portal_url && normalizedPortalUrl === null) {
    return res.status(400).json({ error: 'Invalid portal URL: must start with http:// or https://' });
  }
  const normalizedStatus = status || 'applied';

  try {
    const result = await pool.query(
      `INSERT INTO applications (company, role, portal_url, status, notes, applied_at, status_changed_at, user_id)
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         COALESCE($6::timestamptz, NOW()),
         CASE
           WHEN $4 = 'applied' THEN COALESCE($6::timestamptz, NOW())
           ELSE NOW()
         END,
         $7
       )
       RETURNING *`,
      [company, role || '', normalizedPortalUrl, normalizedStatus, notes || null, normalizedAppliedAt, req.session.userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /api/applications/:id — update fields
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { company, role, portal_url, status, notes, applied_at } = req.body;
  if (status && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const normalizedAppliedAt = normalizeAppliedAt(applied_at);
  if (normalizedAppliedAt === undefined) {
    return res.status(400).json({ error: 'Invalid applied_at date format' });
  }

  const normalizedPortalUrl = normalizePortalUrl(portal_url);
  if (portal_url && normalizedPortalUrl === null) {
    return res.status(400).json({ error: 'Invalid portal URL: must start with http:// or https://' });
  }

  try {
    const result = await pool.query(
      `UPDATE applications
       SET company    = COALESCE($1, company),
           role       = COALESCE($2, role),
           portal_url = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE portal_url END,
           status     = COALESCE($4, status),
           notes      = COALESCE($5, notes),
           applied_at = COALESCE($6::timestamptz, applied_at),
           status_changed_at = CASE
             WHEN $4 IS NOT NULL AND $4 <> status THEN NOW()
             ELSE status_changed_at
           END
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [company, role, normalizedPortalUrl, status, notes, normalizedAppliedAt, id, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/applications/:id/check — mark as checked right now
router.post('/:id/check', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE applications SET last_checked_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/applications/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
