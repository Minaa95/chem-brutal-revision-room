# SMART ATTENDANCE KMS — Cloudflare proof of concept

Status: isolated prototype; dummy records only; not connected to the live attendance system.

## What this prototype is intended to prove

- Pages serves a lightweight student portal.
- Pages Functions run the API on Cloudflare's Workers runtime.
- D1 stores synthetic student, enrolment, OTP, device, session, attendance and outbox records.
- OTP entry is shown immediately and the demo code is simulated.
- Check-in is idempotent: a unique database constraint prevents a second attendance row for the same student and session.
- Attendance confirmation does not wait for the official BKP spreadsheet.
- An outbox row is written alongside attendance so a future background worker can retry BKP synchronisation independently.

## Safety boundaries

- This branch contains no real KMS student data, email addresses, tokens, deployment IDs, spreadsheet IDs or campus coordinates.
- The 300 students use matric numbers MSDEMO00001 through MSDEMO00300.
- All email addresses use the reserved example.invalid domain.
- The synthetic geofence is at 0,0. The browser does not request the user's real location.
- OTP mode is fixed to a visible demo code. No email is sent.
- The BKP outbox is a simulated pending job. This prototype does not write to Google Sheets.
- Do not connect the live SMART ATTENDANCE database or official BKP workbook.
- Do not merge this branch into the existing production workflow until the institution's ICT/data-protection review and technical acceptance tests are complete.
- Never deploy with DEMO_MODE=true as a real attendance service.

## Cloudflare Pages project settings

Create a separate Pages project named sakms-cloudflare-poc and connect the GitHub repository.

Use these settings:

- Production branch for this separate prototype project: cloudflare-attendance-poc-20261127
- Root directory: cloudflare-poc
- Framework preset: None
- Build command: leave blank
- Build output directory: public

This is a separate Pages project. It does not replace or change the existing GitHub Pages or Apps Script student portal.

## Create the D1 database

Install Node.js LTS, then from the cloudflare-poc directory run:

    npm install
    npx wrangler login
    npx wrangler d1 create sakms-cloudflare-poc

Copy the database ID returned by Wrangler into the database_id field in wrangler.toml. Keep the database name and binding name unchanged.

Apply the migrations to the remote prototype database:

    npx wrangler d1 migrations apply sakms-cloudflare-poc --remote

The first migration creates the schema. The second inserts 300 synthetic students, enrolments and three open demo sessions.

For local-only development, use:

    npx wrangler d1 migrations apply sakms-cloudflare-poc --local
    npm run dev

Local D1 data is separate from the remote database.

## Bind D1 to Pages

The Wrangler configuration declares the binding named DB. If using dashboard-managed bindings instead, open the Pages project, go to Settings > Bindings, add a D1 database binding named DB, select sakms-cloudflare-poc, and redeploy.

If you choose Wrangler configuration as the source of truth, keep the dashboard configuration aligned with wrangler.toml.

## Demo login

Use any seeded student:

- Matric: MSDEMO00001
- Email: student001@example.invalid
- Demo OTP: 246810

Other seeded students use sequential matric numbers and email addresses, up to student300@example.invalid.

All three demo sessions are open for the prototype. The demo check-in uses the synthetic 0,0 coordinate and does not request GPS permission.

## API endpoints

- GET /api/health — runtime and database health.
- GET /api/demo/metrics — aggregate synthetic-record counters only.
- POST /api/auth/request-otp — creates a demo OTP challenge.
- POST /api/auth/verify-otp — consumes a challenge and issues a hashed device token.
- GET /api/me — returns the authenticated synthetic student profile.
- GET /api/sessions — returns open sessions for the synthetic student's classes.
- POST /api/attendance/check-in — validates the synthetic session/geofence and writes attendance plus an outbox event.

## Concurrency test

After the Pages preview is live and the D1 database is migrated, run:

    BASE_URL=https://YOUR-PREVIEW.pages.dev COUNT=100 CONCURRENCY=50 npm run load

Then repeat with COUNT=300 and CONCURRENCY=100.

The test reports request success, failures and p50/p95/max latency for the complete request flow. Use fresh demo records or reset only the isolated prototype database between repeated full-volume tests. Do not point the load test at the live attendance service.

## Production work deliberately not included

Before any real KMS pilot, the project still needs:

1. Institutional approval for the data processor, data location, retention and student-data handling.
2. A real email provider and secure OTP delivery, rate limiting and abuse protection.
3. Turnstile or equivalent bot protection.
4. A production device/session authentication and recovery policy.
5. A real campus geofence, with accuracy and spoofing controls.
6. A durable queue consumer and dead-letter/reconciliation process for official BKP updates.
7. A least-privilege Google integration for the official BKP workbooks.
8. Backup, restore, monitoring, audit retention and incident procedures.
9. Load tests using the actual peak concurrency target and mobile devices/network conditions.

## Performance interpretation

A successful load test is evidence about this prototype only. It is not a guarantee of production capacity. Measure browser load, API latency, database latency, OTP delivery and BKP synchronisation separately.
