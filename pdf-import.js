const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const pdfModulePath = localHost
  ? './node_modules/pdfjs-dist/build/pdf.mjs'
  : './vendor/pdfjs/pdf.mjs';
const pdfWorkerPath = localHost
  ? './node_modules/pdfjs-dist/build/pdf.worker.mjs'
  : './vendor/pdfjs/pdf.worker.mjs';
const pdfAssetRoot = localHost ? './node_modules/pdfjs-dist/' : './vendor/pdfjs/';

const pdfjsLib = await import(pdfModulePath);
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerPath;

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKDAY_ALIASES = new Map([
  ['mon', 'Monday'], ['monday', 'Monday'],
  ['tue', 'Tuesday'], ['tues', 'Tuesday'], ['tuesday', 'Tuesday'],
  ['wed', 'Wednesday'], ['wednesday', 'Wednesday'],
  ['thu', 'Thursday'], ['thur', 'Thursday'], ['thurs', 'Thursday'], ['thursday', 'Thursday'],
  ['fri', 'Friday'], ['friday', 'Friday']
]);

function dayFromText(value) {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  return WEEKDAY_ALIASES.get(normalized) || null;
}

function layoutLines(items) {
  const lines = [];
  const ordered = items
    .filter((item) => typeof item.str === 'string' && item.str.trim())
    .map((item) => ({
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
      text: item.str.trim()
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  for (const item of ordered) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.6);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines
    .map((line) => {
      line.items.sort((a, b) => a.x - b.x);
      line.text = line.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
      return line;
    })
    .sort((a, b) => b.y - a.y);
}

async function readPdf(file) {
  if (file.size > 35 * 1024 * 1024) {
    throw new Error('This PDF is over 35 MB. Save a smaller copy and try again.');
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    cMapUrl: `${pdfAssetRoot}cmaps/`,
    cMapPacked: true,
    iccUrl: `${pdfAssetRoot}iccs/`,
    standardFontDataUrl: `${pdfAssetRoot}standard_fonts/`,
    wasmUrl: `${pdfAssetRoot}wasm/`
  }).promise;
  if (pdf.numPages > 100) {
    await pdf.destroy();
    throw new Error('This PDF has more than 100 pages. Upload the page range with your report or timetable.');
  }

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(layoutLines(content.items));
  }
  await pdf.destroy();
  return pages;
}

function tidySubjectName(value) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;|,._-]+|[\s:;|,._-]+$/g, '')
    .replace(/^(?:subject|subject name|course name|course title)\s+/i, '')
    .trim();
}

function attendanceFromLine(line) {
  const percentageMatch = line.text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percentageMatch) {
    const percentage = Number(percentageMatch[1]);
    const percentItem = line.items.find((item) => item.text.includes('%')) || line.items.at(-1);
    const cells = line.items
      .filter((item) => item.x < percentItem.x && item.x >= percentItem.x - 270)
      .map((item) => ({ ...item, value: /^\d+(?:\.\d+)?$/.test(item.text) ? Number(item.text) : null }))
      .filter((item) => item.value !== null && Number.isFinite(item.value));

    let best = null;
    for (let left = 0; left < cells.length; left += 1) {
      for (let right = left + 1; right < cells.length; right += 1) {
        const first = cells[left];
        const second = cells[right];
        for (const [totalCell, presentCell] of [[first, second], [second, first]]) {
          if (totalCell.value <= 0 || presentCell.value < 0 || presentCell.value > totalCell.value) continue;
          const difference = Math.abs((presentCell.value / totalCell.value) * 100 - percentage);
          const score = difference + (right - left > 1 ? 0.15 : 0);
          if (difference <= 1.25 && (!best || score < best.score)) {
            best = { totalCell, presentCell, score };
          }
        }
      }
    }

    if (best) {
      const name = tidySubjectName(line.items
        .filter((item) => item.x < best.totalCell.x && !/^\d+(?:\.\d+)?$/.test(item.text))
        .map((item) => item.text)
        .join(' '));
      if (name && !/^(?:grand total|overall|total|average|attendance|percentage)$/i.test(name)) {
        return { name, present: Math.round(best.presentCell.value), total: Math.round(best.totalCell.value) };
      }
    }
  }

  const ratioMatch = line.text.match(/^(.+?)\s+(\d+)\s*\/\s*(\d+)\b/);
  if (ratioMatch) {
    const name = tidySubjectName(ratioMatch[1]);
    const present = Number(ratioMatch[2]);
    const total = Number(ratioMatch[3]);
    if (name && total > 0 && present <= total) return { name, present, total };
  }
  return null;
}

function parseAttendance(pages) {
  const byName = new Map();
  for (const lines of pages) {
    for (const line of lines) {
      const subject = attendanceFromLine(line);
      if (!subject) continue;
      const key = subject.name.toLocaleLowerCase();
      const existing = byName.get(key);
      if (!existing || subject.total > existing.total) byName.set(key, subject);
    }
  }
  return [...byName.values()];
}

function cleanTimetableCell(value) {
  return tidySubjectName(value
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\s*(?:-|–|to)\s*\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b/gi, ' ')
    .replace(/^[0-9]+[.)]\s*/, ' '));
}

