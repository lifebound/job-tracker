require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { initDb, pool } = require('./db');
const applicationsRouter = require('./routes');
const authRouter = require('./auth');
const { requireAuth } = require('./middleware');
const { startCron } = require('./cron');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
// Import endpoint needs a higher body limit; mount before the global parser so it takes precedence
app.use('/api/applications/import', express.json({ limit: '512kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-local-secret-change-me',
  resave: false,
  saveUninitialized: false,
  name: 'job_tracker_sid',
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    maxAge: 24 * 60 * 60 * 1000, // 1 day default; extended to 30 days by rememberMe
  },
}));

app.use(express.static(path.join(__dirname, '../public')));

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Auth routes (no auth guard — rate limited)
app.use('/auth', authLimiter, authRouter);

// API routes
app.use('/api', apiLimiter);
app.use('/api/applications', requireAuth, writeLimiter, applicationsRouter);

// Serve the frontend for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

async function main() {
  await initDb();
  startCron();
  app.listen(PORT, () => {
    console.log(`🚀 Job Tracker running at http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
