import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

function getCurrentSemester() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  // Семестр 1: сентябрь–январь, Семестр 2: февраль–июнь
  // Июль-август — каникулы, считаем как следующий семестр
  const sem = (month >= 9 || month === 1) ? 1 : 2;
  const startYear = month >= 9 ? year : year - 1;
  return startYear + '-' + sem;
}

function getColorLevel(nCount) {
  if (nCount >= 5) return 'red';      // критично
  if (nCount >= 3) return 'orange';   // плохо
  if (nCount >= 1) return 'yellow';   // внимание
  return 'none';                       // всё ок
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Отключаем кэширование API
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

async function readJSON(file) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}
async function writeJSON(file, data) {
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf-8');
}
async function ensureFile(file, initial) {
  const exists = await readJSON(file);
  if (exists === null) await writeJSON(file, initial);
}

await ensureFile('announcements.json', { announcements: [] });
await ensureFile('materials.json', { materials: [] });
await ensureFile('profile-notes.json', { notes: [] });
await ensureFile('templates.json', { templates: [] });
await ensureFile('campus.json', { campus: [] });
await ensureFile('schedule.json', { schedule: {} });
await ensureFile('faculties.json', { faculties: [] });
await ensureFile('gradebooks.json', { gradebooks: {} });
await ensureFile('subjects.json', { subjects: {} });
await ensureFile('dormitories.json', { dormitories: [] });
await ensureFile('links.json', { links: [] });
await ensureFile('teacher-journals.json', { journals: {} });

const SOCIAL_TYPES = [
  { id: 'phone', label: 'Телефон', icon: '📱', color: '#34c759', defaultVisible: 'staff' },
  { id: 'email', label: 'Email', icon: '📧', color: '#007aff', defaultVisible: 'all' },
  { id: 'telegram', label: 'Telegram', icon: '✈️', color: '#0088cc', defaultVisible: 'staff' },
  { id: 'whatsapp', label: 'WhatsApp', icon: '🟢', color: '#25d366', defaultVisible: 'staff' },
  { id: 'vk', label: 'ВКонтакте', icon: '🟦', color: '#0077ff', defaultVisible: 'all' },
  { id: 'ok', label: 'Одноклассники', icon: '🟠', color: '#ee8208', defaultVisible: 'all' },
  { id: 'rutube', label: 'RuTube', icon: '📺', color: '#0f0f0f', defaultVisible: 'all' },
  { id: 'dzen', label: 'Дзен', icon: '🧘', color: '#000000', defaultVisible: 'all' },
  { id: 'github', label: 'GitHub', icon: '🐙', color: '#333333', defaultVisible: 'all' },
  { id: 'website', label: 'Личный сайт', icon: '🌐', color: '#8e8e93', defaultVisible: 'all' },
  { id: 'custom', label: 'Другое', icon: '✏️', color: '#5856d6', defaultVisible: 'all' }
];

const sessions = new Map();
function makeToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

async function auth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const userId = sessions.get(token);
  if (!userId) return res.status(401).json({ error: 'Не авторизован' });
  const { users } = await readJSON('users.json');
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  req.user = user;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}
function safeUserStaff(u) { const { password, ...rest } = u; return rest; }
function safeUserFor(viewer, target) {
  const safe = safeUserStaff(target);
  const isStaff = viewer.role === 'starosta' || viewer.role === 'teacher';
  safe.socials = (target.socials || []).filter(s => {
    if (s.visible === 'private') return false;
    if (s.visible === 'staff') return isStaff;
    return true;
  });
  if (viewer.role === 'student') { delete safe.phone; delete safe.telegram; }
  return safe;
}

app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  const { users } = await readJSON('users.json');
  const user = users.find(u => u.login === login && u.password === password);
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = makeToken();
  sessions.set(token, user.id);
  res.json({ token, user: safeUserStaff(user) });
});

app.post('/api/logout', auth, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(safeUserStaff(req.user)));

app.patch('/api/me', auth, async (req, res) => {
  const { bio, photoUrl, officeHours } = req.body;
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Не найден' });
  if (bio !== undefined) users[idx].bio = bio;
  if (photoUrl !== undefined) { users[idx].photoUrl = photoUrl; users[idx].photoSource = photoUrl ? 'local' : 'none'; }
  if (officeHours !== undefined && users[idx].role === 'teacher') users[idx].officeHours = officeHours;
  await writeJSON('users.json', { users });
  res.json(safeUserStaff(users[idx]));
});

app.get('/api/social-types', auth, (req, res) => res.json(SOCIAL_TYPES));

app.post('/api/me/socials', auth, async (req, res) => {
  const { type, value, customLabel, visible } = req.body;
  if (!type || !value) return res.status(400).json({ error: 'Нужны type и value' });
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Не найден' });
  if (!users[idx].socials) users[idx].socials = [];
  const socialMeta = SOCIAL_TYPES.find(s => s.id === type);
  const newSocial = {
    id: 'so' + Date.now(), type, label: type === 'custom' ? (customLabel || 'Другое') : (socialMeta?.label || type),
    value: value.trim(), visible: visible || socialMeta?.defaultVisible || 'all', createdAt: new Date().toISOString()
  };
  users[idx].socials.push(newSocial);
  if (type === 'phone') users[idx].phone = newSocial.value;
  if (type === 'telegram') users[idx].telegram = newSocial.value;
  await writeJSON('users.json', { users });
  res.json(safeUserStaff(users[idx]));
});

app.patch('/api/me/socials/:socialId', auth, async (req, res) => {
  const { value, visible, customLabel } = req.body;
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Не найден' });
  const social = (users[idx].socials || []).find(s => s.id === req.params.socialId);
  if (!social) return res.status(404).json({ error: 'Соцсеть не найдена' });
  if (value !== undefined) social.value = value.trim();
  if (visible !== undefined) social.visible = visible;
  if (customLabel !== undefined && social.type === 'custom') social.label = customLabel;
  if (social.type === 'phone') users[idx].phone = social.value;
  if (social.type === 'telegram') users[idx].telegram = social.value;
  await writeJSON('users.json', { users });
  res.json(safeUserStaff(users[idx]));
});

app.delete('/api/me/socials/:socialId', auth, async (req, res) => {
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Не найден' });
  const social = (users[idx].socials || []).find(s => s.id === req.params.socialId);
  if (!social) return res.status(404).json({ error: 'Соцсеть не найдена' });
  users[idx].socials = (users[idx].socials || []).filter(s => s.id !== req.params.socialId);
  if (social.type === 'phone') users[idx].phone = '';
  if (social.type === 'telegram') users[idx].telegram = '';
  await writeJSON('users.json', { users });
  res.json(safeUserStaff(users[idx]));
});

