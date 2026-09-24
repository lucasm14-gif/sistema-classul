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
