require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDb } = require('./db');
const applicationsRouter = require('./routes');
const { startCron, getLatestAlert } = require('./cron');

const app = express();
const PORT = process.env.PORT || 3000;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
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

app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', apiLimiter);
app.use('/api/applications', writeLimiter);
app.use('/api/applications', applicationsRouter);

// Alert endpoint — frontend polls this
app.get('/api/alert', (req, res) => {
  res.json(getLatestAlert() || { count: 0, applications: [] });
});

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
