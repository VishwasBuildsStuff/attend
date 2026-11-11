/* =========================================================
   BunkBudget & Attendance Tracker — app.js
   Vanilla JS · localStorage persistence · safe math
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Storage keys & state ---------- */
  const STORE_KEY = 'bunkbudget:v1';
  const CLOUD_SYNC_KEY = 'bunkbudget:cloudSyncedUsers:v1';
  const LOCAL_OWNER_KEY = 'bunkbudget:localOwner:v1';
  const API_BASE_URL = window.BUNKBUDGET_API_BASE_URL || '';
  let activeCloudToken = null;
  let cloudWriteQueue = Promise.resolve();
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  function createEmptyTimetable() {
    return Object.fromEntries(WEEKDAYS.map((day) => [day, []]));
  }

  const defaultState = {
    present: '',
    total: '',
    na: '',          // "No Attendance" slots — excluded from Total
    target: 0.75,    // 0.75 (standard) or 0.76 (safe target)
    subjects: [],    // [{ id, name, present, total }]
    timetable: createEmptyTimetable()
  };

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(defaultState);
      const parsed = JSON.parse(raw);
      const restored = { ...structuredClone(defaultState), ...parsed };
      restored.timetable = normalizeTimetable(restored.timetable);
      return restored;
    } catch {
      return structuredClone(defaultState);
    }
  }

  function normalizeTimetable(value) {
    const timetable = createEmptyTimetable();
    if (!value || typeof value !== 'object') return timetable;
    WEEKDAYS.forEach((day) => {
      if (Array.isArray(value[day])) {
        timetable[day] = value[day].filter((name) => typeof name === 'string');
      }
    });
    return timetable;
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('localStorage unavailable:', e);
    }
  }

  /* ---------- DOM refs ---------- */
  const $ = (sel) => document.querySelector(sel);

  const presentInput  = $('#presentInput');
  const totalInput    = $('#totalInput');
  const naInput       = $('#naInput');
  const targetBtns    = document.querySelectorAll('.toggle-btn[data-target]');

  const circleEl      = $('#circleProgress');
  const percentText   = $('#percentText');
  const effectiveStats= $('#effectiveStats');

  const bunkCard      = $('#bunkCard');
  const bunkCount     = $('#bunkCount');
  const recoveryCard  = $('#recoveryCard');
  const recoveryCount = $('#recoveryCount');
  const recoveryDesc  = $('#recoveryDesc');
  const statusCard    = $('#statusCard');
  const statusTitle   = $('#statusTitle');
  const statusDesc    = $('#statusDesc');

  const subjectForm   = $('#subjectForm');
  const subjName      = $('#subjName');
  const subjPresent   = $('#subjPresent');
  const subjTotal     = $('#subjTotal');
  const subjectList   = $('#subjectList');
  const emptyNote     = $('#emptySubjects');

  const daySelect       = $('#daySelect');
  const timetableSubject= $('#timetableSubject');
  const addTimetableBtn = $('#addTimetableClass');
  const scheduleTitle   = $('#scheduleTitle');
  const scheduleCount   = $('#scheduleCount');
  const dayScheduleList = $('#dayScheduleList');
  const emptyDaySchedule= $('#emptyDaySchedule');
  const simulateDayBtn  = $('#simulateDayBtn');
  const dayBunkResult   = $('#dayBunkResult');

  const resetBtn      = $('#resetBtn');
  const reportInput   = $('#reportFileInput');
  const reportDropZone= $('#reportDropZone');
  const reportList    = $('#reportList');
  const emptyReports  = $('#emptyReports');
  const reportStatus  = $('#reportStatus');
  const attendanceImportPreview = $('#attendanceImportPreview');
  const attendanceImportRows = $('#attendanceImportRows');
  const updateMatchingSubjects = $('#updateMatchingSubjects');
  const timetableImportPreview = $('#timetableImportPreview');
  const timetableImportRows = $('#timetableImportRows');
  const replaceTimetable = $('#replaceTimetable');
  const weeklyPlanResult = $('#weeklyPlanResult');

  let pendingAttendanceImport = [];
  let pendingTimetableImport = [];

  const REPORT_DB = 'bunkbudget:reports:v1';
  const REPORT_STORE = 'reports';

  /* ---------- Helpers ---------- */
  const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const clampPct = (p) => Math.max(0, Math.min(100, p));

  /**
   * Effective totals with NA handling:
   * The user enters "Classes Conducted" (which may include NA slots).
   * Valid/attended-eligible classes = Total - NA.
   * Percentage is strictly Present / (Present + Absent) i.e. Present / (Total - NA).
   */
  function computeOverall() {
    const present = toInt(presentInput.value);
    const rawTotal = toInt(totalInput.value);
    const na = Math.min(toInt(naInput.value), rawTotal); // NA can't exceed total
    const effectiveTotal = rawTotal - na;                // Total strictly = Present + Absent
    const pct = effectiveTotal > 0 ? (present / effectiveTotal) * 100 : null;
    return { present, rawTotal, na, effectiveTotal, pct };
  }

  /* ---------- Rendering: dashboard ---------- */
  function renderDashboard() {
    const { present, rawTotal, na, effectiveTotal, pct } = computeOverall();
    const target = state.target;
    const targetPct = target * 100;

    // Circular progress
    if (pct === null) {
      circleEl.style.setProperty('--progress', 0);
      delete circleEl.dataset.state;
      percentText.textContent = '—';
      effectiveStats.textContent = 'Enter your stats to see results.';
    } else {
      const clamped = clampPct(pct);
      circleEl.style.setProperty('--progress', (clamped / 100).toFixed(4));
      circleEl.dataset.state = pct >= targetPct ? 'safe' : pct >= targetPct - 5 ? 'warn' : 'danger';
      percentText.textContent = `${pct.toFixed(1)}%`;

      const naNote = na > 0 ? ` · ${na} NA slot${na > 1 ? 's' : ''} excluded` : '';
      effectiveStats.textContent =
        `${present}/${effectiveTotal} valid classes${naNote} · Target ${targetPct}%`;
    }

    renderCalculators({ present, effectiveTotal, pct, target });
    renderWeeklyPlan();
  }

  /* ---------- Bunk Budget & Recovery Mode ---------- */
  function renderCalculators({ present, effectiveTotal, pct, target }) {
    bunkCard.classList.add('hidden');
    recoveryCard.classList.add('hidden');
    statusCard.classList.add('hidden');

    if (pct === null || effectiveTotal === 0) return; // guard: division by zero

    const targetPct = target * 100;

    if (pct >= targetPct) {
      // ABOVE (or at) target → how many can be skipped and still stay >= target?
      // Formula: floor((present - target*total) / target)
      const bunks = Math.floor((present - target * effectiveTotal) / target);
      if (bunks > 0) {
        bunkCount.textContent = bunks;
        bunkCard.classList.remove('hidden');
      } else {
        statusTitle.textContent = '⚠️ No Margin';
        statusDesc.textContent =
          `You are exactly at ${targetPct}%. Skipping even one class will drop you below target.`;
        statusCard.classList.remove('hidden');
      }
    } else {
      // BELOW target → consecutive attends needed to reach target
      // Formula: ceil((target*total - present) / (1 - target))
      const need = Math.ceil((target * effectiveTotal - present) / (1 - target));
      recoveryCount.textContent = need;
      recoveryDesc.innerHTML =
        `Attend the next <strong>${need}</strong> class${need !== 1 ? 'es' : ''} in a row ` +
        `to reach <strong>${targetPct}%</strong>.`;
      recoveryCard.classList.remove('hidden');
    }
  }

  /* ---------- Subject-wise tracker ---------- */
  function subjectColorClass(pct) {
    if (pct >= 80) return 'green';
    if (pct >= 75) return 'yellow';
    return 'red';
  }

  function renderSubjects() {
    subjectList.innerHTML = '';
    emptyNote.style.display = state.subjects.length ? 'none' : 'block';

    state.subjects.forEach((s) => {
      const total = Math.max(0, s.total);
      const present = Math.min(s.present, total); // safety: present can't exceed total
      const pct = total > 0 ? (present / total) * 100 : 0;
      const color = subjectColorClass(pct);
      const atRisk = pct < 75;

      const item = document.createElement('div');
      item.className = 'subject-item';
      item.innerHTML = `
        <div class="subject-head">
          <span class="subject-name"></span>
          <span class="subject-right">
            <span class="badge ${atRisk ? 'badge-risk' : 'badge-ok'}">${atRisk ? '⚠ Risk' : 'Safe'}</span>
            <span class="subject-pct pct-${color}">${total > 0 ? pct.toFixed(1) + '%' : '—'}</span>
            <button class="delete-btn" title="Remove subject" aria-label="Remove ${escapeHtml(s.name)}">✕</button>
          </span>
        </div>
        <div class="bar-track">
          <div class="bar-fill fill-${color}" style="width:${clampPct(pct)}%"></div>
        </div>
        <p class="subject-meta">${present}/${total} attended${total === 0 ? ' · no classes conducted yet' : ''}</p>
      `;
      item.querySelector('.subject-name').textContent = s.name;
      item.querySelector('.delete-btn').addEventListener('click', () => removeSubject(s.id));
      subjectList.appendChild(item);
    });
    renderTimetableSubjectOptions();
    renderDaySchedule();
  }

  function renderTimetableSubjectOptions() {
    const selectedName = timetableSubject.value;
    timetableSubject.replaceChildren();
    if (!state.subjects.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Add a subject above first';
      timetableSubject.appendChild(option);
      timetableSubject.disabled = true;
      addTimetableBtn.disabled = true;
      return;
    }

    state.subjects.forEach((subject) => {
      const option = document.createElement('option');
      option.value = subject.name;
      option.textContent = subject.name;
      timetableSubject.appendChild(option);
    });
    timetableSubject.disabled = false;
    addTimetableBtn.disabled = false;
    if (state.subjects.some((subject) => subject.name === selectedName)) {
      timetableSubject.value = selectedName;
    }
  }

  function renderDaySchedule() {
    const day = daySelect.value;
    const classes = state.timetable[day] || [];
    dayBunkResult.hidden = true;
    scheduleTitle.textContent = `${day} timetable`;
    scheduleCount.textContent = `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`;
    emptyDaySchedule.style.display = classes.length ? 'none' : 'block';
    dayScheduleList.replaceChildren();

    classes.forEach((subjectName, index) => {
      const chip = document.createElement('span');
      chip.className = 'schedule-class';
      const name = document.createElement('span');
      name.textContent = subjectName;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'schedule-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${subjectName} from ${day}`);
      remove.addEventListener('click', () => {
        state.timetable[day].splice(index, 1);
        saveState();
        renderDaySchedule();
        dayBunkResult.hidden = true;
      });
      chip.append(name, remove);
      dayScheduleList.appendChild(chip);
    });
    renderWeeklyPlan();
  }

  function simulateDayBunk(day) {
    const classes = state.timetable[day] || [];
    if (!classes.length) {
      return { safe: false, empty: true, dangerZone: [], unmatched: [] };
    }

    const bunkCounts = new Map();
    classes.forEach((name) => {
      const key = name.trim().toLocaleLowerCase();
      bunkCounts.set(key, (bunkCounts.get(key) || 0) + 1);
    });

    const dangerZone = [];
    const matched = new Set();
    state.subjects.forEach((subject) => {
      const key = subject.name.trim().toLocaleLowerCase();
      const occurrences = bunkCounts.get(key) || 0;
      if (!occurrences) return;
      matched.add(key);

      // Each scheduled occurrence removes one currently-counted attended class,
      // clamped at zero so the projection cannot produce negative attendance.
      const projectedPresent = Math.max(0, toInt(subject.present) - occurrences);
      const total = toInt(subject.total);
      const projectedPct = total > 0 ? (projectedPresent / total) * 100 : null;
      if (projectedPct === null || projectedPct < state.target * 100) {
        dangerZone.push({
          name: subject.name,
          occurrences,
          projectedPresent,
          total,
          percentage: projectedPct
        });
      }
    });

    const unmatched = [...bunkCounts.keys()].filter((key) => !matched.has(key));
    return { safe: dangerZone.length === 0 && unmatched.length === 0, empty: false, dangerZone, unmatched };
  }

  function renderDayBunkResult(day) {
    const result = simulateDayBunk(day);
    dayBunkResult.replaceChildren();
    dayBunkResult.hidden = false;
    dayBunkResult.className = `day-bunk-result ${result.safe ? 'safe' : 'danger'}`;

    const heading = document.createElement('strong');
    if (result.empty) {
      heading.textContent = `Add classes to the ${day} timetable before checking it.`;
      dayBunkResult.appendChild(heading);
      return result;
    }

    heading.textContent = result.safe
      ? `Bunking ${day} looks safe at your ${state.target * 100}% target.`
      : result.dangerZone.length
        ? `Bunking ${day} may put subjects below your ${state.target * 100}% target.`
        : `Cannot fully check ${day}; some timetable subjects have no attendance record.`;
    dayBunkResult.appendChild(heading);

    if (result.dangerZone.length) {
      const label = document.createElement('p');
      label.textContent = 'Danger Zone:';
      dayBunkResult.appendChild(label);
      const list = document.createElement('ul');
      result.dangerZone.forEach((subject) => {
        const item = document.createElement('li');
        const pct = subject.percentage === null ? 'no attendance data' : `${subject.percentage.toFixed(1)}%`;
        item.textContent = `${subject.name}: ${pct} after ${subject.occurrences} class${subject.occurrences === 1 ? '' : 'es'}`;
        list.appendChild(item);
      });
      dayBunkResult.appendChild(list);
    }

    if (result.unmatched.length) {
      const note = document.createElement('p');
      note.textContent = `No attendance record found for: ${result.unmatched.join(', ')}.`;
      dayBunkResult.appendChild(note);
    }
    return result;
  }

  function subjectKey(name) {
    return String(name).toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function classesNeededToReachTarget(subject) {
    const present = Math.min(toInt(subject.present), toInt(subject.total));
    const total = toInt(subject.total);
    if (!total || present / total >= state.target) return 0;
    return Math.ceil((state.target * total - present) / (1 - state.target));
  }

  function renderWeeklyPlan() {
    if (!weeklyPlanResult) return;
    weeklyPlanResult.replaceChildren();

    const classDays = WEEKDAYS.filter((day) => state.timetable[day]?.length);
    if (!classDays.length) {
      weeklyPlanResult.textContent = 'Add classes manually or import a timetable PDF to get a week plan.';
      return;
    }

    const scheduleCounts = new Map();
    for (const day of WEEKDAYS) {
      for (const name of state.timetable[day] || []) {
        const key = subjectKey(name);
        scheduleCounts.set(key, (scheduleCounts.get(key) || 0) + 1);
      }
    }

    const tracked = state.subjects
      .filter((subject) => toInt(subject.total) > 0 && scheduleCounts.has(subjectKey(subject.name)))
      .map((subject) => ({
        ...subject,
        present: Math.min(toInt(subject.present), toInt(subject.total)),
        total: toInt(subject.total),
        weekClasses: scheduleCounts.get(subjectKey(subject.name)) || 0,
        neededNow: classesNeededToReachTarget(subject),
        perDay: Object.fromEntries(WEEKDAYS.map((day) => [
          day,
          (state.timetable[day] || []).filter((name) => subjectKey(name) === subjectKey(subject.name)).length
        ]))
      }));

    const needsManualAttendance = [...scheduleCounts.keys()]
      .filter((key) => !state.subjects.some((subject) =>
        subjectKey(subject.name) === key && toInt(subject.total) > 0
      ));
    const needsManualSchedule = state.subjects.filter((subject) =>
      toInt(subject.total) > 0
      && !scheduleCounts.has(subjectKey(subject.name))
    );

    const title = document.createElement('p');
    title.className = 'weekly-plan-summary';
    weeklyPlanResult.appendChild(title);

    if (!tracked.length) {
      title.textContent = 'Add attendance counts for the timetable subjects to calculate attend or bunk days.';
    } else {
      const dayPlans = [];
      const possibilities = 1 << classDays.length;
      for (let mask = 0; mask < possibilities; mask += 1) {
        const attendedDays = classDays.filter((_, index) => mask & (1 << index));
        const needsAfterWeek = tracked.map((subject) => {
          const attendedClasses = attendedDays.reduce((count, day) => count + subject.perDay[day], 0);
          const projectedPresent = subject.present + attendedClasses;
          const projectedTotal = subject.total + subject.weekClasses;
          const gap = state.target * projectedTotal - projectedPresent;
          return gap <= 0 ? 0 : Math.ceil(gap / (1 - state.target));
        });
        const priorityCoverage = tracked.reduce((sum, subject) => {
          if (!subject.neededNow) return sum;
          return sum + attendedDays.reduce((count, day) => count + subject.perDay[day], 0);
        }, 0);
        dayPlans.push({
          attendedDays,
          remainingClassesNeeded: needsAfterWeek.reduce((sum, count) => sum + count, 0),
          safe: needsAfterWeek.every((count) => count === 0),
          priorityCoverage
        });
      }

      // A plan is only safe when every scheduled subject has attendance data and
      // every attendance subject is represented in the timetable.
      const planComplete = !needsManualAttendance.length && !needsManualSchedule.length;
      const safePlans = planComplete ? dayPlans.filter((plan) => plan.safe) : [];
      const comparePlan = (left, right) =>
        left.attendedDays.length - right.attendedDays.length
        || right.priorityCoverage - left.priorityCoverage;
      const chosen = safePlans.length
        ? safePlans.sort(comparePlan)[0]
        : dayPlans.sort((left, right) =>
          left.remainingClassesNeeded - right.remainingClassesNeeded || comparePlan(left, right)
        )[0];
      const bunkDays = classDays.filter((day) => !chosen.attendedDays.includes(day));
      const attendedLabel = chosen.attendedDays.length ? chosen.attendedDays.join(', ') : 'no scheduled days';

      title.textContent = safePlans.length
        ? `Recommended this week: attend ${attendedLabel}.`
        : planComplete
          ? `Your current shortfall needs more than one timetable week. Prioritize ${attendedLabel}; keep attending after this week.`
          : `Provisional for subjects with complete data: prioritize ${attendedLabel}. Complete the records below before relying on a whole-day bunk plan.`;

      if (safePlans.length) {
        const bunkNote = document.createElement('p');
        bunkNote.textContent = bunkDays.length
          ? `With this plan, you can individually bunk ${bunkDays.join(', ')} this week while keeping tracked subjects at ${state.target * 100}%.`
          : 'This week, the plan needs every scheduled day to stay on target.';
        weeklyPlanResult.appendChild(bunkNote);
      } else if (planComplete) {
        const remainingNote = document.createElement('p');
        remainingNote.textContent = `After this week, the tracked subjects still need about ${chosen.remainingClassesNeeded} attended class${chosen.remainingClassesNeeded === 1 ? '' : 'es'} to reach the ${state.target * 100}% target.`;
        weeklyPlanResult.appendChild(remainingNote);
      } else {
        const incompleteNote = document.createElement('p');
        incompleteNote.textContent = 'No whole-day bunk recommendation is available until each scheduled subject has attendance data and each attendance subject is on the timetable.';
        weeklyPlanResult.appendChild(incompleteNote);
      }
    }

    const recoverySubjects = state.subjects.filter((subject) => classesNeededToReachTarget(subject) > 0);
    if (recoverySubjects.length) {
      const recoveryHeading = document.createElement('h4');
      recoveryHeading.textContent = 'Recovery needed by subject';
      weeklyPlanResult.appendChild(recoveryHeading);
      const list = document.createElement('ul');
      recoverySubjects.forEach((subject) => {
        const needed = classesNeededToReachTarget(subject);
        const perDay = WEEKDAYS.map((day) => ({
          day,
          count: (state.timetable[day] || []).filter((name) => subjectKey(name) === subjectKey(subject.name)).length
        })).filter((entry) => entry.count > 0);
        const bestPerDay = Math.max(0, ...perDay.map((entry) => entry.count));
        const estimatedDays = bestPerDay ? Math.ceil(needed / bestPerDay) : null;
        const bestDays = perDay.filter((entry) => entry.count === bestPerDay).map((entry) => entry.day);
        const item = document.createElement('li');
        item.textContent = estimatedDays
          ? `${subject.name}: attend ${needed} classes (about ${estimatedDays} scheduled day${estimatedDays === 1 ? '' : 's'} on ${bestDays.join(' or ')}, which has ${bestPerDay} per week).`
          : `${subject.name}: attend ${needed} classes; add this subject to your timetable for a day estimate.`;
        list.appendChild(item);
      });
      weeklyPlanResult.appendChild(list);
    }

    if (needsManualAttendance.length) {
      const note = document.createElement('p');
      const names = WEEKDAYS.flatMap((day) => state.timetable[day] || [])
        .filter((name) => needsManualAttendance.includes(subjectKey(name)));
      note.textContent = `Add attendance counts for timetable subjects with no attendance record: ${[...new Set(names)].join(', ')}.`;
      weeklyPlanResult.appendChild(note);
    }
    if (needsManualSchedule.length) {
      const note = document.createElement('p');
      note.textContent = `Add these below-target subjects to the timetable to estimate days: ${needsManualSchedule.map((subject) => subject.name).join(', ')}.`;
      weeklyPlanResult.appendChild(note);
    }
  }

  window.BunkBudgetDayBunking = {
    simulateDayBunk,
    get timetable() { return state.timetable; }
  };

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function addSubject(name, present, total) {
    state.subjects.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name,
      present,
      total
    });
    saveState();
    renderSubjects();
    persistAuthenticatedSubjects().catch((error) => console.error('Could not sync attendance:', error));
  }

  function removeSubject(id) {
    state.subjects = state.subjects.filter((s) => s.id !== id);
    saveState();
    renderSubjects();
    persistAuthenticatedSubjects().catch((error) => console.error('Could not sync attendance:', error));
  }

  /* ---------- Optional authenticated cloud sync ---------- */
  function getTokenSubject(token) {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const paddedPayload = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
      const claims = JSON.parse(atob(paddedPayload));
      if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('Token has no subject claim.');
      return claims.sub;
    } catch {
      throw new Error('Expected a JWT access token with a subject claim.');
    }
  }

  function getSyncedUsers() {
    try {
      const value = JSON.parse(localStorage.getItem(CLOUD_SYNC_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function markUserSynced(userId) {
    const syncedUsers = new Set(getSyncedUsers());
    syncedUsers.add(userId);
    localStorage.setItem(CLOUD_SYNC_KEY, JSON.stringify([...syncedUsers]));
  }

  function serializeSubjects(subjects = state.subjects, target = state.target) {
    return subjects.map((subject) => ({
      client_subject_id: String(subject.id),
      subject_name: String(subject.name).trim(),
      classes_attended: toInt(subject.present),
      total_classes: toInt(subject.total),
      target_percentage: Number((target * 100).toFixed(2))
    }));
  }

  async function cloudRequest(path, token, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Attendance API returned ${response.status}${message ? `: ${message}` : ''}`);
    }
    return response.status === 204 ? null : response.json();
  }

  async function migrateLocalDataToCloud(token) {
    const userId = getTokenSubject(token);
    const syncedUsers = getSyncedUsers();
    if (syncedUsers.includes(userId)) return false;

    // A browser copy already loaded from another account must never be migrated
    // into this account when users switch profiles on the same device.
    const localOwner = localStorage.getItem(LOCAL_OWNER_KEY);
    if (localOwner && localOwner !== userId) return false;

    let localState = state;
    try {
      const storedState = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (storedState && typeof storedState === 'object') localState = storedState;
    } catch {
      // Keep the already hydrated in-memory state if storage is malformed.
    }
    const localSubjects = Array.isArray(localState.subjects) ? localState.subjects : [];

    const subjects = serializeSubjects(localSubjects, localState.target || 0.75);

    // Do not mark the account migrated until the API confirms a successful write.
    await cloudRequest('/api/sync', token, {
      method: 'POST',
      body: JSON.stringify({ subjects, replace_all: false })
    });
    markUserSynced(userId);
    return true;
  }

  async function fetchCloudAttendance(token) {
    return cloudRequest('/api/attendance', token);
  }

  function persistAuthenticatedSubjects() {
    if (!activeCloudToken) return Promise.resolve();
    const token = activeCloudToken;
    const payload = { subjects: serializeSubjects(), replace_all: true };
    cloudWriteQueue = cloudWriteQueue
      .catch(() => {})
      .then(() => cloudRequest('/api/sync', token, {
        method: 'POST',
        body: JSON.stringify(payload)
      }));
    return cloudWriteQueue;
  }

  async function syncAfterLogin(token) {
    if (!token) throw new Error('A signed-in access token is required.');
    await migrateLocalDataToCloud(token);
    const cloudSubjects = await fetchCloudAttendance(token);
    activeCloudToken = token;
    state.subjects = cloudSubjects.map((subject) => ({
      id: subject.client_subject_id || String(subject.id),
      name: subject.subject_name,
      present: subject.classes_attended,
      total: subject.total_classes
    }));
    if (cloudSubjects[0] && Number.isFinite(cloudSubjects[0].target_percentage)) {
      state.target = cloudSubjects[0].target_percentage / 100;
      if (![0.75, 0.76].includes(state.target)) state.target = 0.75;
    }
    localStorage.setItem(LOCAL_OWNER_KEY, getTokenSubject(token));
    saveState();
    applyTargetButtons();
    renderDashboard();
    renderSubjects();
    return state.subjects;
  }

  // The existing app has no login provider. Call this from its auth callback:
  // window.BunkBudgetCloud.syncAfterLogin(accessToken)
  window.BunkBudgetCloud = { migrateLocalDataToCloud, fetchCloudAttendance, syncAfterLogin };

  /* ---------- PDF import review and apply ---------- */
  function showAttendanceImport(subjects, file) {
    pendingAttendanceImport = subjects.map((subject) => ({ ...subject }));
    attendanceImportRows.replaceChildren();
    pendingAttendanceImport.forEach((subject, index) => {
      const row = document.createElement('div');
      row.className = 'pdf-import-row attendance-import-row';
      row.dataset.index = String(index);

      const name = document.createElement('input');
      name.type = 'text';
      name.maxLength = 100;
      name.value = subject.name;
      name.setAttribute('aria-label', `Subject name from ${file.name}`);

      const present = document.createElement('input');
      present.type = 'number';
      present.min = '0';
      present.step = '1';
      present.value = String(subject.present);
      present.setAttribute('aria-label', `Classes attended for ${subject.name}`);

      const total = document.createElement('input');
      total.type = 'number';
      total.min = '1';
      total.step = '1';
      total.value = String(subject.total);
      total.setAttribute('aria-label', `Total classes for ${subject.name}`);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini-btn';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => row.remove());

      [name, present, total].forEach((input) => row.appendChild(input));
      row.appendChild(remove);
      attendanceImportRows.appendChild(row);
    });
    attendanceImportPreview.hidden = !pendingAttendanceImport.length;
  }

  function showTimetableImport(timetable) {
    pendingTimetableImport = WEEKDAYS.flatMap((day) =>
      (timetable[day] || []).map((subject) => ({ day, subject }))
    );
    timetableImportRows.replaceChildren();
    pendingTimetableImport.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'pdf-import-row timetable-import-row';
      row.dataset.index = String(index);

      const day = document.createElement('select');
      day.setAttribute('aria-label', `Day for class ${index + 1}`);
      WEEKDAYS.forEach((weekday) => {
        const option = document.createElement('option');
        option.value = weekday;
        option.textContent = weekday;
        option.selected = weekday === entry.day;
        day.appendChild(option);
      });

      const subject = document.createElement('input');
      subject.type = 'text';
      subject.maxLength = 100;
      subject.value = entry.subject;
      subject.setAttribute('aria-label', `Subject for ${entry.day} class ${index + 1}`);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini-btn';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => row.remove());

      row.append(day, subject, remove);
      timetableImportRows.appendChild(row);
    });
    timetableImportPreview.hidden = !pendingTimetableImport.length;
  }

  window.addEventListener('bunkbudget:attendance-pdf-ready', (event) => {
    const { file, subjects } = event.detail;
    if (!subjects.length) return;
    showAttendanceImport(subjects, file);
  });

  window.addEventListener('bunkbudget:timetable-pdf-ready', (event) => {
    const { file, timetable } = event.detail;
    if (!WEEKDAYS.some((day) => timetable[day]?.length)) return;
    showTimetableImport(timetable);
  });

  window.addEventListener('bunkbudget:pdf-selected', (event) => {
    saveReportFiles([event.detail.file]);
  });

  $('#applyAttendanceImport').addEventListener('click', () => {
    const rows = [...attendanceImportRows.querySelectorAll('.attendance-import-row')];
    const imported = [];
    for (const row of rows) {
      const [nameInput, presentInput, totalInput] = row.querySelectorAll('input');
      const name = nameInput.value.trim();
      const present = toInt(presentInput.value);
      const total = toInt(totalInput.value);
      if (!name || total < 1 || present > total) {
        $('#attendancePdfStatus').textContent = 'Check the imported subject names and counts. Attended classes must not exceed total classes.';
        (name && total >= 1 && present > total ? presentInput : nameInput).focus();
        return;
      }
      imported.push({ name, present, total });
    }
    if (!imported.length) {
      $('#attendancePdfStatus').textContent = 'Keep at least one valid subject row to apply attendance.';
      return;
    }

    let added = 0;
    let updated = 0;
    for (const item of imported) {
      const existing = state.subjects.find((subject) => subjectKey(subject.name) === subjectKey(item.name));
      if (existing) {
        if (updateMatchingSubjects.checked) {
          existing.present = item.present;
          existing.total = item.total;
          updated += 1;
        }
      } else {
        state.subjects.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          ...item
        });
        added += 1;
      }
    }
    saveState();
    renderDashboard();
    renderSubjects();
    persistAuthenticatedSubjects().catch((error) => console.error('Could not sync imported attendance:', error));
    attendanceImportPreview.hidden = true;
    $('#attendancePdfStatus').textContent = `Attendance updated: ${added} new subject${added === 1 ? '' : 's'} added and ${updated} matching subject${updated === 1 ? '' : 's'} refreshed. Other manual subjects were kept.`;
  });

  $('#applyTimetableImport').addEventListener('click', () => {
    const rows = [...timetableImportRows.querySelectorAll('.timetable-import-row')];
    const imported = Object.fromEntries(WEEKDAYS.map((day) => [day, []]));
    rows.forEach((row) => {
      const [daySelectInput, subjectInput] = row.querySelectorAll('select, input');
      const day = daySelectInput.value;
      const subject = subjectInput.value.trim();
      if (WEEKDAYS.includes(day) && subject) imported[day].push(subject);
    });
    if (!WEEKDAYS.some((day) => imported[day].length)) {
      $('#timetablePdfStatus').textContent = 'Keep at least one valid class row to apply the timetable.';
      return;
    }

    const nextTimetable = replaceTimetable.checked ? createEmptyTimetable() : normalizeTimetable(state.timetable);
    if (replaceTimetable.checked) {
      WEEKDAYS.forEach((day) => { nextTimetable[day] = imported[day].slice(); });
    } else {
      WEEKDAYS.forEach((day) => {
        const currentCounts = new Map();
        const importedCounts = new Map();
        (nextTimetable[day] || []).forEach((name) => {
          const key = subjectKey(name);
          currentCounts.set(key, (currentCounts.get(key) || 0) + 1);
        });
        imported[day].forEach((name) => {
          const key = subjectKey(name);
          importedCounts.set(key, (importedCounts.get(key) || 0) + 1);
        });
        for (const [key, count] of importedCounts) {
          const toAdd = Math.max(0, count - (currentCounts.get(key) || 0));
          const displayName = imported[day].find((name) => subjectKey(name) === key);
          for (let index = 0; index < toAdd; index += 1) nextTimetable[day].push(displayName);
        }
      });
    }

    state.timetable = nextTimetable;
    const importedNames = new Map();
    WEEKDAYS.forEach((day) => imported[day].forEach((name) => importedNames.set(subjectKey(name), name)));
    let placeholdersAdded = 0;
    for (const [key, name] of importedNames) {
      if (state.subjects.some((subject) => subjectKey(subject.name) === key)) continue;
      state.subjects.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name,
        present: 0,
        total: 0
      });
      placeholdersAdded += 1;
    }
    saveState();
    renderSubjects();
    persistAuthenticatedSubjects().catch((error) => console.error('Could not sync imported timetable subjects:', error));
    timetableImportPreview.hidden = true;
    $('#timetablePdfStatus').textContent = `Timetable applied. Your manual schedule was ${replaceTimetable.checked ? 'replaced as selected' : 'kept and merged'}; ${placeholdersAdded} subject${placeholdersAdded === 1 ? '' : 's'} need attendance counts.`;
  });

  /* ---------- Attendance report archive ---------- */
  function openReportDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(REPORT_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(REPORT_STORE)) {
          const store = db.createObjectStore(REPORT_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getReports() {
    const db = await openReportDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(REPORT_STORE, 'readonly').objectStore(REPORT_STORE).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  async function archiveReport(file) {
    const db = await openReportDb();
    const reports = await getReports();
    const version = reports.filter((report) => report.name === file.name).length + 1;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(REPORT_STORE, 'readwrite');
      tx.objectStore(REPORT_STORE).add({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        savedAt: new Date().toISOString(),
        version,
        file
      });
      tx.oncomplete = () => { db.close(); resolve(version); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function renderReports() {
    try {
      const reports = (await getReports()).sort((a, b) =>
        b.savedAt.localeCompare(a.savedAt) || b.id - a.id
      );
      reportList.replaceChildren();
      emptyReports.style.display = reports.length ? 'none' : 'block';
      reports.forEach((report) => {
        const row = document.createElement('div');
        row.className = 'report-item';
        const info = document.createElement('div');
        info.className = 'report-info';
        const name = document.createElement('strong');
        name.className = 'report-name';
        name.textContent = report.name;
        const meta = document.createElement('span');
        meta.className = 'report-meta';
        meta.textContent = `Version ${report.version} · ${new Date(report.savedAt).toLocaleString()} · ${formatBytes(report.size)}`;
        info.append(name, meta);
        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'mini-btn';
        download.textContent = 'Download';
        download.setAttribute('aria-label', `Download ${report.name}, version ${report.version}`);
        download.addEventListener('click', () => {
          const url = URL.createObjectURL(report.file);
          const link = document.createElement('a');
          link.href = url;
          link.download = report.name;
          link.click();
          URL.revokeObjectURL(url);
        });
        row.append(info, download);
        reportList.appendChild(row);
      });
    } catch (error) {
      console.error('Could not load report archive:', error);
      reportStatus.textContent = 'Report storage is unavailable in this browser.';
    }
  }

  async function saveReportFiles(files) {
    const accepted = Array.from(files).filter((file) =>
      /\.(pdf|csv|xls|xlsx|json)$/i.test(file.name)
    );
    if (!accepted.length) {
      reportStatus.textContent = 'Choose PDF, CSV, Excel, or JSON report files.';
      return;
    }
    let saved = 0;
    for (const file of accepted) {
      try {
        await archiveReport(file);
        saved += 1;
      } catch (error) {
        console.error('Could not save report:', error);
        reportStatus.textContent = 'Could not save the report. Check available browser storage and try again.';
        break;
      }
    }
    if (saved) reportStatus.textContent = `${saved} report${saved === 1 ? '' : 's'} saved. Previous versions are preserved.`;
    await renderReports();
  }

  reportInput.addEventListener('change', () => {
    saveReportFiles(reportInput.files);
    reportInput.value = '';
  });
  reportDropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      reportInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => reportDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    reportDropZone.classList.add('drag-active');
  }));
  ['dragleave', 'drop'].forEach((eventName) => reportDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    reportDropZone.classList.remove('drag-active');
  }));
  reportDropZone.addEventListener('drop', (event) => saveReportFiles(event.dataTransfer.files));

  daySelect.addEventListener('change', renderDaySchedule);
  addTimetableBtn.addEventListener('click', () => {
    const day = daySelect.value;
    const subjectName = timetableSubject.value;
    if (!subjectName || !WEEKDAYS.includes(day)) return;
    state.timetable[day].push(subjectName);
    saveState();
    renderDaySchedule();
  });
  simulateDayBtn.addEventListener('click', () => renderDayBunkResult(daySelect.value));

  /* ---------- Target toggle ---------- */
  function applyTargetButtons() {
    targetBtns.forEach((btn) => {
      btn.classList.toggle('active', parseFloat(btn.dataset.target) === state.target);
    });
  }

  /* ---------- Events ---------- */
  [presentInput, totalInput, naInput].forEach((input) => {
    input.addEventListener('input', () => {
      state.present = presentInput.value;
      state.total = totalInput.value;
      state.na = naInput.value;
      saveState();
      renderDashboard();
    });
  });

  targetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.target = parseFloat(btn.dataset.target);
      applyTargetButtons();
      saveState();
      renderDashboard();
      persistAuthenticatedSubjects().catch((error) => console.error('Could not sync attendance:', error));
    });
  });

  subjectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = subjName.value.trim();
    const present = toInt(subjPresent.value);
    const total = toInt(subjTotal.value);

    if (!name) return;
    if (present > total) {
      alert('Present classes cannot exceed total classes for a subject.');
      return;
    }

    addSubject(name, present, total);
    subjectForm.reset();
    subjName.focus();
  });

  resetBtn.addEventListener('click', () => {
    if (!confirm('Reset tracker data? This clears your overall stats and subjects. Saved attendance reports will remain in the archive.')) return;
    localStorage.removeItem(STORE_KEY);
    state = structuredClone(defaultState);
    presentInput.value = '';
    totalInput.value = '';
    naInput.value = '';
    subjectForm.reset();
    applyTargetButtons();
    renderDashboard();
    renderSubjects();
    persistAuthenticatedSubjects().catch((error) => console.error('Could not sync attendance:', error));
  });

  /* ---------- Init: hydrate UI from saved state ---------- */
  function init() {
    presentInput.value = state.present;
    totalInput.value = state.total;
    naInput.value = state.na;
    applyTargetButtons();
    renderDashboard();
    renderSubjects();
    renderReports();
  }

  init();

  // An auth integration may provide this callback before app.js loads. It lets
  // the tracker restore the authenticated user's cloud data on page load.
  if (typeof window.BUNKBUDGET_GET_ACCESS_TOKEN === 'function') {
    Promise.resolve(window.BUNKBUDGET_GET_ACCESS_TOKEN())
      .then((token) => token && syncAfterLogin(token))
      .catch((error) => console.error('Could not restore cloud attendance:', error));
  }
})();
