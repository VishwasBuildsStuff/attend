# BunkBudget — Project Blueprint

**Project release described:** 2.1.1

**Last updated:** 2026-11-11

This document shows how the BunkBudget pieces fit together. It is an architecture guide, not a list of secrets. Connection strings and signing keys belong in local `.env` or the hosting provider's secret settings.

## 1. Big picture

```mermaid
flowchart LR
  Student[Student's browser]
  Site[Static website: Netlify]
  API[FastAPI service: Render]
  DB[(PostgreSQL: Neon)]
  Local[(Browser storage: localStorage + IndexedDB)]
  PDF[PDF.js in browser]

  Student --> Site
  Site --> Local
  Student --> PDF
  PDF --> Local
  Site -->|/api requests via Netlify proxy| API
  API -->|users and subject attendance| DB
```

The static frontend contains HTML, CSS, and Vanilla JavaScript. Netlify publishes the generated `dist/` folder. The API is a separate Python service. PostgreSQL on Neon stores accounts and subject attendance. Local timetable entries and report files stay in the browser.

## 2. Frontend pieces

| File | What it is responsible for |
|---|---|
| `index.html` | Sends visitors to the account page. |
| `auth.html` / `auth.js` | Signup and login form, frontend validation, calls to `/api/register` and `/api/login`, saves the JWT, and redirects to the dashboard. |
| `dashboard.html` | Main tracker layout, manual subject/timetable controls, PDF import UI, day-bunk controls, and report archive. |
| `app.js` | Attendance math, rendering, local saving, day-bunk simulations, weekly plan, IndexedDB report history, and API attendance sync. |
| `pdf-import.js` | Loads PDF.js, extracts PDF text and timetable positions in the browser, and sends parsed rows to the review UI. |
| `style.css` | Shared responsive dark theme and component styling. |
| `api-config.js` | Uses `http://localhost:8000` on localhost; production uses a same-origin `/api` path. |
| `scripts/build-netlify.mjs` | Copies safe static files and PDF.js assets into `dist/`, then writes a Netlify API proxy rule. |

### Browser storage

- `localStorage` holds the overall tracker state, subjects, weekday timetable, JWT, and a marker for first cloud sync.
- IndexedDB holds uploaded attendance reports and their versions as files.
- Browser storage is local to the current browser profile/device unless a specific API sync feature is used.
- The PDF importer parses on the device; it does not upload PDF contents to FastAPI.

## 3. Backend and database

### FastAPI service

`main.py` creates the FastAPI application and routes. It uses SQLAlchemy's asynchronous engine and `asyncpg` to talk to PostgreSQL. The API uses Pydantic v2 schemas from `schemas.py` to validate request data. `models.py` defines the database tables.

| Route | Purpose | Authentication |
|---|---|---|
| `GET /api/health` | Basic deployment health response. | No token required. |
| `POST /api/register` | Validate a student profile, hash its password, store the user, and return a JWT. | Public. |
| `POST /api/login` | Match USN, registration number, or email and verify the password. | Public. |
| `POST /api/sync` | Create/update the signed-in user's subject attendance; can replace deleted records when requested. | Bearer JWT. |
| `GET /api/attendance` | Return the signed-in user's subject attendance. | Bearer JWT. |
| `GET /api/admin/stats` | Return aggregate account/subject counts. | Admin role and `ADMIN_EMAIL` match required. |

### Database tables

- **`users`**: UUID, name, class, email, USN, registration number, phone, role, and bcrypt password hash. Unique identifiers prevent duplicate accounts.
- **`subject_attendance`**: UUID, owning user UUID, browser subject ID, subject name, attended count, total count, and target percentage. User ownership plus browser subject ID is unique.

At startup, the API runs SQLAlchemy `create_all` and additive PostgreSQL `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for the existing schema. This is a lightweight upgrade path; the project does not currently use Alembic migration files.

## 4. Authentication and request flow

1. `auth.js` sends JSON to the same-origin `/api` path in production or `http://localhost:8000/api` during local development.
2. FastAPI validates the data with Pydantic. Passwords are hashed using Passlib/bcrypt before they are stored.
3. Successful signup/login returns a JWT signed with `SECRET_KEY`. The browser stores that token in localStorage.
4. On dashboard load, `dashboard.html` exposes the stored token to `app.js`. Attendance sync sends it in the `Authorization: Bearer ...` header.
5. FastAPI verifies the signature and expiry, gets the account UUID from the token, and scopes subject queries to that UUID.

