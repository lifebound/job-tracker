const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('./db');

const BCRYPT_ROUNDS = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /auth/status — tells the frontend whether a user account exists
router.get('/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    const registered = parseInt(result.rows[0].count, 10) > 0;
    res.json({ registered, authenticated: !!req.session.userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /auth/register — only allowed when no users exist yet
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email.toLowerCase().trim(), hash]
    );
    const user = result.rows[0];

    // Claim orphaned applications (rows created before auth existed, first user only)
    await pool.query('UPDATE applications SET user_id = $1 WHERE user_id IS NULL', [user.id]);

    req.session.userId = user.id;
    req.session.email = user.email;
    res.json({ ok: true, email: user.email });
  } catch (err) {
    if (err.code === '23505') { // unique_violation — email already registered
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    } else {
      req.session.cookie.expires = false; // session cookie — expires when browser closes
    }

    req.session.userId = user.id;
    req.session.email = user.email;
    res.json({ ok: true, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('job_tracker_sid');
    res.json({ ok: true });
  });
});

module.exports = router;
