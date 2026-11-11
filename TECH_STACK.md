# BunkBudget — Technology Stack

**Project release described:** 2.1.1

**Last updated:** 2026-11-11

This document lists the technologies used by the current BunkBudget project and what each one does. A version range means the package file allows compatible updates inside that range; it does not pin one exact version for every installation.

## 1. Frontend

| Technology | Current use |
|---|---|
| HTML5 | Page structure for login, registration, and the tracker. |
| CSS3 | Responsive dark theme, layouts, forms, buttons, and status visuals. |
| Vanilla JavaScript | Browser logic without a frontend framework. It handles forms, attendance calculations, local saving, API calls, and rendering. |
| PDF.js (`pdfjs-dist`) `^6.5.438` | Reads text and page positions from PDFs in the browser. It does not provide OCR for scanned images. |
| `localStorage` | Saves tracker values, subject rows, weekday timetable, and access token in the browser. |
| IndexedDB | Saves uploaded report files and multiple versions in the browser. |

The frontend does not use React, Vue, Angular, or a JavaScript application framework. The deployed site is static HTML, CSS, JavaScript, and vendored PDF.js files.

## 2. Frontend build tools

| Tool | Version/configuration | Why it is present |
|---|---|---|
| Node.js | `.nvmrc` targets `22.13.0` | Runs the static Netlify build script and supports the installed PDF.js package. |
| npm | Uses `package.json` and `package-lock.json` | Installs build-time JavaScript dependencies and runs `npm run build`. |
| `@neon/config` | `^1.14.0` | Neon project/branch configuration tooling. |
| `@neon/env` | `^2.1.3` | Neon environment setup tooling. |
| `scripts/build-netlify.mjs` | Project script | Copies only website files and required PDF.js assets into `dist/`; writes a Netlify API proxy rule. |

`dist/` and `node_modules/` are generated/local folders and are ignored by Git. The build output includes PDF.js modules, worker, character maps, color profiles, fonts, and WASM assets needed for browser PDF reading.

## 3. Backend

| Technology | Version range/configuration | Why it is used |
|---|---|---|
| Python | `.python-version` targets `3.12` | Runs the API. |
| FastAPI | `>=0.115,<1.0` | Defines HTTP routes and API behavior. |
| Uvicorn | `>=0.30,<1.0` | Runs the FastAPI application as an ASGI server. |
| Pydantic | `>=2.8,<3.0` | Validates request bodies and shapes API responses. |
| SQLAlchemy asyncio | `>=2.0,<3.0` | Maps Python models to database tables and performs asynchronous SQL queries. |
| asyncpg | `>=0.29,<1.0` | PostgreSQL driver used by SQLAlchemy's async engine. |
| PyJWT | `>=2.8,<3.0` | Signs and verifies expiring JWT access tokens. |
| Passlib + bcrypt | Passlib `>=1.7.4,<2.0`; bcrypt `>=4.0,<4.1` | Hashes passwords for storage and checks login passwords. |
| python-dotenv | `>=1.0,<2.0` | Loads local `.env` values during development. |

Exact allowed ranges are recorded in `requirements.txt`. The application currently creates/updates tables with SQLAlchemy `create_all` and additive SQL statements at startup; Alembic is not currently installed.

## 4. Database and hosting

| Service/configuration | Role |
|---|---|
| PostgreSQL | Relational database for user accounts and subject attendance. |
| Neon | Hosted PostgreSQL provider configured for this project. The connection string must remain a secret environment variable. |
| Netlify | Hosts the static frontend and rewrites `/api/*` requests to the backend origin. |
| Render | Intended host for the FastAPI web service, described in `render.yaml`. |
| GitHub | Source repository for the project. Secrets, `node_modules`, `dist`, and personal sample PDFs are excluded from commits. |

These are the configured deployment roles. A configuration file does not mean a service is currently deployed. As checked on 2026-11-11, the configured Render hostname responded with `x-render-routing: no-server`; deploy/activate the Render service and verify `/api/health` before relying on login or cloud sync.

## 5. Security and configuration

- `DATABASE_URL`, `SECRET_KEY`, and `ADMIN_EMAIL` are environment settings, not hard-coded source values.
- `.env` is ignored by Git. `.env.example` documents expected variable names without live credentials.
- Account passwords are stored as bcrypt hashes.
- API access tokens are JWTs signed with `SECRET_KEY` and expire after 60 minutes.
- Protected attendance routes get the user's UUID from the validated JWT and filter database rows by that ID.
- Signup always assigns `student`; admin access needs a matching database role and `ADMIN_EMAIL`.
- Production browser requests use the Netlify same-origin proxy. Local browser requests use `http://localhost:8000`.
- PDF files are processed in the browser and saved in browser IndexedDB. They are not uploaded to the API by the PDF import feature.

## 6. Data storage at a glance

| Data | Where it is stored now |
|---|---|
| Login account and password hash | PostgreSQL (`users` table) |
| Subject attendance | Browser `localStorage`; can also sync to PostgreSQL (`subject_attendance`) after login when the API is available |
| Overall attendance, target, timetable | Browser `localStorage` |
| Uploaded reports and prior versions | Browser IndexedDB |
| JWT access token | Browser `localStorage` |
| Database/API secrets | Local `.env` or hosting provider environment settings; never in Git |

## 7. Useful commands

```powershell
# Install Python dependencies
pip install -r requirements.txt

# Run the API locally from the repository root
uvicorn main:app --reload --port 8000

# Serve the website locally in a second terminal
python -m http.server 5500

# Install JavaScript/build dependencies
npm install

# Build the static Netlify publish folder
npm run build
```

Open `http://localhost:5500` for local use. The backend needs a valid `.env` and a reachable PostgreSQL database. The built static site is in `dist/`.
