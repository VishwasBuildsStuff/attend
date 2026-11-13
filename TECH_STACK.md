# BunkBudget — Technology Stack

**Project release described:** Cloudflare Worker deployment preparation

**Last updated:** 2026-11-14

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
| npm | Uses `package.json` and `package-lock.json` | Installs build-time JavaScript dependencies and runs the Netlify or Cloudflare asset build. |
| `@neon/config` | `^1.14.0` | Neon project/branch configuration tooling. |
| `@neon/env` | `^2.1.3` | Neon environment setup tooling. |
| `scripts/build-netlify.mjs` | Project script | Copies website files and PDF.js assets into `dist/`; writes a Netlify API proxy rule for the optional Netlify frontend. |
| `scripts/build-cloudflare.mjs` | Project script | Copies website files and PDF.js assets into `dist/` without Netlify-specific routing, for the Worker assets binding. |

`dist/` and `node_modules/` are generated/local folders and are ignored by Git. The build output includes PDF.js modules, worker, character maps, color profiles, fonts, and WASM assets needed for browser PDF reading.

## 3. Backend

| Technology | Version range/configuration | Why it is used |
|---|---|---|
| Python | `.python-version` targets `3.13` | Runs the API locally and on Cloudflare Python Workers. |
| FastAPI | `>=0.115,<1.0` | Defines HTTP routes and API behavior. |
| Uvicorn | `>=0.30,<1.0` | Runs the FastAPI application as an ASGI server. |
| Pydantic | `>=2.8,<3.0` | Validates request bodies and shapes API responses. |
| asyncpg | `>=0.29,<1.0` in local requirements; `<0.32` for Workers | Direct asynchronous PostgreSQL access from the FastAPI app through Neon Hyperdrive. |
| SQLAlchemy asyncio | `>=2.0,<3.0` | Used by the admin-promotion CLI and model declarations; the API uses asyncpg directly for Cloudflare compatibility. |
| PyJWT | `>=2.8,<3.0` | Signs and verifies expiring JWT access tokens. |
| PostgreSQL `pgcrypto` | Database extension | Creates and verifies bcrypt password hashes at cost 12 in Neon, outside the Worker CPU budget. |
| python-dotenv | `>=1.0,<2.0` | Loads local `.env` values during development. |

Exact allowed ranges are recorded in `requirements.txt` and `pyproject.toml`. Apply schema changes with `scripts/cloudflare-neon-migration.sql`; the API does not run DDL at startup.

## 4. Database and hosting

| Service/configuration | Role |
|---|---|
| PostgreSQL | Relational database for user accounts and subject attendance. |
| Neon | Hosted PostgreSQL provider configured for this project. The connection string must remain a secret environment variable. |
| Cloudflare Workers | Primary deployment: serves static frontend assets and runs FastAPI through the Python Workers ASGI entrypoint. |
| Cloudflare Hyperdrive | Connects the Worker to Neon PostgreSQL using a configured binding. |
| Netlify | Optional static frontend host; its build can rewrite `/api/*` requests to the Worker. |
| Render | Optional conventional web-service blueprint retained in `render.yaml`. |
| GitHub | Source repository for the project. Secrets, `node_modules`, `dist`, and personal sample PDFs are excluded from commits. |

Cloudflare Workers can serve the frontend and API together, and Neon stores PostgreSQL data. Netlify remains an optional frontend host. Cloudflare Worker and Hyperdrive configuration must be completed before the API is available; verify `/api/health` after deployment.

## 5. Security and configuration

- `DATABASE_URL`, `SECRET_KEY`, and `ADMIN_EMAIL` are environment settings, not hard-coded source values.
- `.env` is ignored by Git. `.env.example` documents expected variable names without live credentials.
- Account passwords are stored as bcrypt hashes generated and verified by Neon `pgcrypto`.
- API access tokens are JWTs signed with `SECRET_KEY` and expire after 60 minutes.
- Protected attendance routes get the user's UUID from the validated JWT and filter database rows by that ID.
- Signup always assigns `student`; admin access needs a matching database role and `ADMIN_EMAIL`.
- Production browser requests use the same-origin `/api` path on Cloudflare, or the Netlify rewrite when Netlify hosts the frontend. Local browser requests use `http://localhost:8000`.
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
# Install local Python API and admin CLI dependencies
pip install -r requirements.txt

# Run the API locally from the repository root
uvicorn main:app --reload --port 8000

# Serve the website locally in a second terminal
python -m http.server 5500

# Install JavaScript/build dependencies
npm install

# Build the static Netlify publish folder (optional Netlify frontend)
npm run build

# Build static assets for Cloudflare Workers
npm run build:worker
```

Open `http://localhost:5500` for local use. The backend needs a valid `.env` and a reachable PostgreSQL database. The built static site is in `dist/`.
