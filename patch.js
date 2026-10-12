// patch.js — автоматическая правка index.html
import fs from 'fs/promises';
import path from 'path';

const file = path.join(process.cwd(), 'public', 'index.html');
let html = await fs.readFile(file, 'utf-8');

const NEW_CSS = `
.journal-layout {
  display: flex;
  position: relative;
  overflow: hidden;
  max-width: 100%;
  background: var(--glass-bg-light);
}

.journal-names {
  flex-shrink: 0;
  overflow: hidden;
  width: 240px;
  border-right: 1px solid var(--separator-opaque);
  z-index: 2;
  background: var(--glass-bg-light);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
}

.journal-dates {
  flex: 1;
  overflow: auto;
  max-width: 100%;
}

.journal {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
  user-select: none;
  width: 100%;
}

.journal th, .journal td {
  padding: 0;
  text-align: center;
  border-right: 1px solid var(--separator);
  border-bottom: 1px solid var(--separator);
  background: var(--glass-bg-light);
}

.journal th:last-child, .journal td:last-child { border-right: none; }
.journal tr:last-child td { border-bottom: none; }

.journal th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgba(120, 120, 128, 0.08);
}

.journal th.date-cell {
  padding: 8px 4px;
  min-width: 54px;
  font-weight: 600;
}

.journal th.date-cell .weekday {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 500;
}

.journal th.date-cell .day {
  font-size: 15px;
  color: var(--text);
  margin-top: 1px;
}

.journal th.date-cell.today .day {
  color: var(--accent);
  font-weight: 700;
}

.journal.names-table th.name-col,
.journal.names-table td.name-col {
  text-align: left;
  padding: 12px 16px;
  width: 240px;
  min-width: 240px;
  max-width: 240px;
  background: transparent;
  font-size: 14px;
  font-weight: 500;
}

.journal.names-table thead th.name-col {
  padding: 10px 16px;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.06em;
  background: rgba(120, 120, 128, 0.08);
  height: 56px;
  vertical-align: middle;
}

.journal tbody tr.self-row td.name-col {
  background: rgba(0, 122, 255, 0.12);
}

.journal td.name-col { cursor: pointer; }

.journal td.att-cell {
  width: 54px;
  min-width: 54px;
  height: 46px;
  cursor: pointer;
  background: var(--glass-bg-light);
}

.journal td.att-cell.readonly { cursor: default; }

.journal td.att-cell .status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  animation: popIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.journal.names-table tbody tr,
.journal.dates-table tbody tr {
  height: 46px;
}

.journal.names-table tbody td.name-col {
  height: 46px;
  box-sizing: border-box;
  vertical-align: middle;
}

.journal.dates-table tbody td.att-cell {
  height: 46px;
  box-sizing: border-box;
}
`;

const NEW_TEACHER_TABLE = `function buildTeacherJournalTable(data, groupCode, subject, overlay) {
  var namesThead = el('thead', {}, [
    el('tr', {}, [el('th', { class: 'name-col', text: 'Студент' })])
  ]);
  var namesTbody = el('tbody', {});

  var datesThead = el('thead', {}, [
    el('tr', {}, data.dates.map(function(d) {
      return el('th', { class: 'date-cell' }, [
        el('div', { class: 'weekday', text: d.slice(8, 10) + '.' + d.slice(5, 7) })
      ]);
    }))
  ]);
  var datesTbody = el('tbody', {});

  data.students.forEach(function(s) {
    var colorMap = { none: 'var(--text)', yellow: '#ffcc00', orange: 'var(--orange)', red: 'var(--red)' };
    var nameColor = colorMap[s.colorLevel] || 'var(--text)';

    var nameCell = el('td', { class: 'name-col' });
    if (s.individualPlan) {
      nameCell.appendChild(el('span', { style: 'color: var(--accent); font-weight:700; margin-right: 6px;', text: '★' }));
    }
    nameCell.appendChild(el('span', { style: 'color: ' + nameColor + '; font-weight: 600;', text: s.fullName }));
    if (s.nCount > 0) {
      nameCell.appendChild(el('span', {
        style: 'font-size: 11px; margin-left: 6px; padding: 1px 6px; border-radius: 100px; background: ' + nameColor + '20; color: ' + nameColor + '; font-weight: 700;',
        text: s.nCount + 'Н'
      }));
    }
    namesTbody.appendChild(el('tr', {}, [nameCell]));

    var attTr = el('tr', {});
    data.dates.forEach(function(d) {
      var mark = (data.marks[s.id] || {})[d] || '';
      var td = el('td', { class: 'att-cell' });
      if (mark) {
        var cls = mark === 'Н' ? 'absent' : (mark === 'С' ? 'drone' : 'grade-' + mark);
        td.appendChild(el('span', { class: 'status-badge ' + cls, text: mark }));
      }
      td.addEventListener('click', function() {
        openMarkPicker(s.id, d, mark, groupCode, subject, overlay);
      });
      attTr.appendChild(td);
    });
    datesTbody.appendChild(attTr);
  });

  var namesTable = el('table', { class: 'journal names-table' }, [namesThead, namesTbody]);
  var datesTable = el('table', { class: 'journal dates-table' }, [datesThead, datesTbody]);

  var namesWrap = el('div', { class: 'journal-names' }, [namesTable]);
  var datesWrap = el('div', { class: 'journal-dates' }, [datesTable]);

  var layout = el('div', { class: 'journal-layout' }, [namesWrap, datesWrap]);

  setTimeout(function() {
    var syncing = false;
    function syncScroll(from, to) {
      return function() {
        if (syncing) return;
        syncing = true;
        to.scrollTop = from.scrollTop;
        syncing = false;
      };
    }
    namesWrap.addEventListener('scroll', syncScroll(namesWrap, datesWrap));
    datesWrap.addEventListener('scroll', syncScroll(datesWrap, namesWrap));
  }, 0);

  return layout;
}`;

