# 🎓 BunkBudget & Attendance Tracker

A modern, responsive, dark-mode attendance tracker with a FastAPI/PostgreSQL backend, student login, cloud sync, timetable planning, and report archive.

The frontend uses **Vanilla JavaScript** with no application framework. A small build step bundles the PDF.js assets for Cloudflare Workers or the optional Netlify frontend. The FastAPI API uses Neon PostgreSQL.

### 🔐 Student Login
- Sign in with a **USN, registration number, or email** and your password.
- Successful login returns a 60-minute JWT and opens the attendance dashboard.
- Create an account with your name, class, USN, registration number, email, phone, and confirmed password. There are no semester-based ID or email rules.

### 🛡️ Single-owner admin
- Registration always assigns `role="student"`; role is not accepted in the request schema.
- `/api/admin/stats` requires both `role="admin"` and an email matching `ADMIN_EMAIL` from the API environment.
- Promote the verified owner account with `python scripts/promote_admin.py owner@example.com`. Other admin rows cannot use the protected route unless they match the configured owner email.

---

## ✨ Features

### 📊 Overall Dashboard
- Inputs for **Classes Attended (Present)**, **Classes Conducted (Total)**, and **"No Attendance" (NA) slots**.
- **NA-aware math:** NA slots are subtracted from the Total. Your percentage is strictly `Present / (Total − NA)` = `Present / (Present + Absent)`.
- Target toggle: **75% Standard** or **76% Safe Target**.
- Animated **circular SVG progress ring** that changes color (emerald → amber → rose) based on your status vs. target.

### ✅ Bunk Budget Calculator
When you're **above target**, it tells you exactly how many classes you can skip while staying at/above the target:

```
bunks = Math.floor((present - target * total) / target)
```

### 🚨 Recovery Mode Calculator
When you're **below target**, it computes how many **consecutive** classes you must attend to pull your average up:

```
needed = Math.ceil((target * total - present) / (1 - target))
```

Displays a prominent warning card: *"Attend the next X classes in a row to reach Y%."*

### 📚 Subject-wise Tracker
- Add unlimited subjects (Name, Present, Total).
- Individual animated progress bars.
- Color coding: 🟢 Green ≥ 80% · 🟡 Yellow 75–79% · 🔴 Red < 75%.
- Pulsing **"⚠ Risk" badge** on any subject below 75%.
- Delete any subject with one click.

### 🗓️ Day Bunking
- Assign subject names to Monday-Friday schedules one class at a time. Repeated entries represent multiple classes of the same subject on that day.
- Select a day to preview its timetable and simulate bunking it against the current 75% or 76% target.
- The simulation subtracts one currently counted attended class for each scheduled occurrence, clamped at zero, and lists subjects projected below the target. Timetable assignments are saved with the local tracker data.
- The weekly planner evaluates combinations of scheduled days and recommends an attend/bunk plan for the coming week. It flags missing attendance or timetable data and will not claim a plan is safe until those records are complete.

### 💾 Data Persistence
- Overall inputs, target selection, and subjects auto-save to **`localStorage`** — data survives refreshes and browser restarts.
- The **Reset Tracker** button clears tracker values and subjects (with confirmation); saved attendance reports remain in the report archive.
- On a user's first authenticated session, the cloud sync hook uploads local subjects and marks that user migrated only after a successful API response. Subsequent authenticated sessions load that user's cloud subjects; adding/removing subjects or changing the target syncs the updated list.

### 🗃️ Attendance Report Archive
- Drop or select downloaded **PDF, CSV, Excel, or JSON** attendance reports.
- Each uploaded file is saved in this browser's IndexedDB storage. Uploading a report with the same filename creates the next version; earlier versions remain available to download.
- The archive is local to the browser and device where reports were uploaded. Clearing browser site data can remove it, so download copies you need to keep elsewhere.
- Attendance shortage and timetable PDFs can be parsed locally, reviewed, and selectively applied to the tracker. CSV, Excel, and JSON files remain archive-only.
- The archive keeps report files and their version history. Uploading the same filename creates another version without deleting earlier copies.
- PDF parsing currently needs selectable text; scanned image-only PDFs need manual entry or OCR outside this importer.

