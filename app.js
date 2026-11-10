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