function isTimetableNoise(value) {
  return !value
    || /^\d+(?:\.\d+)?$/.test(value)
    || /^(?:time|subject|subject name|course|course name|faculty|teacher|room|room no\.?|class|day|period|break|lunch|recess|total|signature)$/i.test(value)
    || /^(?:[|:/_.-]+)$/.test(value);
}

function parseTimetable(pages) {
  const timetable = Object.fromEntries(WEEKDAYS.map((day) => [day, []]));

  for (const lines of pages) {
    let dayColumns = null;
    for (const line of lines) {
      const headerDays = line.items
        .map((item) => ({ day: dayFromText(item.text), x: item.x }))
        .filter((entry) => entry.day);
      const uniqueHeaderDays = new Set(headerDays.map((entry) => entry.day));
      if (uniqueHeaderDays.size >= 2) {
        dayColumns = headerDays.filter((entry, index, all) => all.findIndex((item) => item.day === entry.day) === index);
        continue;
      }

      if (dayColumns) {
        const firstDayX = Math.min(...dayColumns.map((entry) => entry.x));
        for (const item of line.items) {
          if (item.x < firstDayX - 12 || dayFromText(item.text)) continue;
          const subject = cleanTimetableCell(item.text);
          if (isTimetableNoise(subject)) continue;
          const column = dayColumns.reduce((nearest, entry) =>
            Math.abs(entry.x - item.x) < Math.abs(nearest.x - item.x) ? entry : nearest
          );
          timetable[column.day].push(subject);
        }
        continue;
      }

      const dayItem = line.items.find((item) => dayFromText(item.text));
      const inlineDay = line.text.match(/^\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Mon\.?|Tue\.?|Wed\.?|Thu\.?|Fri\.?)\s*[:\-–]\s*(.+)$/i);
      if (inlineDay) {
        const day = dayFromText(inlineDay[1]);
        const subjects = inlineDay[2].split(/\s*[|;,]\s*/).map(cleanTimetableCell).filter((item) => !isTimetableNoise(item));
        if (day) timetable[day].push(...subjects);
      } else if (dayItem) {
        const day = dayFromText(dayItem.text);
        const remaining = line.items.filter((item) => item.x > dayItem.x && !dayFromText(item.text));
        const subjects = remaining.map((item) => cleanTimetableCell(item.text)).filter((item) => !isTimetableNoise(item));
        if (day) timetable[day].push(...subjects);
      }
    }
  }

  return timetable;
}

function countTimetableClasses(timetable) {
  return WEEKDAYS.reduce((count, day) => count + timetable[day].length, 0);
}

async function handlePdf(inputId, statusId, type) {
  const input = document.getElementById(inputId);
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const status = document.getElementById(statusId);
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    status.textContent = 'Choose a PDF file.';
    return;
  }

  status.textContent = 'Reading PDF on this device…';
  window.dispatchEvent(new CustomEvent('bunkbudget:pdf-selected', { detail: { file } }));
  try {
    const pages = await readPdf(file);
    if (type === 'attendance') {
      const subjects = parseAttendance(pages);
      window.dispatchEvent(new CustomEvent('bunkbudget:attendance-pdf-ready', {
        detail: { file, pageCount: pages.length, subjects }
      }));
      status.textContent = subjects.length
        ? `Found ${subjects.length} subject rows across ${pages.length} pages. Review them before applying.`
        : `Read ${pages.length} pages, but couldn't identify subject attendance rows. Check whether the PDF has selectable text or enter values manually.`;
    } else {
      const timetable = parseTimetable(pages);
      const classCount = countTimetableClasses(timetable);
      window.dispatchEvent(new CustomEvent('bunkbudget:timetable-pdf-ready', {
        detail: { file, pageCount: pages.length, timetable }
      }));
      status.textContent = classCount
        ? `Found ${classCount} class slots across ${pages.length} pages. Review the day and subject for each class.`
        : `Read ${pages.length} pages, but couldn't identify weekday timetable columns. Check whether the PDF has selectable text or keep using manual scheduling.`;
    }
  } catch (error) {
    console.error('PDF import failed:', error);
    status.textContent = error instanceof Error ? error.message : 'Could not read this PDF. Try another copy or enter the information manually.';
  }
}

function attachImport(inputId, dropZoneId, statusId, type) {
  const input = document.getElementById(inputId);
  const zone = document.getElementById(dropZoneId);
  input.addEventListener('change', () => handlePdf(inputId, statusId, type));
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  ['dragenter', 'dragover'].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault();
    zone.classList.add('drag-active');
  }));
  ['dragleave', 'drop'].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault();
    zone.classList.remove('drag-active');
  }));
  zone.addEventListener('drop', (event) => {
    const file = Array.from(event.dataTransfer.files || []).find((item) =>
      item.type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')
    );
    if (!file) {
      document.getElementById(statusId).textContent = 'Drop a PDF file here.';
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    handlePdf(inputId, statusId, type);
  });
}

attachImport('attendancePdfInput', 'attendancePdfDrop', 'attendancePdfStatus', 'attendance');
attachImport('timetablePdfInput', 'timetablePdfDrop', 'timetablePdfStatus', 'timetable');