### 🛡️ Safe Math
- No division-by-zero (Total = 0 shows "—" instead of NaN/Infinity).
- NA clamped so it can never exceed Total; Present clamped so it can never exceed Total per subject.
- Negative/non-numeric inputs treated as 0.

---

## 🗂 Project Structure

```
.
├── index.html       # Redirects to the authentication page
├── auth.html        # Unified sign-in/sign-up page
├── auth.js          # Sign-in/sign-up requests, token storage, and dashboard redirect
├── api-config.js    # Local API URL; production calls the same-origin /api path
├── dashboard.html   # Attendance tracker page after login
├── style.css    # Dark theme, glassmorphism, mobile-first responsive layout, animations
├── app.js           # Calculations, rendering, localStorage, optional cloud sync
├── pdf-import.js    # Browser-side PDF extraction and editable attendance/timetable previews
├── main.py          # FastAPI auth, attendance, and admin API
├── render.yaml      # Optional conventional web-service blueprint
├── netlify.toml     # Netlify build and publish settings
├── wrangler.jsonc   # Cloudflare Python Worker configuration
├── worker.py        # FastAPI ASGI entrypoint for Cloudflare Workers
├── pyproject.toml   # Python Worker dependencies
├── scripts/         # Frontend builders, admin CLI, and Neon migration
├── models.py        # SQLAlchemy user and attendance models
├── schemas.py       # Pydantic v2 request/response validation
├── .env.example     # Environment variable template (copy to .env)
├── neon.ts          # Neon branch configuration
├── package.json     # Frontend build and PDF.js dependencies
├── requirements.txt # Python backend dependencies
└── README.md        # You are here
```

## 📚 Project documents

- [PRD.md](PRD.md) — product goals, requirements, user flows, and current limitations.
- [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md) — how the browser, API, database, and hosting fit together.
- [TECH_STACK.md](TECH_STACK.md) — languages, packages, services, versions, and what each one does.

---

## 📅 Feature and Version History

### Version 2.1.1 — 2026-11-11
- **Login API diagnostics:** Show actionable guidance when the configured API returns 404 or is unavailable, instead of a generic request error.

### Version 2.1.0 — 2026-11-11
- **Attendance PDF import:** Parse subject attendance from text-based shortage reports, review/edit detected subject totals, then update matching subjects while preserving other manual entries.
- **Timetable PDF import:** Detect weekday/subject entries, review/edit them, then merge into or replace the current timetable.
- **Weekly planning:** Calculate which weekdays to attend or bunk based on the selected target and estimate recovery days from the timetable; incomplete data is flagged before showing a safe plan.
- **Archive integration:** Imported PDFs are also saved in the existing versioned local report archive.
- **Private parsing:** PDF text is extracted in the browser and is not sent to the API. Scanned image-only PDFs need manual entry or external OCR.
- **PDF.js production assets:** Vendor PDF.js and required assets into the static Netlify bundle; use Node 22.13.0 for the build.

### Version 2.0.0 — 2026-11-11
- **Netlify production frontend:** Added a build step that publishes only the website files, excluding backend source and local secrets.
- **Hosted API routing:** Login, registration, and attendance requests use localhost during local development and a same-origin Netlify proxy in production.
- **FastAPI hosting blueprint:** Added Render configuration, an API health route, and a generated secret key for hosted API deployment.

### Version 1.9.0 — 2026-11-11
- **Neon PostgreSQL connection:** Linked the backend to the existing Neon project `divine-grass-66506262` in organization `org-soft-forest-29215727`.
- **Secure environment config:** Neon populated the local `.env` with pooled and unpooled database URLs plus branch metadata; `.env` remains excluded from source control.
- **Async SQLAlchemy compatibility:** The API now adapts Neon’s standard PostgreSQL URL and TLS query options for its `asyncpg` driver.
- **Neon project setup:** Added the generated `.neon` project link and `neon.ts` branch configuration.

