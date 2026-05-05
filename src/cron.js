const cron = require('node-cron');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const STALE_DAYS = parseInt(process.env.STALE_DAYS || '3');
const APPLIED_GHOST_DAYS = parseInt(process.env.APPLIED_GHOST_DAYS || '21');
const INTERVIEW_GHOST_DAYS = parseInt(process.env.INTERVIEW_GHOST_DAYS || '5');

const EMAIL_ALERTS_ENABLED = ['1', 'true', 'yes', 'on'].includes((process.env.EMAIL_ALERTS_ENABLED || 'false').toLowerCase());
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = ['1', 'true', 'yes', 'on'].includes((process.env.SMTP_SECURE || 'false').toLowerCase());
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || '';
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || '';
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const LOG_FILE = process.env.LOG_FILE || 'cron.log';
const LOG_PATH = path.join(LOG_DIR, LOG_FILE);

// Stores the latest alert data in memory so the frontend can poll it
let latestAlert = null;
let mailTransporter = null;

function ensureLogPath() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    // Keep running even if file logging fails.
    console.error('Log path error:', err.message);
  }
}

function writeLog(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;

  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);

  try {
    fs.appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
  } catch (err) {
    console.error('Log write error:', err.message);
  }
}

function getMissingEmailConfig() {
  return [
    ['SMTP_HOST', SMTP_HOST],
    ['ALERT_EMAIL_FROM', ALERT_EMAIL_FROM],
    ['ALERT_EMAIL_TO', ALERT_EMAIL_TO],
  ].filter(([, value]) => !value).map(([name]) => name);
}

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  const transportConfig = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
  };

  if (SMTP_USER && SMTP_PASS) {
    transportConfig.auth = { user: SMTP_USER, pass: SMTP_PASS };
  }

  mailTransporter = nodemailer.createTransport(transportConfig);
  return mailTransporter;
}

async function sendStaleAlertEmail(applications) {
  if (!EMAIL_ALERTS_ENABLED || applications.length === 0) return;

  const missing = getMissingEmailConfig();
  if (missing.length > 0) {
    writeLog('WARN', `Email alerts enabled, but missing config: ${missing.join(', ')}`);
    return;
  }

  const lines = applications.map(a => {
    const role = a.role ? ` - ${a.role}` : '';
    const days = `${a.days_since_check}d`;
    const portal = a.portal_url ? ` (${a.portal_url})` : '';
    return `- ${a.company}${role} [${a.status}] stale ${days}${portal}`;
  });

  const subject = `[Job Tracker] ${applications.length} stale application${applications.length === 1 ? '' : 's'}`;
  const text = [
    'The following applications are stale and may need follow-up:',
    '',
    ...lines,
    '',
    `Generated at: ${new Date().toISOString()}`,
  ].join('\n');

  try {
    await getMailTransporter().sendMail({
      from: ALERT_EMAIL_FROM,
      to: ALERT_EMAIL_TO,
      subject,
      text,
    });
    writeLog('INFO', `Sent stale alert email to ${ALERT_EMAIL_TO}`);
  } catch (err) {
    writeLog('ERROR', `Email alert error: ${err.message}`);
  }
}

async function markGhostedApplications() {
  const result = await pool.query(`
    UPDATE applications
    SET status = 'ghosted',
        status_changed_at = NOW()
    WHERE (
      status = 'applied' AND status_changed_at <= NOW() - INTERVAL '1 day' * $1
    ) OR (
      status = 'interview' AND status_changed_at <= NOW() - INTERVAL '1 day' * $2
    )
    RETURNING company, role
  `, [APPLIED_GHOST_DAYS, INTERVIEW_GHOST_DAYS]);

  if (result.rows.length > 0) {
    writeLog('INFO', `Auto-marked ${result.rows.length} application(s) as ghosted`);
  }
}

async function checkStaleApplications() {
  try {
    await markGhostedApplications();

    const result = await pool.query(`
      SELECT company, role, status,
        ROUND(EXTRACT(EPOCH FROM (NOW() - last_checked_at)) / 86400) AS days_since_check,
        portal_url
      FROM applications
      WHERE (NOW() - last_checked_at) > INTERVAL '1 day' * $1
        AND status != ALL($2::text[])
      ORDER BY last_checked_at ASC
    `, [STALE_DAYS, ['rejected', 'accepted', 'withdrawn', 'ghosted']]);

    if (result.rows.length > 0) {
      latestAlert = {
        triggeredAt: new Date().toISOString(),
        count: result.rows.length,
        applications: result.rows,
      };
      writeLog('INFO', `Alert: ${result.rows.length} stale application(s) need checking`);
      await sendStaleAlertEmail(result.rows);
    } else {
      latestAlert = null;
      writeLog('INFO', 'Cron check: all applications are up to date');
    }
  } catch (err) {
    writeLog('ERROR', `Cron error: ${err.message}`);
  }
}

function startCron() {
  ensureLogPath();
  writeLog(
    'INFO',
    `Cron logging initialized at ${LOG_PATH}; email alerts ${EMAIL_ALERTS_ENABLED ? 'enabled' : 'disabled'}${ALERT_EMAIL_TO ? `; recipient ${ALERT_EMAIL_TO}` : ''}`
  );

  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', () => {
    writeLog('INFO', 'Running daily stale check...');
    checkStaleApplications();
  });

  // Also run at startup so we have data right away
  checkStaleApplications();

  writeLog('INFO', 'Cron scheduler started (daily at 9:00 AM)');
}

function getLatestAlert() {
  return latestAlert;
}

module.exports = { startCron, getLatestAlert };
