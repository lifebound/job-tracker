# Job Tracker — Mission Control

A clean, fast job application tracker with PostgreSQL persistence and stale-application alerts.

## Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Frontend**: Single-page app served by the backend

---

## Setup

## Docker Quick Start

Run the app and PostgreSQL together:

```bash
docker compose up --build
```

Then open **<http://localhost:3000>**.

Useful commands:

```bash
# stop containers
docker compose down

# stop and remove database volume (full reset)
docker compose down -v
```

To enable email alerts in Docker Compose, set these under the `app.environment` block in `docker-compose.yml`:

```yaml
EMAIL_ALERTS_ENABLED: "true"
SMTP_HOST: "smtp.example.com"
SMTP_PORT: 587
SMTP_SECURE: "false"
SMTP_USER: "smtp-user"
SMTP_PASS: "smtp-password"
ALERT_EMAIL_FROM: "alerts@example.com"
ALERT_EMAIL_TO: "you@example.com"
LOG_DIR: /app/logs
LOG_FILE: cron.log
```

Cron logs are written to `./logs/cron.log` on your host via the default Compose bind mount.

Files added for containerized usage:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `.env.example`

### 1. Configure your database connection

Copy `.env.example` to `.env` and fill in your Postgres details:

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
DB_HOST=localhost        # or your Docker host
DB_PORT=5432             # default Postgres port
DB_NAME=jobtracker       # will be created automatically
DB_USER=postgres
DB_PASSWORD=yourpassword
PORT=3000
STALE_DAYS=3             # how many days before an app is flagged "stale"

# Optional email alerts (daily cron)
EMAIL_ALERTS_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL_FROM=
ALERT_EMAIL_TO=

# Optional cron log output location
LOG_DIR=./logs
LOG_FILE=cron.log
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the app

```bash
npm start
# or for development with auto-reload:
npm run dev
```

Open **<http://localhost:3000>** in your browser.

---

## Features

- **Log applications**: Company, role, portal/tracking URL, status, notes
- **Status tracking**: Applied → Interview → Offer → Accepted/Rejected/Withdrawn/Waitlisted/Ghosted
- **Stale alerts**: A banner appears on load (and refreshes every 30 min) if any active applications haven't been checked in `STALE_DAYS` days
- **Daily cron**: Runs at 9 AM every day, auto-marks long-stalled applications as `ghosted`, logs stale applications, and can send email alerts when `EMAIL_ALERTS_ENABLED=true`
- **"✓ Checked" button**: Updates `last_checked_at` to now, clearing the stale flag
- **Edit / Delete**: Full CRUD on all applications
- **Filters**: Filter by status, stale, or closed; search by company/role/notes

Ghosting rules:

- Applications still in `Applied` for 21 days are automatically marked `ghosted`
- Applications still in `Interview` for 5 days are automatically marked `ghosted`

---

## Docker tip

When running outside Docker, use your normal `.env` values.

When running with `docker compose`, the app container automatically uses:

- `DB_HOST=postgres`
- `DB_PORT=5432`
- `DB_NAME=jobtracker`
- `DB_USER=jobtracker`
- `DB_PASSWORD=jobtracker`

---

## Extending alerts

Email alerts are already wired in and controlled entirely via environment variables.

Required when `EMAIL_ALERTS_ENABLED=true`:

- `SMTP_HOST`
- `ALERT_EMAIL_FROM`
- `ALERT_EMAIL_TO`

Optional/commonly needed depending on SMTP provider:

- `SMTP_PORT` (default `587`)
- `SMTP_SECURE` (`true` for implicit TLS, usually port `465`)
- `SMTP_USER`
- `SMTP_PASS`

Behavior:

- Emails are sent during cron checks only when stale applications exist.
- If email alerts are enabled but required settings are missing, the app logs a warning and continues running.
- Cron output is always written to a log file (default `./logs/cron.log` locally, `/app/logs/cron.log` in Docker).