const NEW_JOURNAL_TABLE = `function buildJournalTable(students, dates) {
  var weekdays = weekdaysShort();
  var today = new Date();

  var namesThead = el('thead', {}, [el('tr', {}, [el('th', { class: 'name-col', text: 'Студент' })])]);
  var namesTbody = el('tbody', {});
  students.forEach(function(s) {
    var tr = el('tr', {});
    var nameCell = el('td', { class: 'name-col', text: s.fullName });
    if (s.userId) nameCell.addEventListener('click', function() { openUserProfile(s.userId); });
    tr.appendChild(nameCell);
    namesTbody.appendChild(tr);
  });

  var datesThead = el('thead', {}, [
    el('tr', {}, dates.map(function(d) {
      var isToday = isSameDay(d, today);
      return el('th', { class: 'date-cell' + (isToday ? ' today' : '') }, [
        el('div', { class: 'weekday', text: weekdays[d.getDay()] }),
        el('div', { class: 'day', text: String(d.getDate()) })
      ]);
    }))
  ]);
  var datesTbody = el('tbody', {});
  students.forEach(function(s) {
    var tr = el('tr', {});
    dates.forEach(function(d) {
      var iso = fmtISO(d);
      var status = s.attendance && s.attendance[iso];
      var td = el('td', { class: 'att-cell' });
      if (status) {
        var labels = { absent: 'Н', excused: 'У', drone: 'С' };
        td.appendChild(el('span', { class: 'status-badge ' + status, text: labels[status] || '?' }));
      }
      td.addEventListener('click', function() { openAttendancePopover(s.id, iso, status); });
      tr.appendChild(td);
    });
    datesTbody.appendChild(tr);
  });

  var namesTable = el('table', { class: 'journal names-table' }, [namesThead, namesTbody]);
  var datesTable = el('table', { class: 'journal dates-table' }, [datesThead, datesTbody]);

  var namesWrap = el('div', { class: 'journal-names' }, [namesTable]);
  var datesWrap = el('div', { class: 'journal-dates' }, [datesTable]);

  var layout = el('div', { class: 'journal-layout' }, [namesWrap, datesWrap]);

  setTimeout(function() {
    var syncing = false;
    function syncScroll(from, to) {
      return function() {
        if (syncing) return;
        syncing = true;
        to.scrollTop = from.scrollTop;
        syncing = false;
      };
    }
    namesWrap.addEventListener('scroll', syncScroll(namesWrap, datesWrap));
    datesWrap.addEventListener('scroll', syncScroll(datesWrap, namesWrap));
  }, 0);

  return layout;
}`;

// --- Замена CSS ---
// Ищем блок от ".journal-wrapper" до конца правил .journal*
const cssStart = html.indexOf('.journal-wrapper {');
const cssEnd = html.indexOf('.popover-overlay {');
if (cssStart === -1 || cssEnd === -1) {
  console.error('❌ Не нашёл блок CSS .journal*');
  process.exit(1);
}
html = html.slice(0, cssStart) + NEW_CSS + '\n  ' + html.slice(cssEnd);

// --- Замена buildTeacherJournalTable ---
function replaceFunction(src, name, newBody) {
  const startMarker = 'function ' + name + '(';
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) return null;
  // Ищем закрывающую скобку функции по балансу {}
  let i = src.indexOf('{', startIdx);
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(0, startIdx) + newBody + src.slice(i);
}

let newHtml = replaceFunction(html, 'buildTeacherJournalTable', NEW_TEACHER_TABLE);
if (!newHtml) { console.error('❌ Не нашёл buildTeacherJournalTable'); process.exit(1); }
html = newHtml;

newHtml = replaceFunction(html, 'buildJournalTable', NEW_JOURNAL_TABLE);
if (!newHtml) { console.error('❌ Не нашёл buildJournalTable'); process.exit(1); }
html = newHtml;

// --- Убираем journal-wrapper в openTeacherJournal ---
html = html.replace(
  /var wrapper = el\('div', \{ class: 'journal-wrapper' \}\);\s*var table = buildTeacherJournalTable\(data, groupCode, subject, overlay\);\s*wrapper\.appendChild\(table\);\s*pop\.appendChild\(wrapper\);/,
  "pop.appendChild(buildTeacherJournalTable(data, groupCode, subject, overlay));"
);

// --- Убираем journal-wrapper в renderWorking ---
html = html.replace(
  /var wrapper = el\('div', \{ class: 'journal-wrapper' \}\);\s*wrapper\.appendChild\(buildJournalTable\(list\.students, dates\)\);\s*group\.appendChild\(wrapper\);/,
  "group.appendChild(buildJournalTable(list.students, dates));"
);

await fs.writeFile(file, html, 'utf-8');
console.log('✅ index.html пропатчен!');
console.log('   Теперь: Ctrl+Shift+R в браузере.');