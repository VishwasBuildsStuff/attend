# BunkBudget — Product Requirements Document

**Project:** BunkBudget attendance tracker

**Document version:** 1.0

**Project release described:** 2.1.1

**Last updated:** 2026-11-11

## 1. What BunkBudget does

BunkBudget helps a student understand their class attendance and make a more informed decision about attending or missing classes. Students can enter attendance manually, use a timetable, or upload text-based PDF reports to fill in the tracker. The app calculates current percentages, recovery needs, and possible attend/bunk plans.

The project has a browser-based website and a Python API. The website can save tracker data on the current device. The API can authenticate accounts and store subject attendance in PostgreSQL when the API is deployed and reachable.

## 2. The problem

Students often download attendance reports and manually copy subject counts into a tracker. The old upload flow kept report files but did not use them to update attendance or planning. Students also needed a way to compare their subject attendance against their weekly timetable before missing a day.

## 3. Who it is for

- **Student:** creates an account, enters or imports attendance, sets up a timetable, and checks attendance and bunk calculations.
- **Site owner:** can be assigned the single admin role and use the protected admin statistics endpoint.
- **Project maintainer:** configures the database and hosting, reviews changes, and keeps secrets out of source control.

## 4. Goals

- Make it easy to maintain subject-wise attendance manually or from a report.
- Keep manual editing available even when PDF import is used.
- Show whether an individual class or a whole timetable day may put a subject below the selected target.
- Estimate which scheduled days to attend and how much recovery may be needed.
- Keep uploaded reports and older versions in the browser archive.
- Provide account registration and login through one simple form.
- Explain clearly when the hosted API is not available.

## 5. Out of scope today

- Reading scanned/image-only PDFs with optical character recognition (OCR).
- Automatically receiving attendance from a college portal.
- Automatically fetching a student's timetable from a college system.
- Storing the PDF archive or timetable in PostgreSQL/cloud sync.
- Email verification, password reset emails, SMS login, or college email restrictions.
- Guaranteeing attendance outcomes when classes are cancelled, moved, or changed outside the saved timetable.

## 6. Product behavior and requirements

### 6.1 Account access

- A student can create an account with full name, class, 10-character alphanumeric USN, registration number, email, phone, password, and password confirmation.
- Passwords must match and be at least 8 characters. The backend also limits passwords to 72 UTF-8 bytes for bcrypt compatibility.
- Registration does not use semester-specific rules or require a particular email domain.
- A student can log in with their USN, registration number, or email and password.
- The backend stores a bcrypt password hash, not the original password, and returns a signed JSON Web Token (JWT) after successful login or registration.
- Public registration always creates a student account. The request cannot set a role.
- The admin statistics endpoint is available only if both the database role is `admin` and the account email matches the configured `ADMIN_EMAIL`.

### 6.2 Attendance tracker

- The student can enter overall present classes, total classes, and “No Attendance” (NA) slots.
- Effective total is `total classes − NA slots`.
- Attendance percentage is `present ÷ effective total × 100`.
- The target can be set to 75% or 76%.
- For each subject, the student can add, edit, and remove attended and total class counts.
- Invalid or incomplete numbers are clamped or treated as zero where needed to avoid negative counts and division by zero.
- Subjects, overall counts, target, and timetable are saved in browser `localStorage`.

### 6.3 Manual day schedule and bunking

- The student can assign any subject to Monday through Friday. Repeating a subject represents multiple classes that day.
- The student can simulate missing one day. The app checks every occurrence of each subject on that weekday and lists subjects that would fall below the selected target.
- The weekly planner compares possible combinations of scheduled days and gives a plan for the upcoming timetable week.
- The planner flags subjects that have no attendance counts or no timetable entries. It must not label a whole-day plan safe while relevant records are incomplete.
- Recovery estimates are based on the saved weekly timetable. Real cancellations and timetable changes can make the estimate inaccurate.

### 6.4 PDF import and report archive

- The student can drop or select an attendance shortage PDF and a weekly timetable PDF.
- The browser extracts selectable PDF text locally using PDF.js; PDF content is not sent to the FastAPI API.
- The app shows extracted rows in a preview before changes are applied. The student can edit or remove rows.
- Attendance import updates matching subjects by default, adds newly found subjects, and preserves unrelated manually entered subjects. The update option can be unchecked.
- Timetable import merges with the manual schedule by default. The student can choose to replace the existing timetable.
- PDFs are also saved in the browser's IndexedDB report archive. Uploading the same filename adds a new version; older versions remain downloadable.
- CSV, Excel, and JSON uploads are retained in the archive but are not parsed into the tracker.
- Scanned PDFs without selectable text are not imported automatically.
- The report archive exists only in that browser profile/device. Browser site-data removal can delete it.

### 6.5 Cloud attendance sync

- The API supports authenticated subject attendance sync and retrieval.
- On a dashboard page load, the frontend reads the stored JWT and invokes the cloud sync flow.
- The first sync for an account uploads local subjects; later visits load cloud attendance. Subject changes can be sent to the API.
- The API derives the user ID from the verified JWT, so a request cannot choose another user's records.
- At present, the timetable and archived PDF files remain browser-local; they are not part of the cloud attendance endpoints.
- Cloud behavior depends on the FastAPI service and PostgreSQL database being deployed and reachable.

## 7. Main user journeys

### New or returning student

1. Open the site and choose **Create account** or **Sign in**.
2. Register with the requested details or enter USN, registration number, or email and password.
3. The API validates the request and returns a JWT.
4. The browser stores the token and opens the dashboard.

### Import attendance and timetable

1. Upload an attendance shortage PDF and review the proposed subject rows.
2. Edit or remove incorrect rows, then apply them while keeping other manual subjects.
3. Upload the timetable PDF and review weekday/subject rows.
4. Merge it with the existing schedule or explicitly choose to replace the schedule.
5. Review the attendance and day-bunk calculations; fill in any subjects reported as missing.

### Maintain data manually

1. Add or change subject attendance counts in the tracker.
2. Add or change class entries under each weekday.
3. Check a single-day bunk simulation or read the weekly plan.

## 8. Acceptance criteria

- A user can register and log in with the documented fields and identifiers.
- Invalid credentials show an understandable message; unavailable or missing API responses show deployment guidance.
- Manual attendance and timetable editing remain available with or without PDF import.
- Import always provides a review step before modifying the tracker.
- Attendance imports preserve manual subjects not present in the report.
- Timetable imports merge by default and replace only when the user selects that option.
- Prior report versions remain downloadable after another upload with the same filename.
- Bunking calculations use the chosen 75% or 76% target and display missing information.
- Private environment files and personal sample reports are not added to Git.

## 9. Known limitations and operational status

- PDF extraction is designed for text-based reports. Different PDF layouts may need parser improvements, and the review screen is important for catching extraction mistakes.
- The day planner assumes the saved weekly timetable repeats in the coming week; it does not know about holidays or cancellations.
- On 2026-11-11, the configured Render API hostname returned `404` with `x-render-routing: no-server`. The frontend code and Render blueprint exist, but login and cloud sync require a deployed FastAPI service at the configured URL. See [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md#deployment-and-current-status).
