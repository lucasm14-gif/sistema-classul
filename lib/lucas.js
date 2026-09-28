// Área pessoal do Lucas: missões e rotinas.
// A tela (via /api/lucas/*, travada por PIN) e o Hermes usam estas mesmas
// funções, então a regra de prioridade, conclusão e sequência é uma só.
import { q } from './db.js';
import { dayKeySP, OrderError } from './orders.js';

export const LUCAS_PRIORITIES = ['baixa', 'media', 'critica'];
export const LUCAS_STATUSES = ['aberta', 'andamento', 'concluida'];

// Dia (YYYY-MM-DD) N dias atrás no fuso de São Paulo.
export function lucasDayBack(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKeySP(d);
}

// Sequência de dias seguidos cumpridos, contando só os dias em que a rotina é
// programada. O dia de hoje ainda em aberto não quebra a sequência.
function lucasStreak(days, doneSet) {
  const scheduled = (key) => {
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    return days.includes(String(weekday));
  };
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const key = lucasDayBack(i);
    if (!scheduled(key)) continue;
    if (doneSet.has(key)) {
      streak += 1;
      continue;
    }
    if (i === 0) continue; // hoje ainda dá tempo
    break;
  }
  return streak;
}

// Tudo que a tela precisa numa chamada só: missões, rotinas (com histórico de 28
// dias, sequência e status de hoje) e os números do topo.
export async function lucasOverview() {
  const today = dayKeySP(new Date());
  const weekday = String(new Date(`${today}T12:00:00Z`).getUTCDay());

  const { rows: tasks } = await q(
    `SELECT id, title, notes, priority, status, due_date, done_at, created_at, updated_at
     FROM lucas_tasks
     ORDER BY CASE status WHEN 'andamento' THEN 0 WHEN 'aberta' THEN 1 ELSE 2 END,
              CASE priority WHEN 'critica' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
              COALESCE(due_date, '9999-12-31'), id DESC`
  );
  const { rows: routineRows } = await q(
    'SELECT id, title, time_of_day, days, active FROM lucas_routines ORDER BY COALESCE(time_of_day, \'99:99\'), id'
  );
  const since = lucasDayBack(27);
  const { rows: logs } = await q('SELECT routine_id, day FROM lucas_routine_logs WHERE day >= $1', [since]);

  const byRoutine = new Map();
  for (const log of logs) {
    if (!byRoutine.has(log.routine_id)) byRoutine.set(log.routine_id, new Set());
    byRoutine.get(log.routine_id).add(log.day);
  }

  const history = [];
  for (let i = 27; i >= 0; i--) history.push(lucasDayBack(i));

  const routines = routineRows.map((r) => {
    const done = byRoutine.get(r.id) || new Set();
    const days = String(r.days || '0123456');
    return {
      ...r,
      days,
      today: days.includes(weekday),
      done_today: done.has(today),
      streak: lucasStreak(days, done),
      history: history.map((day) => ({ day, done: done.has(day) }))
    };
  });

  const todayRoutines = routines.filter((r) => r.active && r.today);
  const doneToday = todayRoutines.filter((r) => r.done_today).length;
  const open = tasks.filter((t) => t.status !== 'concluida');

  return {
    today,
    tasks,
    routines,
    stats: {
      routines_today: todayRoutines.length,
      routines_done: doneToday,
      tasks_open: open.length,
      tasks_critical: open.filter((t) => t.priority === 'critica').length,
      tasks_late: open.filter((t) => t.due_date && t.due_date < today).length,
      tasks_done_today: tasks.filter((t) => t.done_at && dayKeySP(t.done_at) === today).length
    }
  };
}

function lucasTaskPayload(body = {}) {
  const priority = LUCAS_PRIORITIES.includes(body.priority) ? body.priority : 'media';
  const status = LUCAS_STATUSES.includes(body.status) ? body.status : 'aberta';
  return {
    title: String(body.title || '').trim(),
    notes: body.notes ? String(body.notes).trim() : null,
    priority,
    status,
    due_date: body.due_date ? String(body.due_date).slice(0, 10) : null
  };
}

