# Job Tracker — Mission Control

A clean, fast job application tracker with PostgreSQL persistence and stale-application alerts.

## Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Frontend**: Single-page app served by the backend

---

## Quick Start (Docker)

```bash
docker compose up --build
```

Open **<http://localhost:3000>**.

```bash
# Stop containers
docker compose down

# Stop and wipe the database volume (full reset)
docker compose down -v
```

Configuration is split between `docker-compose.yml` (non-sensitive defaults) and a `.env` file (secrets). Copy the example file to get started:

```bash
cp .env.example .env
```

Defaults work out of the box for local use — no edits needed. Docker Compose reads `.env` automatically.

> **Deploying outside a local machine?** Edit `.env` and set `POSTGRES_PASSWORD` to a strong unique value before starting the stack. The PostgreSQL port is bound to `127.0.0.1` by default so it is not reachable from other machines, but the password still matters if the host itself is shared or internet-facing.

---

## Features

- **Log applications**: Company, role, portal URL, status, notes
- **Status tracking**: Applied → Interview → Offer → Accepted / Rejected / Withdrawn / Waitlisted / Ghosted
- **Stale alerts**: Banner appears on load if active applications haven't been checked in `STALE_DAYS` days; re-evaluates every 30 minutes with snooze and midnight-reset logic
- **Auto-ghosting**: Cron runs at 9 AM daily and marks long-stalled applications as `ghosted` based on `APPLIED_GHOST_DAYS` and `INTERVIEW_GHOST_DAYS`
- **"✓ Checked" button**: Updates `last_checked_at`, clearing the stale flag
- **Edit / Delete**: Full CRUD on all applications
- **Filters**: Filter by status, stale, or closed; sort and search by company/role/notes

---

## Email Alerts

Set `EMAIL_ALERTS_ENABLED=true` and provide SMTP config to receive daily stale-application emails.

Required:

```yaml
SMTP_HOST: "smtp.example.com"
ALERT_EMAIL_FROM: "alerts@example.com"
ALERT_EMAIL_TO: "you@example.com"
```

Optional:

```yaml
SMTP_PORT: 587          # default
SMTP_SECURE: "false"    # set "true" for implicit TLS (port 465)
SMTP_USER: ""
SMTP_PASS: ""
```

If required fields are missing, the app logs a warning and continues running without sending email.

Cron logs are written to `./logs/cron.log` on the host (Docker bind-mount) or `LOG_DIR`/`LOG_FILE` locally.