app.get('/api/me/stats', auth, async (req, res) => {
  if (!req.user.group) return res.json({ total: 0, absent: 0, excused: 0, drone: 0, percent: 0 });
  const lists = await readJSON('working-lists.json');
  const list = lists[req.user.group];
  if (!list) return res.json({ total: 0, absent: 0, excused: 0, drone: 0, percent: 0 });
  const student = list.students.find(s => s.userId === req.user.id);
  if (!student) return res.json({ total: 0, absent: 0, excused: 0, drone: 0, percent: 0 });
  const att = student.attendance || {};
  const values = Object.values(att);
  const total = values.length;
  const absent = values.filter(v => v === 'absent').length;
  const excused = values.filter(v => v === 'excused').length;
  const drone = values.filter(v => v === 'drone').length;
  const percent = total ? Math.round(((excused + drone) / total) * 100) : 0;
  res.json({ total, absent, excused, drone, percent });
});

app.get('/api/groups', auth, async (req, res) => {
  const { groups } = await readJSON('groups.json');
  if (req.user.role === 'teacher') return res.json(groups.filter(g => g.teachers?.includes(req.user.id)));
  res.json(groups);
});

app.get('/api/groups/:code/teachers', auth, async (req, res) => {
  const { groups } = await readJSON('groups.json');
  const { users } = await readJSON('users.json');
  const g = groups.find(x => x.code === req.params.code);
  if (!g) return res.status(404).json({ error: 'Группа не найдена' });
  const teachers = users.filter(u => u.role === 'teacher' && (g.teachers || []).includes(u.id)).map(u => safeUserFor(req.user, u));
  res.json(teachers);
});

app.get('/api/groups/:code/birthdays', auth, async (req, res) => {
  const { users } = await readJSON('users.json');
  const code = req.params.code;
  const list = users.filter(u => u.group === code && u.birthday).map(u => ({ id: u.id, fullName: u.fullName, birthday: u.birthday }));
  const today = new Date();
  const todayStr = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  list.sort((a, b) => {
    const ma = a.birthday.slice(5), mb = b.birthday.slice(5);
    const da = ma >= todayStr ? ma : 'z' + ma;
    const db = mb >= todayStr ? mb : 'z' + mb;
    return da.localeCompare(db);
  });
  res.json(list);
});

app.get('/api/faculties', auth, async (req, res) => {
  const data = await readJSON('faculties.json');
  res.json(data?.faculties || []);
});

app.get('/api/starostas', auth, requireRole('starosta', 'teacher'), async (req, res) => {
  const { users } = await readJSON('users.json');
  const { groups } = await readJSON('groups.json');
  const facultiesData = await readJSON('faculties.json');
  const faculties = facultiesData?.faculties || [];
  const starostas = users.filter(u => u.role === 'starosta').map(u => {
    const group = groups.find(g => g.code === u.group);
    const faculty = group?.faculty ? faculties.find(f => f.id === group.faculty) : null;
    return {
      id: u.id, fullName: u.fullName, group: u.group, groupName: group?.name || '',
      course: group?.course || null, facultyId: group?.faculty || null,
      facultyName: faculty?.name || 'Не указан', facultyShort: faculty?.shortName || '',
      email: u.email, photoUrl: u.photoUrl || null
    };
  });
  res.json({ starostas, faculties });
});

app.get('/api/groups/:code/official', auth, async (req, res) => {
  const official = await readJSON('official-students.json');
  const list = official[req.params.code];
  if (!list) return res.status(404).json({ error: 'Группа не найдена' });

  const { users } = await readJSON('users.json');
  const enriched = list.map(function(s) {
    const u = s.userId ? users.find(x => x.id === s.userId) : null;
    return {
      ...s,
      individualPlan: !!(u && u.individualPlan)
    };
  });

  res.json(enriched);
});

app.get('/api/groups/:code/working', auth, async (req, res) => {
  const code = req.params.code;
  const isStarosta = req.user.role === 'starosta' && req.user.group === code;
  const isTeacher = req.user.role === 'teacher' && req.user.groups?.includes(code);
  const isStudent = req.user.role === 'student' && req.user.group === code;
  if (!isStarosta && !isTeacher && !isStudent) return res.status(403).json({ error: 'Нет доступа' });
  const lists = await readJSON('working-lists.json');
  const list = lists[code];
  if (!list) return res.status(404).json({ error: 'Список не найден' });
  res.json(list);
});

app.post('/api/groups/:code/working/:studentId/attendance', auth, requireRole('starosta'), async (req, res) => {
  const { code, studentId } = req.params;
  if (req.user.group !== code) return res.status(403).json({ error: 'Это не ваша группа' });
  const { date, status } = req.body;
  if (!date || !['absent', 'excused', 'drone'].includes(status)) return res.status(400).json({ error: 'Некорректные данные' });
  const lists = await readJSON('working-lists.json');
  const student = lists[code]?.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'Студент не найден' });
  if (!student.attendance) student.attendance = {};
  student.attendance[date] = status;
  await writeJSON('working-lists.json', lists);
  res.json(student);
});

app.delete('/api/groups/:code/working/:studentId/attendance/:date', auth, requireRole('starosta'), async (req, res) => {
  const { code, studentId, date } = req.params;
  if (req.user.group !== code) return res.status(403).json({ error: 'Это не ваша группа' });
  const lists = await readJSON('working-lists.json');
  const student = lists[code]?.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'Студент не найден' });
  if (student.attendance && student.attendance[date] !== undefined) {
    delete student.attendance[date];
    await writeJSON('working-lists.json', lists);
  }
  res.json(student);
});

app.post('/api/groups/:code/working/bulk-attendance', auth, requireRole('starosta'), async (req, res) => {
  const { code } = req.params;
  if (req.user.group !== code) return res.status(403).json({ error: 'Это не ваша группа' });
  const { date, status } = req.body;
  if (!date || !status) return res.status(400).json({ error: 'Нужны date и status' });
  const lists = await readJSON('working-lists.json');
  const list = lists[code];
  if (!list) return res.status(404).json({ error: 'Список не найден' });
  list.students.forEach(s => { if (!s.attendance) s.attendance = {}; s.attendance[date] = status; });
  await writeJSON('working-lists.json', lists);
  res.json(list);
});

