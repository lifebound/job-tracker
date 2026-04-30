const express = require('express');
const router = express.Router();
const { pool } = require('./db');

const STALE_DAYS = parseInt(process.env.STALE_DAYS || '3');
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = new Set(['applied', 'interview', 'offer', 'waitlisted', 'rejected', 'accepted', 'withdrawn', 'ghosted']);
const CLOSED_STATUSES = ['rejected', 'accepted', 'withdrawn', 'ghosted'];

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
      ORDER BY applied_at DESC
    `, [STALE_DAYS]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
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
      ORDER BY last_checked_at ASC
    `, [STALE_DAYS, CLOSED_STATUSES]);
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

  const normalizedStatus = status || 'applied';

  try {
    const result = await pool.query(
      `INSERT INTO applications (company, role, portal_url, status, notes, applied_at, status_changed_at)
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
         END
       )
       RETURNING *`,
      [company, role || '', portal_url || null, normalizedStatus, notes || null, normalizedAppliedAt]
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

  try {
    const result = await pool.query(
      `UPDATE applications
       SET company    = COALESCE($1, company),
           role       = COALESCE($2, role),
           portal_url = COALESCE($3, portal_url),
           status     = COALESCE($4, status),
           notes      = COALESCE($5, notes),
           applied_at = COALESCE($6::timestamptz, applied_at),
           status_changed_at = CASE
             WHEN $4 IS NOT NULL AND $4 <> status THEN NOW()
             ELSE status_changed_at
           END
       WHERE id = $7
       RETURNING *`,
      [company, role, portal_url, status, notes, normalizedAppliedAt, id]
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
      `UPDATE applications SET last_checked_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
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
      `DELETE FROM applications WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