export async function createLucasTask(body = {}) {
  const t = lucasTaskPayload(body);
  if (!t.title) throw new OrderError('Dê um nome para a missão.');
  const { rows } = await q(
    `INSERT INTO lucas_tasks (title, notes, priority, status, due_date, done_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [t.title, t.notes, t.priority, t.status, t.due_date, t.status === 'concluida' ? new Date() : null]
  );
  return rows[0];
}

export async function updateLucasTask(id, body = {}) {
  const { rows: current } = await q('SELECT * FROM lucas_tasks WHERE id = $1', [id]);
  if (!current.length) throw new OrderError('Missão não encontrada.', 404);
  const old = current[0];
  const t = lucasTaskPayload({
    title: body.title ?? old.title,
    notes: body.notes ?? old.notes,
    priority: body.priority ?? old.priority,
    status: body.status ?? old.status,
    due_date: body.due_date ?? old.due_date
  });
  if (!t.title) throw new OrderError('Dê um nome para a missão.');
  // done_at só muda quando a missão entra ou sai de concluída.
  let doneAt = old.done_at;
  if (t.status === 'concluida' && old.status !== 'concluida') doneAt = new Date();
  if (t.status !== 'concluida') doneAt = null;
  const { rows } = await q(
    `UPDATE lucas_tasks SET title = $2, notes = $3, priority = $4, status = $5, due_date = $6,
       done_at = $7, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, t.title, t.notes, t.priority, t.status, t.due_date, doneAt]
  );
  return rows[0];
}

export async function deleteLucasTask(id) {
  const { rows } = await q('DELETE FROM lucas_tasks WHERE id = $1 RETURNING id, title', [id]);
  return rows[0] || null;
}

function lucasRoutinePayload(body = {}) {
  const days = String(body.days ?? '0123456').replace(/[^0-6]/g, '');
  const time = String(body.time_of_day || '').trim();
  return {
    title: String(body.title || '').trim(),
    time_of_day: /^\d{2}:\d{2}$/.test(time) ? time : null,
    days: days || '0123456',
    active: body.active === 0 || body.active === false ? 0 : 1
  };
}

export async function createLucasRoutine(body = {}) {
  const r = lucasRoutinePayload(body);
  if (!r.title) throw new OrderError('Dê um nome para a rotina.');
  const { rows } = await q(
    'INSERT INTO lucas_routines (title, time_of_day, days, active) VALUES ($1, $2, $3, $4) RETURNING *',
    [r.title, r.time_of_day, r.days, r.active]
  );
  return rows[0];
}