The registration request does not accept a role. Every new account is a student. Admin use requires a database role of `admin` and a matching configured `ADMIN_EMAIL`.

## 5. Attendance calculation and planning

- Overall effective total: `total classes − NA slots`.
- Overall percentage: `present ÷ effective total × 100`.
- For target `t`, present `P`, and effective total `E`, classes that can be skipped while staying at target: `floor((P − t × E) ÷ t)` when already at/above target.
- Classes to attend in a row to recover from below target: `ceil((t × E − P) ÷ (1 − t))`.
- The day simulation subtracts one currently counted attended class per occurrence of a subject on that weekday, then checks it against the target.
- The weekly plan evaluates the possible combinations of scheduled weekdays. It uses known attendance counts and the saved weekly subject frequency. Incomplete records prevent a safe whole-day recommendation.

The recommendation is an estimate based on the timetable. It cannot account for future attendance records, cancellations, holidays, or timetable changes unless the student updates the app.

## 6. PDF import flow

1. A PDF is selected or dropped into the attendance or timetable area.
2. `pdf-import.js` loads PDF.js and extracts selectable text with page positions. It rejects files over 35 MB and documents over 100 pages.
3. Attendance parsing looks for subject labels, attendance count pairs, and percentage rows. Timetable parsing looks for weekday headers/columns or weekday-labeled lines.
4. Parsed entries are shown in an editable preview. The student applies them only after review.
5. The same PDF is added to IndexedDB report history, keeping older versions with the same filename.

The parser does not run OCR. Image-only PDFs and unfamiliar layouts may return no rows or imperfect results; review and manual editing remain necessary.

## 7. Build and deployment

### Local development

- Python version target: 3.12 (`.python-version`).
- Start backend from the project root: `uvicorn main:app --reload --port 8000`.
- Serve the frontend from the project root in a second terminal: `python -m http.server 5500`.
- Open `http://localhost:5500`. Do not open the HTML with a `file://` URL.
- Keep `.env` local. It needs a reachable PostgreSQL `DATABASE_URL`, a long random `SECRET_KEY`, and `ADMIN_EMAIL` for admin access.

### Production shape

- **Netlify** builds with `npm run build` and publishes `dist/`.
- **Render** runs `uvicorn main:app --host 0.0.0.0 --port $PORT` using the settings in `render.yaml`.
- **Neon** provides the PostgreSQL database. Set `DATABASE_URL` in Render's service environment. Do not put the value in source files.
- The build writes `/api/*` as a Netlify rewrite to the Render origin. `BUNKBUDGET_API_URL` can override the default origin at build time.
- Production must have the backend deployed separately. Publishing only the Netlify frontend does not create a working login API.

### Deployment and current status

The repository contains Netlify and Render configuration, but configuration files alone do not launch hosted services. On **2026-11-11**, the configured Render host returned `404 Not Found` with `x-render-routing: no-server`, which indicates there was no Render web service responding at that hostname at the time of the check. Login and cloud sync need a live Render service and the correct Netlify `BUNKBUDGET_API_URL`. Verify that the API's `/api/health` endpoint returns `{"status":"ok"}` after deployment.

## 8. Repository map

```text
auth.html, auth.js       Sign in and account creation
dashboard.html           Tracker, PDF import, schedule, report archive
app.js                   Tracker state, calculations, rendering, cloud sync
pdf-import.js            PDF text extraction and parsing
style.css                Page styles and responsive layout
main.py                  FastAPI routes, auth, DB startup and access checks
models.py                SQLAlchemy database models
schemas.py               Pydantic input/output validation
requirements.txt         Python runtime dependencies
package.json             Node build and PDF.js dependencies
scripts/build-netlify.mjs Static publish bundle builder
netlify.toml             Netlify build settings
render.yaml              Render FastAPI service blueprint
.env.example             Names and examples for local environment settings
README.md                 Setup, feature list, and version history
PRD.md                    Product requirements and user behavior
PROJECT_BLUEPRINT.md      Architecture and data flows
TECH_STACK.md             Languages, packages, services, and versions
```