### Version 1.8.0 — 2026-11-10
- **Unified student registration:** Removed semester-specific ID and email rules. Signup now collects name, class, USN, registration number, email, phone, and password confirmation.
- **Simpler sign-in:** Students can sign in with their USN, registration number, or email.
- **Profile storage:** Added student class, registration number, and phone number to the user model and database upgrades.

### Version 1.7.0 — 2026-11-10
- **Semester-based email policy:** Previously added semester-specific registration validation; removed in 1.8.0.
- **Backend enforcement:** Previously added frontend and Pydantic enforcement; removed in 1.8.0.
- **Single-owner admin:** Added `.env` owner email configuration and an admin dependency that checks both account role and configured email.
- **Separated auth files:** Added `auth.html`, `models.py`, and `schemas.py`; kept the tracker available in `dashboard.html`.

### Version 1.6.0 — 2026-11-10
- **DSATM email restriction:** Added the initial college email restriction for registration.

### Version 1.5.0 — 2026-11-10
- **New student accounts:** Added account creation with full name, semester-specific ID type, student email, password, and password confirmation.
- **Secure registration:** Added email/USN validation, duplicate checks, bcrypt password hashing, and immediate JWT sign-in.
- **Database upgrade:** Added name and email fields for users, including a case-insensitive unique email index.

### Version 1.4.0 — 2026-11-10
- **Unified student login:** Added a single ID/USN form for temporary IDs and standard USNs.
- **Password authentication:** Added bcrypt verification and expiring JWT issuance to FastAPI.
- **Dashboard access:** Added login redirect and connected the issued token to existing attendance cloud sync.

### Version 1.3.0 — 2026-11-10
- **Day Bunking:** Added Monday-Friday timetable setup with repeatable subject class assignments.
- **Danger Zone simulation:** Added per-subject projection against the selected attendance target, with warnings for subjects below target or without matching attendance data.
- **Local persistence:** Saved timetable assignments in the existing browser tracker state.

### Version 1.2.0 — 2026-11-10
- **Cloud sync:** Added first-login migration of local subject attendance and authenticated cloud loading.
- **FastAPI API:** Added Pydantic-validated `POST /api/sync` and `GET /api/attendance` endpoints backed by PostgreSQL.
- **User isolation:** API derives the user UUID from a verified JWT subject claim; subject upserts use stable browser IDs.
- **Ongoing sync:** Authenticated subject and target changes sync to the API; full-list updates also carry subject deletions.

### Version 1.1.0 — 2026-11-10
- **Attendance report archive:** Added PDF, CSV, Excel, and JSON report upload and drag-and-drop.
- **Report version history:** Re-uploading a file with the same name creates a dated version while keeping all earlier versions downloadable.
- **Local storage:** Report files are stored in the browser's IndexedDB on the current device.

### Version 1.0.0 — 2026-10-29
- **Attendance dashboard:** Added overall attendance calculation, target selection, bunk budget, and recovery mode.
- **Subject tracker:** Added subject-wise attendance, progress indicators, and risk status.
- **Browser persistence:** Added local saving for tracker values and subjects.

---

## 🧮 How the Math Works

Let `P` = present, `T` = total conducted, `N` = NA slots, `E = T − N` (effective total), `t` = target as a decimal (0.75 or 0.76).

| Situation | Formula | Meaning |
|---|---|---|
| Current % | `P / E × 100` | NA slots excluded entirely |
| Above target | `⌊(P − t·E) / t⌋` | Classes you can safely bunk |
| Below target | `⌈(t·E − P) / (1 − t)⌉` | Consecutive attends needed to recover |

**Example:** P = 42, T = 60, N = 3 → E = 57 → 73.7% (below 75%). Recovery: `⌈(0.75×57 − 42)/0.25⌉ = ⌈0.75/0.25⌉ = 3` classes in a row.

---

## 🚀 Run It Locally