app.get('/api/groups/:code/working/export.csv', auth, requireRole('starosta', 'teacher'), async (req, res) => {
  const { code } = req.params;
  const isStarosta = req.user.role === 'starosta' && req.user.group === code;
  const isTeacher = req.user.role === 'teacher' && req.user.groups?.includes(code);
  if (!isStarosta && !isTeacher) return res.status(403).json({ error: 'Нет доступа' });
  const lists = await readJSON('working-lists.json');
  const list = lists[code];
  if (!list) return res.status(404).json({ error: 'Список не найден' });
  const datesSet = new Set();
  list.students.forEach(s => Object.keys(s.attendance || {}).forEach(d => datesSet.add(d)));
  const dates = [...datesSet].sort();
  const header = ['ФИО', 'Зачётка', ...dates, 'Пропущено'];
  const rows = list.students.map(s => {
    let missed = 0;
    const cells = dates.map(d => {
      const st = s.attendance?.[d];
      if (st === 'absent') missed++;
      return st ? ({ absent: 'Н', excused: 'У', drone: 'С' }[st] || '') : '';
    });
    return [s.fullName, s.zachetka || '', ...cells, String(missed)];
  });
  const csv = [header, ...rows].map(r => r.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="journal-${code}.csv"`);
  res.send('\uFEFF' + csv);
});

app.get('/api/groups/:code/stats', auth, async (req, res) => {
  const code = req.params.code;
  const isStarosta = req.user.role === 'starosta' && req.user.group === code;
  const isTeacher = req.user.role === 'teacher' && req.user.groups?.includes(code);
  const isStudent = req.user.role === 'student' && req.user.group === code;
  if (!isStarosta && !isTeacher && !isStudent) return res.status(403).json({ error: 'Нет доступа' });

  const lists = await readJSON('working-lists.json');
  const list = lists[code];
  if (!list) return res.status(404).json({ error: 'Список не найден' });

  const schedData = await readJSON('schedule.json');
  const groupSched = schedData?.schedule?.[code];

  function getLessonsCountForDate(isoDate) {
    if (!groupSched) return 1;
    const d = new Date(isoDate + 'T00:00:00');
    const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
    const start = new Date(groupSched.weekStartDate + 'T00:00:00');
    const diffDays = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(diffDays / 7);
    const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;
    const dayData = (groupSched.weeks[String(weekNumber)] || []).find(x => x.day === dow);
    return dayData?.lessons?.length || 1;
  }

  const students = list.students || [];
  let totalAbsent = 0, totalExcused = 0, totalDrone = 0;
  const perStudent = [];

  students.forEach(function(s) {
    const att = s.attendance || {};
    let absent = 0, excused = 0, drone = 0, total = 0;

    Object.entries(att).forEach(function(v) {
      const lessonsCount = getLessonsCountForDate(v[0]);
      if (v[1] === 'absent') { absent += lessonsCount; total += lessonsCount; }
      else if (v[1] === 'excused') { excused += lessonsCount; total += lessonsCount; }
      else if (v[1] === 'drone') { drone += lessonsCount; total += lessonsCount; }
    });

    totalAbsent += absent; totalExcused += excused; totalDrone += drone;
    const percent = total ? Math.round(((excused + drone) / total) * 100) : 100;
    perStudent.push({ id: s.id, userId: s.userId, fullName: s.fullName, absent, excused, drone, total, percent });
  });

  const totalAll = totalAbsent + totalExcused + totalDrone;
  const groupPercent = totalAll ? Math.round(((totalExcused + totalDrone) / totalAll) * 100) : 100;
  perStudent.sort(function(a, b) { return a.percent - b.percent; });

  res.json({ groupPercent, totals: { absent: totalAbsent, excused: totalExcused, drone: totalDrone }, students: perStudent });
});

app.get('/api/groups/:code/schedule', auth, async (req, res) => {
  const code = req.params.code;
  const data = await readJSON('schedule.json');
  const groupSchedule = data?.schedule?.[code];
  if (!groupSchedule) return res.status(404).json({ error: 'Расписание не найдено' });

  const offset = parseInt(req.query.offset) || 0;
  const start = new Date(groupSchedule.weekStartDate + 'T00:00:00');
  const now = new Date();

  const currentWeekStart = new Date(now);
  const dow = currentWeekStart.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  currentWeekStart.setDate(currentWeekStart.getDate() + diff);
  currentWeekStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(currentWeekStart);
  weekStart.setDate(weekStart.getDate() + offset * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const diffDays = Math.floor((weekStart - start) / (1000 * 60 * 60 * 24));
  const weekIndex = Math.floor(diffDays / 7);
  const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;

  const lessons = groupSchedule.weeks[String(weekNumber)] || [];

  res.json({
    weekNumber: weekNumber,
    offset: offset,
    weekStartDate: weekStart.toISOString().slice(0, 10),
    weekEndDate: weekEnd.toISOString().slice(0, 10),
    days: lessons,
    availableWeeks: [1, 2]
  });
});

app.get('/api/groups/:code/events', auth, async (req, res) => {
  const { events } = await readJSON('events.json');
  res.json(events.filter(e => e.group === req.params.code));
});

app.post('/api/groups/:code/events', auth, requireRole('starosta'), async (req, res) => {
  const { code } = req.params;
  if (req.user.group !== code) return res.status(403).json({ error: 'Это не ваша группа' });
  const { title, date, time, description } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Нужны title и date' });
  const data = await readJSON('events.json');
  const newEvent = { id: 'e' + Date.now(), group: code, authorId: req.user.id, title, date, time: time || '', description: description || '' };
  data.events.push(newEvent);
  await writeJSON('events.json', data);
  res.json(newEvent);
});

app.delete('/api/events/:id', auth, requireRole('starosta'), async (req, res) => {
  const data = await readJSON('events.json');
  const ev = data.events.find(e => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'Событие не найдено' });
  if (ev.group !== req.user.group) return res.status(403).json({ error: 'Нет доступа' });
  data.events = data.events.filter(e => e.id !== req.params.id);
  await writeJSON('events.json', data);
  res.json({ ok: true });
});

app.get('/api/teachers', auth, async (req, res) => {
  const { users } = await readJSON('users.json');
  res.json(users.filter(u => u.role === 'teacher').map(u => safeUserFor(req.user, u)));
});

app.get('/api/teachers/:id/office-hours', auth, async (req, res) => {
  const { users } = await readJSON('users.json');
  const t = users.find(u => u.id === req.params.id && u.role === 'teacher');
  if (!t) return res.status(404).json({ error: 'Преподаватель не найден' });
  res.json(t.officeHours || []);
});

app.patch('/api/teachers/me/office-hours', auth, requireRole('teacher'), async (req, res) => {
  const { officeHours } = req.body;
  if (!Array.isArray(officeHours)) return res.status(400).json({ error: 'officeHours должен быть массивом' });
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Не найден' });
  users[idx].officeHours = officeHours;
  await writeJSON('users.json', { users });
  res.json({ ok: true, officeHours });
});

app.get('/api/teachers/:id/consultations', auth, async (req, res) => {
  const { users } = await readJSON('users.json');
  const t = users.find(u => u.id === req.params.id && u.role === 'teacher');
  if (!t) return res.status(404).json({ error: 'Преподаватель не найден' });
  res.json(t.consultations || []);
});

app.post('/api/teachers/me/consultations', auth, requireRole('teacher'), async (req, res) => {
  const { title, date, time, place, slots } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Нужны title и date' });
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Не найден' });
  if (!users[idx].consultations) users[idx].consultations = [];
  const consult = { id: 'c' + Date.now(), title, date, time: time || '', place: place || '', slots: (slots || []).map(s => ({ time: s, bookedBy: [] })), createdAt: new Date().toISOString() };
  users[idx].consultations.push(consult);
  await writeJSON('users.json', { users });
  res.json(consult);
});

app.delete('/api/teachers/me/consultations/:id', auth, requireRole('teacher'), async (req, res) => {
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.user.id);
  if (idx < 0) return res.status(404).json({ error: 'Не найден' });
  users[idx].consultations = (users[idx].consultations || []).filter(c => c.id !== req.params.id);
  await writeJSON('users.json', { users });
  res.json({ ok: true });
});

app.post('/api/teachers/:id/consultations/:cid/book', auth, requireRole('starosta', 'student'), async (req, res) => {
  const { slotTime, studentUserId } = req.body;
  if (!slotTime || !studentUserId) return res.status(400).json({ error: 'Нужны slotTime и studentUserId' });
  if (req.user.role === 'student' && studentUserId !== req.user.id) return res.status(403).json({ error: 'Можно записать только себя' });
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Преподаватель не найден' });
  const consult = (users[idx].consultations || []).find(c => c.id === req.params.cid);
  if (!consult) return res.status(404).json({ error: 'Консультация не найдена' });
  const slot = consult.slots.find(s => s.time === slotTime);
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });
  if (!slot.bookedBy.includes(studentUserId)) slot.bookedBy.push(studentUserId);
  await writeJSON('users.json', { users });
  res.json(slot);
});

app.delete('/api/teachers/:id/consultations/:cid/book', auth, requireRole('starosta', 'student'), async (req, res) => {
  const { slotTime, studentUserId } = req.body;
  if (req.user.role === 'student' && studentUserId !== req.user.id) return res.status(403).json({ error: 'Можно снять только себя' });
  const { users } = await readJSON('users.json');
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Преподаватель не найден' });
  const consult = (users[idx].consultations || []).find(c => c.id === req.params.cid);
  if (!consult) return res.status(404).json({ error: 'Консультация не найдена' });
  const slot = consult.slots.find(s => s.time === slotTime);
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });
  slot.bookedBy = slot.bookedBy.filter(id => id !== studentUserId);
  await writeJSON('users.json', { users });
  res.json(slot);
});

app.get('/api/announcements', auth, async (req, res) => {
  const { announcements } = await readJSON('announcements.json');
  let filtered = announcements;
  if (req.user.role === 'teacher') filtered = announcements.filter(a => a.authorId === req.user.id);
  else if (req.user.group) filtered = announcements.filter(a => a.groups.includes(req.user.group));
  filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(filtered);
});

app.post('/api/announcements', auth, requireRole('teacher'), async (req, res) => {
  const { groups, title, text, priority } = req.body;
  if (!groups?.length || !title || !text) return res.status(400).json({ error: 'Нужны groups, title, text' });
  const data = await readJSON('announcements.json');
  const newAnn = { id: 'a' + Date.now(), authorId: req.user.id, authorName: req.user.fullName, groups, title, text, priority: priority || 'normal', createdAt: new Date().toISOString() };
  data.announcements.push(newAnn);
  await writeJSON('announcements.json', data);
  res.json(newAnn);
});

app.delete('/api/announcements/:id', auth, requireRole('teacher'), async (req, res) => {
  const data = await readJSON('announcements.json');
  const a = data.announcements.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Не найдено' });
  if (a.authorId !== req.user.id) return res.status(403).json({ error: 'Не ваше' });
  data.announcements = data.announcements.filter(x => x.id !== req.params.id);
  await writeJSON('announcements.json', data);
  res.json({ ok: true });
});

app.get('/api/materials', auth, async (req, res) => {
  const { materials } = await readJSON('materials.json');
  let filtered = materials;
  if (req.user.role === 'teacher') filtered = materials.filter(m => m.authorId === req.user.id);
  else if (req.user.group) filtered = materials.filter(m => m.group === req.user.group);
  filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(filtered);
});

app.post('/api/materials', auth, requireRole('teacher'), async (req, res) => {
  const { group, subject, title, description, url, type } = req.body;
  if (!group || !title || !url) return res.status(400).json({ error: 'Нужны group, title, url' });
  const data = await readJSON('materials.json');
  const newMat = { id: 'mat' + Date.now(), authorId: req.user.id, authorName: req.user.fullName, group, subject: subject || '', title, description: description || '', url, type: type || 'link', createdAt: new Date().toISOString() };
  data.materials.push(newMat);
  await writeJSON('materials.json', data);
  res.json(newMat);
});

app.delete('/api/materials/:id', auth, requireRole('teacher'), async (req, res) => {
  const data = await readJSON('materials.json');
  const m = data.materials.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Не найдено' });
  if (m.authorId !== req.user.id) return res.status(403).json({ error: 'Не ваше' });
  data.materials = data.materials.filter(x => x.id !== req.params.id);
  await writeJSON('materials.json', data);
  res.json({ ok: true });
});

app.get('/api/users/:id', auth, async (req, res) => {
  const { users } = await readJSON('users.json');
  const u = users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  if (u.id === req.user.id) return res.json(safeUserStaff(u));
  res.json(safeUserFor(req.user, u));
});

app.get('/api/users/:id/stats', auth, async (req, res) => {
  const targetId = req.params.id;
  const { users } = await readJSON('users.json');
  const target = users.find(u => u.id === targetId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (req.user.role === 'student' && targetId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const lists = await readJSON('working-lists.json');
  const group = target.group;
  if (!group) return res.json({ total: 0, absent: 0, excused: 0, drone: 0, percent: 0 });
  const student = lists[group]?.students.find(s => s.userId === targetId);
  if (!student) return res.json({ total: 0, absent: 0, excused: 0, drone: 0, percent: 0 });
  const att = student.attendance || {};
  const values = Object.values(att);
  const total = values.length;
  const absent = values.filter(v => v === 'absent').length;
  const excused = values.filter(v => v === 'excused').length;
  const drone = values.filter(v => v === 'drone').length;
  const percent = total ? Math.round(((excused + drone) / total) * 100) : 0;
  res.json({ total, absent, excused, drone, percent });
});

app.get('/api/users/:id/full-stats', auth, async (req, res) => {
  const targetId = req.params.id;
  const { users } = await readJSON('users.json');
  const target = users.find(u => u.id === targetId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (req.user.role === 'student' && targetId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

  const lists = await readJSON('working-lists.json');
  const group = target.group;
  const emptyStats = { total: 0, present: 0, absent: 0, excused: 0, drone: 0, percent: 100, absences: [], grades: [], averageGrade: null, fromSchedule: true };
  if (!group) return res.json(emptyStats);

  const schedData = await readJSON('schedule.json');
  const groupSched = schedData?.schedule?.[group];

  // Считаем ВСЕ пары от weekStartDate до сегодня
  function countAllLessonsUpToToday() {
    if (!groupSched) return 0;
    const start = new Date(groupSched.weekStartDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let count = 0;
    const d = new Date(start);
    while (d <= today) {
      const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
      if (dow !== 'sun') {
        const diffDays = Math.floor((d - start) / (1000 * 60 * 60 * 24));
        const weekIndex = Math.floor(diffDays / 7);
        const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;
        const dayData = (groupSched.weeks[String(weekNumber)] || []).find(x => x.day === dow);
        if (dayData && dayData.lessons) count += dayData.lessons.length;
      }
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  function getLessonsForDate(isoDate) {
    if (!groupSched) return [];
    const d = new Date(isoDate + 'T00:00:00');
    const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
    const start = new Date(groupSched.weekStartDate + 'T00:00:00');
    const diffDays = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(diffDays / 7);
    const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;
    const dayData = (groupSched.weeks[String(weekNumber)] || []).find(x => x.day === dow);
    return dayData?.lessons || [];
  }

  const dowNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  const student = lists[group]?.students.find(s => s.userId === targetId);
  const att = student?.attendance || {};

  // Посещаемость = все пары минус пропуски (Н + БПЛА), делённое на все пары
  const totalAll = countAllLessonsUpToToday();

  let absent = 0, excused = 0, drone = 0;
  const absences = [];

  Object.entries(att).forEach(function(v) {
    const date = v[0], status = v[1];
    const lessons = getLessonsForDate(date);
    const lessonsCount = lessons.length || 1;
    if (status === 'absent') absent += lessonsCount;
    else if (status === 'excused') excused += lessonsCount;
    else if (status === 'drone') drone += lessonsCount;
    if (status === 'absent' || status === 'drone') {
      const d = new Date(date + 'T00:00:00');
      absences.push({ date, status, weekday: dowNames[d.getDay()], lessons, lessonsCount });
    }
  });

  absences.sort(function(a, b) { return b.date.localeCompare(a.date); });

  const attended = Math.max(0, totalAll - absent - drone);
  const percent = totalAll ? Math.round((attended / totalAll) * 100) : 100;

  const gradesMap = student?.grades || {};
  const grades = Object.entries(gradesMap).map(g => ({ subject: g[0], grade: g[1] }));
  const averageGrade = grades.length ? (grades.reduce((s, g) => s + g.grade, 0) / grades.length).toFixed(2) : null;

  res.json({
    total: totalAll, present: attended, absent, excused, drone, percent,
    absences, grades, averageGrade, fromSchedule: true
  });
});

app.get('/api/users/:id/notes', auth, requireRole('starosta', 'teacher'), async (req, res) => {
  const { notes } = await readJSON('profile-notes.json');
  res.json(notes.filter(n => n.authorId === req.user.id && n.targetUserId === req.params.id));
});

app.post('/api/users/:id/notes', auth, requireRole('starosta', 'teacher'), async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Нужен text' });
  const data = await readJSON('profile-notes.json');
  const note = { id: 'n' + Date.now(), authorId: req.user.id, targetUserId: req.params.id, text, visibility: 'private', createdAt: new Date().toISOString() };
  data.notes.push(note);
  await writeJSON('profile-notes.json', data);
  res.json(note);
});

app.delete('/api/notes/:id', auth, requireRole('starosta', 'teacher'), async (req, res) => {
  const data = await readJSON('profile-notes.json');
  const n = data.notes.find(x => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Не найдено' });
  if (n.authorId !== req.user.id) return res.status(403).json({ error: 'Не ваше' });
  data.notes = data.notes.filter(x => x.id !== req.params.id);
  await writeJSON('profile-notes.json', data);
  res.json({ ok: true });
});

// ЗАЧЁТНАЯ КНИЖКА
app.get('/api/users/:id/gradebook', auth, async (req, res) => {
  const targetId = req.params.id;
  if (req.user.role === 'student' && targetId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const { users } = await readJSON('users.json');
  const target = users.find(u => u.id === targetId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.role !== 'student' && target.role !== 'starosta') {
    return res.status(400).json({ error: 'Зачётка есть только у студента или старосты' });
  }
  const data = await readJSON('gradebooks.json');
  const gb = data?.gradebooks?.[targetId];
  if (!gb) {
    return res.json({
      studentId: targetId, fullName: target.fullName, group: target.group,
      empty: true, specialty: null, enrollmentYear: null,
      currentYear: null, currentSemester: null, studyDuration: null, semesters: []
    });
  }
  res.json({ ...gb, fullName: target.fullName, group: target.group, empty: false });
});

app.patch('/api/users/:id/gradebook', auth, async (req, res) => {
  const targetId = req.params.id;
  if (req.user.role !== 'starosta') return res.status(403).json({ error: 'Только староста может менять зачётку' });
  const { specialty, enrollmentYear, currentYear, currentSemester, studyDuration } = req.body;
  const data = await readJSON('gradebooks.json');
  if (!data.gradebooks[targetId]) data.gradebooks[targetId] = { studentId: targetId, semesters: [] };
  const gb = data.gradebooks[targetId];
  if (specialty !== undefined) gb.specialty = specialty;
  if (enrollmentYear !== undefined) gb.enrollmentYear = enrollmentYear;
  if (currentYear !== undefined) gb.currentYear = currentYear;
  if (currentSemester !== undefined) gb.currentSemester = currentSemester;
  if (studyDuration !== undefined) gb.studyDuration = studyDuration;
  await writeJSON('gradebooks.json', data);
  res.json(gb);
});

app.post('/api/users/:id/gradebook/records', auth, async (req, res) => {
  const targetId = req.params.id;
  if (req.user.role !== 'starosta') return res.status(403).json({ error: 'Только староста может менять зачётку' });
  const { year, semester, type, record } = req.body;
  if (!year || !semester || !type || !record) return res.status(400).json({ error: 'Нужны year, semester, type, record' });
  if (!['exams', 'credits', 'practice', 'reports'].includes(type)) return res.status(400).json({ error: 'Неверный тип' });
  const data = await readJSON('gradebooks.json');
  if (!data.gradebooks[targetId]) data.gradebooks[targetId] = { studentId: targetId, semesters: [] };
  const gb = data.gradebooks[targetId];
  let sem = gb.semesters.find(s => s.year === year && s.semester === semester);
  if (!sem) {
    sem = { year, semester, label: year + ' курс · ' + semester + ' семестр', exams: [], credits: [], practice: [], reports: [] };
    gb.semesters.push(sem);
  }
  if (!sem[type]) sem[type] = [];
  sem[type].push(record);
  await writeJSON('gradebooks.json', data);
  res.json(sem);
});

app.delete('/api/users/:id/gradebook/records/:type/:index', auth, async (req, res) => {
  const targetId = req.params.id;
  if (req.user.role !== 'starosta') return res.status(403).json({ error: 'Только староста может менять зачётку' });
  const { year, semester } = req.query;
  const type = req.params.type;
  const index = parseInt(req.params.index);
  const data = await readJSON('gradebooks.json');
  const gb = data.gradebooks?.[targetId];
  if (!gb) return res.status(404).json({ error: 'Зачётка не найдена' });
  const sem = gb.semesters.find(s => s.year === Number(year) && s.semester === Number(semester));
  if (!sem || !sem[type]) return res.status(404).json({ error: 'Семестр не найден' });
  sem[type].splice(index, 1);
  await writeJSON('gradebooks.json', data);
  res.json(sem);
});

app.get('/api/campus', auth, async (req, res) => {
  const data = await readJSON('campus.json');
  res.json(data?.campus || []);
});

// Расписание на сегодня (для главной)
app.get('/api/groups/:code/schedule/today', auth, async (req, res) => {
  const code = req.params.code;
  const data = await readJSON('schedule.json');
  const groupSchedule = data?.schedule?.[code];
  if (!groupSchedule) return res.status(404).json({ error: 'Расписание не найдено' });

  const today = new Date();
  const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][today.getDay()];
  const dowNames = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  // Какая сейчас неделя
  const start = new Date(groupSchedule.weekStartDate + 'T00:00:00');
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  const weekIndex = Math.floor(diffDays / 7);
  const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;

  const dayData = (groupSchedule.weeks[String(weekNumber)] || []).find(d => d.day === dow);
  const lessons = dayData?.lessons || [];

  res.json({
    day: dow,
    dayName: dowNames[today.getDay()],
    date: today.toISOString().slice(0, 10),
    weekNumber: weekNumber,
    lessons: lessons,
    isWeekend: dow === 'sat' || dow === 'sun'
  });
});

// Список недель для выбора
app.get('/api/groups/:code/schedule/weeks', auth, async (req, res) => {
  const code = req.params.code;
  const data = await readJSON('schedule.json');
  const groupSchedule = data?.schedule?.[code];
  if (!groupSchedule) return res.status(404).json({ error: 'Расписание не найдено' });

  const start = new Date(groupSchedule.weekStartDate + 'T00:00:00');

  // Текущая неделя (понедельник)
  const now = new Date();
  const currentWeekStart = new Date(now);
  const dow = currentWeekStart.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  currentWeekStart.setDate(currentWeekStart.getDate() + diff);
  currentWeekStart.setHours(0, 0, 0, 0);

  // Список недель: 8 назад + текущая + 8 вперёд = 17 недель
  const weeks = [];
  for (let offset = -8; offset <= 8; offset++) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() + offset * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const diffDays = Math.floor((weekStart - start) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(diffDays / 7);
    const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;

    weeks.push({
      offset: offset,
      weekStart: weekStart.toISOString().slice(0, 10),
      weekEnd: weekEnd.toISOString().slice(0, 10),
      weekNumber: weekNumber,
      isCurrent: offset === 0
    });
  }

  res.json({ weeks });
});

// Расписание преподавателя (собирается из расписаний всех групп)
app.get('/api/teachers/:id/schedule', auth, async (req, res) => {
  const teacherId = req.params.id;
  const offset = parseInt(req.query.offset) || 0;

  const { users } = await readJSON('users.json');
  const teacher = users.find(u => u.id === teacherId && u.role === 'teacher');
  if (!teacher) return res.status(404).json({ error: 'Преподаватель не найден' });

  const teacherName = teacher.fullName;
  // Возможные варианты написания в расписании (ФИО полностью или сокращённо)
  const parts = teacherName.split(' ');
  const shortName = parts[0] + ' ' + (parts[1] ? parts[1][0] + '.' : '') + (parts[2] ? parts[2][0] + '.' : '');
  const shortName2 = parts[0] + ' ' + (parts[2] ? parts[2][0] + '.' : '') + (parts[1] ? parts[1][0] + '.' : '');

  const data = await readJSON('schedule.json');
  const allSchedule = data?.schedule || {};

  // Вычисляем даты недели для offset
  const now = new Date();
  const currentWeekStart = new Date(now);
  const dow = currentWeekStart.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  currentWeekStart.setDate(currentWeekStart.getDate() + diff);
  currentWeekStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(currentWeekStart);
  weekStart.setDate(weekStart.getDate() + offset * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  // Собираем пары препода из всех групп
  const daysMap = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };

  Object.keys(allSchedule).forEach(function(groupCode) {
    const gs = allSchedule[groupCode];
    if (!gs || !gs.weeks) return;

    const baseStart = new Date(gs.weekStartDate + 'T00:00:00');
    const diffDays = Math.floor((weekStart - baseStart) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(diffDays / 7);
    const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;

    const dayList = gs.weeks[String(weekNumber)] || [];
    dayList.forEach(function(day) {
      (day.lessons || []).forEach(function(l) {
        const t = l.teacher || '';
        // Ищем совпадение по короткому или полному имени
        // Нормализуем: убираем точки, приводим к нижнему регистру, берём только фамилию + инициалы
  function normalizeTeacher(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const teacherNorm = normalizeTeacher(teacherName);
  const tNorm = normalizeTeacher(t);
  // Совпадение, если:
  // 1) полное совпадение
  // 2) фамилия совпадает и первая буква имени совпадает
  const tParts = tNorm.split(' ');
  const teacherParts = teacherNorm.split(' ');
  const sameSurname = tParts[0] === teacherParts[0];
  const sameInitial = !tParts[1] || !teacherParts[1] || tParts[1][0] === teacherParts[1][0];
  if (tNorm === teacherNorm || (sameSurname && sameInitial)) {
          if (!daysMap[day.day]) daysMap[day.day] = [];
          daysMap[day.day].push({
            time: l.time,
            subject: l.subject,
            type: l.type,
            room: l.room,
            group: groupCode
          });
        }
      });
    });
  });

  // Формируем массив дней
  const days = Object.keys(daysMap).map(function(dayKey) {
    return { day: dayKey, lessons: daysMap[dayKey].sort(function(a, b) {
      return (a.time || '').localeCompare(b.time || '');
    })};
  });

  res.json({
    teacherId: teacherId,
    teacherName: teacherName,
    offset: offset,
    weekStartDate: weekStart.toISOString().slice(0, 10),
    weekEndDate: weekEnd.toISOString().slice(0, 10),
    days: days,
    availableWeeks: [1, 2]
  });
});

// Список недель для расписания преподавателя
app.get('/api/teachers/:id/schedule/weeks', auth, async (req, res) => {
  const teacherId = req.params.id;
  const { users } = await readJSON('users.json');
  const teacher = users.find(u => u.id === teacherId && u.role === 'teacher');
  if (!teacher) return res.status(404).json({ error: 'Преподаватель не найден' });

  const now = new Date();
  const currentWeekStart = new Date(now);
  const dow = currentWeekStart.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  currentWeekStart.setDate(currentWeekStart.getDate() + diff);
  currentWeekStart.setHours(0, 0, 0, 0);

  const weeks = [];
  for (let offset = -8; offset <= 8; offset++) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() + offset * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({
      offset: offset,
      weekStart: weekStart.toISOString().slice(0, 10),
      weekEnd: weekEnd.toISOString().slice(0, 10),
      isCurrent: offset === 0
    });
  }
  res.json({ weeks });
});

// Список всех групп (для поиска расписания)
app.get('/api/all-groups', auth, async (req, res) => {
  const { groups } = await readJSON('groups.json');
  const facultiesData = await readJSON('faculties.json');
  const faculties = facultiesData?.faculties || [];

  const result = groups.map(function(g) {
    const fac = g.faculty ? faculties.find(f => f.id === g.faculty) : null;
    return {
      code: g.code,
      name: g.name || '',
      faculty: g.faculty || null,
      facultyName: fac?.shortName || fac?.name || '',
      course: g.course || null
    };
  });
  res.json(result);
});

// ПОИСК ГРУПП И ПРЕПОДОВ
app.get('/api/search', auth, async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 2) return res.json({ groups: [], teachers: [] });

  const { groups } = await readJSON('groups.json');
  const { users } = await readJSON('users.json');

  const foundGroups = groups.filter(g => (g.code + ' ' + (g.name || '')).toLowerCase().indexOf(q) !== -1);

  const foundTeachers = users
    .filter(u => u.role === 'teacher' && u.fullName.toLowerCase().indexOf(q) !== -1)
    .map(u => ({ id: u.id, fullName: u.fullName, faculty: u.faculty, bio: u.bio }));

  res.json({ groups: foundGroups, teachers: foundTeachers });
});

// ПРЕДМЕТЫ
app.get('/api/groups/:code/subjects', auth, async (req, res) => {
  const data = await readJSON('subjects.json');
  const subj = data?.subjects?.[req.params.code];
  if (!subj) return res.json({ empty: true, courses: {} });
  res.json(subj);
});

// ОБЩЕЖИТИЯ
app.get('/api/dormitories', auth, async (req, res) => {
  const data = await readJSON('dormitories.json');
  res.json(data?.dormitories || []);
});

// ПОЛЕЗНЫЕ ССЫЛКИ
app.get('/api/links', auth, async (req, res) => {
  const data = await readJSON('links.json');
  res.json(data?.links || []);
});

// РЕЙТИНГ ГРУППЫ
app.get('/api/groups/:code/rating', auth, async (req, res) => {
  const code = req.params.code;
  const lists = await readJSON('working-lists.json');
  const list = lists[code];
  if (!list) return res.status(404).json({ error: 'Группа не найдена' });

  const schedData = await readJSON('schedule.json');
  const groupSched = schedData?.schedule?.[code];

  function totalLessons() {
    if (!groupSched) return 0;
    const start = new Date(groupSched.weekStartDate + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    let count = 0;
    const d = new Date(start);
    while (d <= today) {
      const dow = ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
      if (dow !== 'sun') {
        const diffDays = Math.floor((d - start) / 86400000);
        const weekIndex = Math.floor(diffDays / 7);
        const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;
        const dayData = (groupSched.weeks[String(weekNumber)] || []).find(x => x.day === dow);
        if (dayData?.lessons) count += dayData.lessons.length;
      }
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  function lessonsForDate(isoDate) {
    if (!groupSched) return 1;
    const d = new Date(isoDate + 'T00:00:00');
    const dow = ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
    const start = new Date(groupSched.weekStartDate + 'T00:00:00');
    const diffDays = Math.floor((d - start) / 86400000);
    const weekIndex = Math.floor(diffDays / 7);
    const weekNumber = ((weekIndex % 2) + 2) % 2 + 1;
    const dayData = (groupSched.weeks[String(weekNumber)] || []).find(x => x.day === dow);
    return dayData?.lessons?.length || 1;
  }

  const totalAll = totalLessons();
  const students = (list.students || []).map(s => {
    let absent = 0, drone = 0;
    Object.entries(s.attendance || {}).forEach(v => {
      const cnt = lessonsForDate(v[0]);
      if (v[1] === 'absent') absent += cnt;
      else if (v[1] === 'drone') drone += cnt;
    });
    const attended = Math.max(0, totalAll - absent - drone);
    const attendPercent = totalAll ? Math.round((attended / totalAll) * 100) : 100;

    const grades = Object.values(s.grades || {});
    const avgGrade = grades.length ? (grades.reduce((a, b) => a + b, 0) / grades.length) : null;

    // Итоговый рейтинг = 60% посещаемость + 40% средний балл (нормализованный)
    const gradeScore = avgGrade ? (avgGrade / 5) * 100 : attendPercent;
    const rating = Math.round(attendPercent * 0.6 + gradeScore * 0.4);

    return {
      id: s.id, userId: s.userId, fullName: s.fullName,
      attendPercent, avgGrade: avgGrade ? avgGrade.toFixed(2) : null,
      rating, absent, drone
    };
  });

  students.sort((a, b) => b.rating - a.rating);
  students.forEach((s, i) => s.place = i + 1);

  res.json({ totalLessons: totalAll, students });
});

// ============================================================
//  ЖУРНАЛ ПРЕПОДАВАТЕЛЯ
// ============================================================

// Получить журнал: группа + предмет для текущего препода
app.get('/api/teacher/journal', auth, requireRole('teacher'), async (req, res) => {
  const { group, subject } = req.query;
  if (!group || !subject) return res.status(400).json({ error: 'Нужны group и subject' });

  const data = await readJSON('teacher-journals.json');
  const key = group;
  const journal = data.journals?.[key]?.[subject];

  const { users } = await readJSON('users.json');
  const students = users
    .filter(u => (u.role === 'student' || u.role === 'starosta') && u.group === group)
    .map(u => ({
      id: u.id,
      fullName: u.fullName,
      individualPlan: !!u.individualPlan
    }));
    

  // Считаем количество Н для каждого студента (для цвета)
  const marksMap = journal?.students || {};
  const enriched = students.map(function(s) {
    const studentMarks = marksMap[s.id] || {};
    const nCount = Object.values(studentMarks).filter(m => m === 'Н').length;
    return {
      id: s.id,
      fullName: s.fullName,
      individualPlan: !!s.individualPlan,
      fromGroup: s.fromGroup,
      nCount: nCount,
      colorLevel: getColorLevel(nCount)
    };
  });

 
  // Всегда добавляем даты текущего месяца (без воскресений)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let dates = journal?.dates || [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    if (d.getDay() !== 0) {
      const iso = d.toISOString().slice(0, 10);
      if (!dates.includes(iso)) dates.push(iso);
    }
  }
  dates.sort();

  res.json({
    group: group,
    subject: subject,
    dates: dates,
    marks: marksMap,
    students: enriched
  });
});

// Поставить/изменить оценку
app.post('/api/teacher/journal/mark', auth, requireRole('teacher'), async (req, res) => {
  const { group, subject, studentId, date, mark } = req.body;
  if (!group || !subject || !studentId || !date) {
    return res.status(400).json({ error: 'Нужны group, subject, studentId, date' });
  }
  if (mark !== null && !['Н', 'С', '2', '3', '4', '5'].includes(mark)) {
    return res.status(400).json({ error: 'Недопустимая оценка' });
  }

  const data = await readJSON('teacher-journals.json');
  if (!data.journals[group]) data.journals[group] = {};
  if (!data.journals[group][subject]) {
    data.journals[group][subject] = {
      teacherId: req.user.id,
      semester: getCurrentSemester(),
      dates: [],
      students: {}
    };
  }
  const journal = data.journals[group][subject];

  // Если сменился семестр — сбрасываем журнал
  const currentSemester = getCurrentSemester();
  if (journal.semester !== currentSemester) {
    journal.semester = currentSemester;
    journal.dates = [];
    journal.students = {};
  }

  // Добавляем дату, если её ещё нет
  if (!journal.dates.includes(date)) journal.dates.push(date);
  journal.dates.sort();

  if (!journal.students[studentId]) journal.students[studentId] = {};

  if (mark === null) {
    delete journal.students[studentId][date];
    // Если у студента больше нет отметок — не удаляем его полностью, оставляем пустым
    if (Object.keys(journal.students[studentId]).length === 0) {
      delete journal.students[studentId];
    }
  } else {
    journal.students[studentId][date] = mark;
  }

  await writeJSON('teacher-journals.json', data);
  res.json(journal);
});

// ============================================================
//  СРЕДНИЙ БАЛЛ ПО ЗАЧЁТКЕ
// ============================================================

app.get('/api/users/:id/gradebook-average', auth, async (req, res) => {
  const targetId = req.params.id;
  const { users } = await readJSON('users.json');
  const target = users.find(u => u.id === targetId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  if (req.user.role === 'student' && targetId !== req.user.id) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  const data = await readJSON('gradebooks.json');
  const gb = data?.gradebooks?.[targetId];
  if (!gb) return res.json({ average: null, count: 0 });

  // Собираем все оценки из зачётки
  const grades = [];
  (gb.semesters || []).forEach(sem => {
    (sem.exams || []).forEach(e => {
      if (typeof e.grade === 'number') grades.push(e.grade);
    });
    (sem.credits || []).forEach(c => {
      if (typeof c.grade === 'number') grades.push(c.grade);
    });
  });

  const average = grades.length
    ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(2)
    : null;

  res.json({ average, count: grades.length });
});

// ============================================================
//  ПОСЕЩАЕМОСТЬ ОТ ПРЕПОДАВАТЕЛЯ (замена для старостинского)
// ============================================================

// Пересчёт % посещаемости от журнала преподавателя (для студента)
app.get('/api/teacher/attendance/:studentId', auth, async (req, res) => {
  const studentId = req.params.studentId;
  const { users } = await readJSON('users.json');
  const student = users.find(u => u.id === studentId);
  if (!student) return res.status(404).json({ error: 'Студент не найден' });

  const data = await readJSON('teacher-journals.json');

  let total = 0;
  let attended = 0;
  let absent = 0;
  let excused = 0;
  const bySubject = {};

  Object.keys(data.journals || {}).forEach(function(groupCode) {
    Object.keys(data.journals[groupCode] || {}).forEach(function(subject) {
      const journal = data.journals[groupCode][subject];
      const marks = journal.students?.[studentId] || {};
      let subjTotal = 0, subjAttended = 0, subjAbsent = 0, subjExcused = 0;

      Object.values(marks).forEach(function(m) {
        subjTotal++;
        if (m === 'Н') subjAbsent++;
        else if (m === 'С') subjExcused++;
        else subjAttended++; // 2/3/4/5
      });

      total += subjTotal;
      attended += subjAttended;
      absent += subjAbsent;
      excused += subjExcused;

      bySubject[subject] = {
        total: subjTotal,
        attended: subjAttended,
        absent: subjAbsent,
        excused: subjExcused
      };
    });
  });

  const percent = total ? Math.round(((attended + excused) / total) * 100) : 100;

  res.json({ total, attended, absent, excused, percent, bySubject });
});

// ============================================================
//  КУРАТОР
// ============================================================

// Список всех журналов по всем группам и предметам
app.get('/api/curator/journals', auth, requireRole('curator'), async (req, res) => {
  const data = await readJSON('teacher-journals.json');
  const { users } = await readJSON('users.json');

  const result = [];

  Object.keys(data.journals || {}).forEach(function(groupCode) {
    Object.keys(data.journals[groupCode]).forEach(function(subject) {
      const journal = data.journals[groupCode][subject];
      const teacher = users.find(u => u.id === journal.teacherId);

      // Статистика по предмету
      let totalMarks = 0, nCount = 0, sCount = 0, gradesCount = 0;
      let gradesSum = 0;

      Object.values(journal.students || {}).forEach(function(marks) {
        Object.values(marks).forEach(function(m) {
          totalMarks++;
          if (m === 'Н') nCount++;
          else if (m === 'С') sCount++;
          else {
            gradesCount++;
            gradesSum += parseInt(m);
          }
        });
      });

      const avgGrade = gradesCount ? (gradesSum / gradesCount).toFixed(2) : null;

      result.push({
        group: groupCode,
        subject: subject,
        teacherName: teacher?.fullName || 'Неизвестный',
        teacherId: journal.teacherId,
        semester: journal.semester || '—',
        studentsCount: Object.keys(journal.students || {}).length,
        totalMarks: totalMarks,
        nCount: nCount,
        sCount: sCount,
        avgGrade: avgGrade
      });
    });
  });

  res.json(result);
});

// Детальный просмотр любого журнала куратором
app.get('/api/curator/journal', auth, requireRole('curator'), async (req, res) => {
  const { group, subject } = req.query;
  if (!group || !subject) return res.status(400).json({ error: 'Нужны group и subject' });

  const data = await readJSON('teacher-journals.json');
  const journal = data.journals?.[group]?.[subject];
  if (!journal) return res.status(404).json({ error: 'Журнал не найден' });

  const { users } = await readJSON('users.json');
  const students = users
    .filter(u => (u.role === 'student' || u.role === 'starosta') && u.group === group)
    .map(function(u) {
      const marks = journal.students?.[u.id] || {};
      const nCount = Object.values(marks).filter(m => m === 'Н').length;
      return {
        id: u.id,
        fullName: u.fullName,
        individualPlan: !!u.individualPlan,
        marks: marks,
        nCount: nCount,
        colorLevel: getColorLevel(nCount)
      };
    });

  res.json({
    group: group,
    subject: subject,
    semester: journal.semester || '—',
    dates: journal.dates || [],
    students: students
  });
});

// Сводка по студенту (для куратора): все его журналы, средний балл, посещаемость
app.get('/api/curator/student/:id/summary', auth, requireRole('curator'), async (req, res) => {
  const studentId = req.params.id;
  const { users } = await readJSON('users.json');
  const student = users.find(u => u.id === studentId);
  if (!student) return res.status(404).json({ error: 'Студент не найден' });

  const data = await readJSON('teacher-journals.json');
  const result = {
    studentId: studentId,
    fullName: student.fullName,
    group: student.group,
    individualPlan: !!student.individualPlan,
    subjects: []
  };

  let totalMarks = 0, attended = 0, absent = 0, excused = 0;
  let gradesSum = 0, gradesCount = 0;

  Object.keys(data.journals || {}).forEach(function(groupCode) {
    Object.keys(data.journals[groupCode]).forEach(function(subject) {
      const journal = data.journals[groupCode][subject];
      const marks = journal.students?.[studentId] || {};
      if (Object.keys(marks).length === 0) return;

      const subj = { subject: subject, group: groupCode, marks: marks, n: 0, s: 0, grades: [] };
      Object.values(marks).forEach(function(m) {
        totalMarks++;
        if (m === 'Н') { subj.n++; absent++; }
        else if (m === 'С') { subj.s++; excused++; }
        else {
          subj.grades.push(m);
          attended++;
          gradesSum += parseInt(m);
          gradesCount++;
        }
      });
      result.subjects.push(subj);
    });
  });

  const percent = totalMarks ? Math.round(((attended + excused) / totalMarks) * 100) : 100;

  result.stats = {
    totalMarks: totalMarks,
    attended: attended,
    absent: absent,
    excused: excused,
    percent: percent,
    avgGrade: gradesCount ? (gradesSum / gradesCount).toFixed(2) : null,
    gradesCount: gradesCount
  };

  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});