export async function updateLucasRoutine(id, body = {}) {
  const { rows: current } = await q('SELECT * FROM lucas_routines WHERE id = $1', [id]);
  if (!current.length) throw new OrderError('Rotina não encontrada.', 404);
  const old = current[0];
  const r = lucasRoutinePayload({
    title: body.title ?? old.title,
    time_of_day: body.time_of_day ?? old.time_of_day,
    days: body.days ?? old.days,
    active: body.active ?? old.active
  });
  if (!r.title) throw new OrderError('Dê um nome para a rotina.');
  const { rows } = await q(
    `UPDATE lucas_routines SET title = $2, time_of_day = $3, days = $4, active = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, r.title, r.time_of_day, r.days, r.active]
  );
  return rows[0];
}

export async function deleteLucasRoutine(id) {
  await q('DELETE FROM lucas_routine_logs WHERE routine_id = $1', [id]);
  const { rows } = await q('DELETE FROM lucas_routines WHERE id = $1 RETURNING id, title', [id]);
  return rows[0] || null;
}

// Marca/desmarca a rotina num dia (padrão: hoje).
export async function checkLucasRoutine(id, { day, done } = {}) {
  const routineId = Number(id);
  const { rows: exists } = await q('SELECT id FROM lucas_routines WHERE id = $1', [routineId]);
  if (!exists.length) throw new OrderError('Rotina não encontrada.', 404);
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : dayKeySP(new Date());
  const isDone = done !== false;
  if (isDone) {
    await q(
      'INSERT INTO lucas_routine_logs (routine_id, day) VALUES ($1, $2) ON CONFLICT (routine_id, day) DO NOTHING',
      [routineId, key]
    );
  } else {
    await q('DELETE FROM lucas_routine_logs WHERE routine_id = $1 AND day = $2', [routineId, key]);
  }
  return { ok: true, id: routineId, day: key, done: isDone };
}

/* ------------------------------------------------------------------ Ano Um
   O ano de foco do Lucas: de 28/09/2026 a 28/09/2027. Contagem dos dias, mapa
   do ano (rotinas cumpridas + diário), metas do ano, juramento e uma carta
   lacrada que só abre quando o ano termina. */

export const LUCAS_YEAR_START = '2026-09-28';
export const LUCAS_YEAR_END = '2027-09-28';
export const LUCAS_GOAL_AREAS = ['corpo', 'mente', 'dinheiro', 'trabalho', 'relacoes', 'espirito', 'outro'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (key) => Date.parse(`${key}T12:00:00Z`);
const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000);
const addDays = (key, n) => new Date(dayMs(key) + n * 86400000).toISOString().slice(0, 10);

async function lucasYearRow() {
  await q(
    `INSERT INTO lucas_year (id, start_day, end_day) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING`,
    [LUCAS_YEAR_START, LUCAS_YEAR_END]
  );
  const { rows } = await q('SELECT * FROM lucas_year WHERE id = 1');
  return rows[0];
}

// Onde o Lucas está no ano: dia N de 365, quanto falta e em que ato (trimestre).
export function lucasYearClock(start, end, today) {
  const total = daysBetween(start, end);
  const elapsed = Math.min(Math.max(daysBetween(start, today), 0), total);
  const started = today >= start;
  const finished = today >= end;
  const dayNumber = started ? Math.min(elapsed + 1, total) : 0;
  return {
    start,
    end,
    today,
    total_days: total,
    day_number: dayNumber,
    // Dias inteiros que ainda faltam depois de hoje (hoje já está sendo vivido).
    days_left: Math.max(daysBetween(today, end) - 1, 0),
    days_to_start: started ? 0 : daysBetween(today, start),
    pct: total ? Math.round((elapsed / total) * 1000) / 10 : 0,
    week: started ? Math.min(Math.floor(elapsed / 7) + 1, Math.ceil(total / 7)) : 0,
    act: started ? Math.min(Math.floor((elapsed / total) * 4) + 1, 4) : 0,
    started,
    finished
  };
}

// Nota do dia (0–3) pela fatia das rotinas programadas que foram cumpridas —
// só conta rotinas que já existiam naquele dia.
function routineLevels(routines, logs, days) {
  const done = new Map();
  for (const log of logs) {
    if (!done.has(log.day)) done.set(log.day, new Set());
    done.get(log.day).add(log.routine_id);
  }
  const result = new Map();
  for (const day of days) {
    const weekday = String(new Date(`${day}T12:00:00Z`).getUTCDay());
    const scheduled = routines.filter(
      (r) => r.active && String(r.days || '').includes(weekday) && dayKeySP(r.created_at) <= day
    );
    const hits = scheduled.filter((r) => done.get(day)?.has(r.id)).length;
    const ratio = scheduled.length ? hits / scheduled.length : 0;
    result.set(day, {
      done: hits,
      total: scheduled.length,
      level: hits === 0 ? 0 : ratio < 0.5 ? 1 : ratio < 1 ? 2 : 3
    });
  }
  return result;
}

function publicGoal(g) {
  return { ...g, progress: Number(g.progress) || 0 };
}

export async function lucasYearOverview() {
  const today = dayKeySP(new Date());
  const year = await lucasYearRow();
  const clock = lucasYearClock(year.start_day, year.end_day, today);

  const { rows: goals } = await q(
    `SELECT * FROM lucas_goals ORDER BY CASE WHEN done_at IS NULL THEN 0 ELSE 1 END, progress DESC, id`
  );
  const { rows: journal } = await q(
    'SELECT day, mood, note FROM lucas_journal WHERE day >= $1 AND day < $2 ORDER BY day',
    [year.start_day, year.end_day]
  );
  const { rows: routines } = await q('SELECT id, days, active, created_at FROM lucas_routines');
  const { rows: logs } = await q(
    'SELECT routine_id, day FROM lucas_routine_logs WHERE day >= $1 AND day < $2',
    [year.start_day, year.end_day]
  );

  // Um item por dia do ano; os dias que ainda não chegaram vêm como "future".
  const lastLived = today < year.end_day ? today : addDays(year.end_day, -1);
  const lived = [];
  for (let d = year.start_day; d <= lastLived && d < year.end_day; d = addDays(d, 1)) lived.push(d);
  const levels = routineLevels(routines, logs, lived);
  const byDay = new Map(journal.map((j) => [j.day, j]));
  const days = [];
  for (let i = 0; i < clock.total_days; i++) {
    const day = addDays(year.start_day, i);
    const entry = byDay.get(day);
    const lvl = levels.get(day);
    days.push({
      day,
      future: day > today,
      level: lvl?.level || 0,
      routines_done: lvl?.done || 0,
      routines_total: lvl?.total || 0,
      mood: entry?.mood ?? null,
      has_note: Boolean(entry?.note)
    });
  }

  const moods = journal.map((j) => Number(j.mood)).filter((m) => m >= 1 && m <= 5);
  // Sequência do diário: dias seguidos com entrada, até hoje (hoje em aberto não quebra).
  let journalStreak = 0;
  for (let i = 0; ; i++) {
    const day = addDays(today, -i);
    if (day < year.start_day) break;
    if (byDay.has(day)) journalStreak += 1;
    else if (i > 0) break;
  }
  const openGoals = goals.filter((g) => !g.done_at);

  return {
    ...clock,
    vow: year.vow || '',
    letter_written: Boolean(year.letter),
    letter_at: year.letter_at,
    // A carta só é lida quando o ano acaba.
    letter: clock.finished ? year.letter || '' : null,
    goals: goals.map(publicGoal),
    days,
    today_entry: byDay.get(today) || null,
    stats: {
      journal_days: journal.length,
      journal_streak: journalStreak,
      mood_avg: moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null,
      full_days: days.filter((d) => d.level === 3).length,
      goals_total: goals.length,
      goals_done: goals.length - openGoals.length,
      goals_avg: goals.length
        ? Math.round(goals.reduce((a, g) => a + (Number(g.progress) || 0), 0) / goals.length)
        : 0
    }
  };
}

export async function updateLucasYear(body = {}) {
  const year = await lucasYearRow();
  const vow = body.vow !== undefined ? String(body.vow || '').trim().slice(0, 2000) || null : year.vow;
  let { letter } = year;
  let letterAt = year.letter_at;
  if (body.letter !== undefined) {
    const text = String(body.letter || '').trim().slice(0, 20000);
    if (!text) throw new OrderError('A carta está vazia.');
    letter = text;
    letterAt = new Date();
  }
  await q('UPDATE lucas_year SET vow = $1, letter = $2, letter_at = $3, updated_at = now() WHERE id = 1', [
    vow,
    letter,
    letterAt
  ]);
  return { ok: true, vow: vow || '', letter_written: Boolean(letter) };
}

function lucasGoalPayload(body = {}) {
  const progress = Math.round(Number(body.progress));
  return {
    title: String(body.title || '').trim(),
    area: LUCAS_GOAL_AREAS.includes(body.area) ? body.area : 'outro',
    why: body.why ? String(body.why).trim() : null,
    progress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 100) : 0
  };
}

export async function createLucasGoal(body = {}) {
  const g = lucasGoalPayload(body);
  if (!g.title) throw new OrderError('Dê um nome para a meta.');
  const { rows } = await q(
    `INSERT INTO lucas_goals (title, area, why, progress, done_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [g.title, g.area, g.why, g.progress, g.progress >= 100 ? new Date() : null]
  );
  return publicGoal(rows[0]);
}

export async function updateLucasGoal(id, body = {}) {
  const { rows: current } = await q('SELECT * FROM lucas_goals WHERE id = $1', [id]);
  if (!current.length) throw new OrderError('Meta não encontrada.', 404);
  const old = current[0];
  const g = lucasGoalPayload({
    title: body.title ?? old.title,
    area: body.area ?? old.area,
    why: body.why ?? old.why,
    progress: body.progress ?? old.progress
  });
  if (!g.title) throw new OrderError('Dê um nome para a meta.');
  // Chegou a 100% = cumprida; se voltar, reabre.
  let doneAt = old.done_at;
  if (g.progress >= 100 && !old.done_at) doneAt = new Date();
  if (g.progress < 100) doneAt = null;
  const { rows } = await q(
    `UPDATE lucas_goals SET title = $2, area = $3, why = $4, progress = $5, done_at = $6, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, g.title, g.area, g.why, g.progress, doneAt]
  );
  return publicGoal(rows[0]);
}

export async function deleteLucasGoal(id) {
  const { rows } = await q('DELETE FROM lucas_goals WHERE id = $1 RETURNING id, title', [id]);
  return rows[0] || null;
}

// Grava a entrada do diário de um dia (padrão: hoje). Sem nota e sem texto, apaga.
export async function saveLucasJournal({ day, mood, note } = {}) {
  const today = dayKeySP(new Date());
  const key = DAY_RE.test(String(day || '')) ? String(day) : today;
  if (key > today) throw new OrderError('Ainda não dá para escrever sobre um dia que não chegou.');
  const m = Number(mood);
  const cleanMood = Number.isInteger(m) && m >= 1 && m <= 5 ? m : null;
  const text = note ? String(note).trim().slice(0, 5000) : '';
  if (!cleanMood && !text) {
    await q('DELETE FROM lucas_journal WHERE day = $1', [key]);
    return { day: key, mood: null, note: '', removed: true };
  }
  const { rows } = await q(
    `INSERT INTO lucas_journal (day, mood, note, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (day) DO UPDATE SET mood = EXCLUDED.mood, note = EXCLUDED.note, updated_at = now()
     RETURNING day, mood, note`,
    [key, cleanMood, text || null]
  );
  return rows[0];
}

export async function getLucasJournal(day) {
  if (!DAY_RE.test(String(day || ''))) throw new OrderError('Dia deve vir como AAAA-MM-DD.');
  const { rows } = await q('SELECT day, mood, note FROM lucas_journal WHERE day = $1', [day]);
  return rows[0] || { day, mood: null, note: '' };
}