1. Install backend dependencies with `pip install -r requirements.txt`.
2. Keep `.env` local and ignored by Git. For the linked Neon project, Neon CLI has populated `DATABASE_URL` and branch metadata in `.env`; set a long random `SECRET_KEY` and the single owner's `ADMIN_EMAIL` there if they are not already configured. For another database, copy `.env.example` to `.env` and fill its values. `load_dotenv()` reads this file during local Uvicorn runs.
3. Run `scripts/cloudflare-neon-migration.sql` once in the intended Neon branch. It prepares the schema and enables `pgcrypto` without deleting existing rows.
4. Start the API from PowerShell:

   ```powershell
   uvicorn main:app --reload --port 8000
   ```

5. In a second terminal, serve the project root with `python -m http.server 5500`, then visit `http://localhost:5500`.

The API no longer creates or alters tables on startup. Run `scripts/cloudflare-neon-migration.sql` once before using a new database. Local Uvicorn uses Neon’s pooled `DATABASE_URL` through `asyncpg`; `DATABASE_URL_UNPOOLED` is available for migrations or direct database tasks. Signup requires a valid email, class, USN, registration number, phone, and matching password confirmation; it has no semester-based rules. Passwords remain bcrypt hashes, created and verified with Neon `pgcrypto`. Login accepts the student's USN, registration number, or email. New accounts are always students.

To grant the configured owner admin access, first create that account, then run `python scripts/promote_admin.py owner@example.com` from the repository root. Replace the address with the exact `ADMIN_EMAIL`. The script reads `DATABASE_URL` from `.env`, promotes only an existing account, and reports if no matching user exists. No public API accepts a role. Admin requests receive 403 unless both the JWT user's database role is `admin` and their email equals `ADMIN_EMAIL`.

### Login troubleshooting

For local use, confirm the backend dependencies are installed, `.env` contains a reachable PostgreSQL `DATABASE_URL` and `SECRET_KEY`, `uvicorn main:app --reload --port 8000` is running, and the frontend is served from `http://localhost:5500` (not opened directly as a `file://` page). For Cloudflare, use the setup in [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md), then confirm the Worker health endpoint returns `{"status":"ok"}`.

---

## 🌐 Deploy It

Cloudflare can serve the static frontend and FastAPI API from the same Worker, while Neon stores PostgreSQL data. Netlify remains optional for the frontend. Keep `.env` out of the repository.

1. Run `scripts/cloudflare-neon-migration.sql` in the Neon SQL Editor for the intended database branch.
2. Create a Cloudflare Hyperdrive configuration for Neon and copy its ID into `wrangler.jsonc`. Set `SECRET_KEY` and `ADMIN_EMAIL` as Worker settings; do not commit secrets.
3. Confirm the Hyperdrive ID in `wrangler.jsonc` matches the configuration you created. Configure the Cloudflare GitHub build with root `/`, build command `uv sync && npm ci && npm run build:worker`, and deploy command `uv run pywrangler deploy`.
4. Confirm `https://attend.vishwasbnglr2024.workers.dev/api/health` returns `{"status":"ok"}`.
5. Open `https://attend.vishwasbnglr2024.workers.dev/auth` to use the app. If you choose to keep Netlify for the frontend, set `BUNKBUDGET_API_URL` to `https://attend.vishwasbnglr2024.workers.dev` and redeploy Netlify.

See [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md) for setup details and Worker limits. Netlify's proxy keeps browser requests on the frontend origin.

---

## 🎨 Design Notes

- **Theme:** `#121212` / `#1e1e1e` dark palette with emerald (`#10b981`), amber (`#f59e0b`), and rose (`#f43f5e`) accents.
- **Glassmorphism cards** using `backdrop-filter: blur()`, soft shadows, and subtle borders.
- **Typography:** Inter via Google Fonts.
- **Mobile-first:** single-column on phones, 2-column grids from `720px` up; comfortable down to ~320px viewports.
- **Animations:** pop-in result numbers, sliding subject rows, animated progress rings/bars, hover lifts, pulsing risk badges.

---

## 📄 License

MIT — use it, fork it, bunk responsibly. 😉
