// Números do painel do Ideal, iguais aos do app do Mac (IdealMac/Analytics.swift),
// calculados "até" um dia escolhido para a linha do tempo poder voltar no tempo.
// Datas do snapshot vêm em segundos desde 1970 (início do dia no fuso do iPhone).

export const GROUPS = [
  ['chest', 'Peito'],
  ['back', 'Costas'],
  ['shoulders', 'Ombros'],
  ['arms', 'Braços'],
  ['core', 'Core'],
  ['legs', 'Pernas']
];
const GROWTH_TARGET = 140;
const DAY = 86400000;

export const toDate = (sec) => new Date(Number(sec) * 1000);
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7)); // segunda
const LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

// Snapshot cru → datas como Date, listas em ordem.
export function prepare(raw) {
  if (!raw) return null;
  const days = (raw.days || []).map((d) => ({ ...d, date: startOfDay(toDate(d.date)) })).sort((a, b) => a.date - b.date);
  return {
    ...raw,
    generatedAt: toDate(raw.generatedAt),
    startDate: toDate(raw.startDate),
    days,
    sessions: (raw.sessions || []).map((s) => ({ ...s, date: toDate(s.date) })).sort((a, b) => a.date - b.date),
    weights: (raw.weights || []).map((w) => ({ ...w, date: toDate(w.date) })).sort((a, b) => a.date - b.date),
    objectives: (raw.objectives || []).map((o) => ({ ...o, deadline: o.deadline != null ? toDate(o.deadline) : null })),
    ideas: (raw.ideas || []).map((i) => ({ ...i, date: toDate(i.date) })).sort((a, b) => b.date - a.date)
  };
}

export function analytics(snap, asOfInput) {
  const asOf = startOfDay(asOfInput || snap.days.at(-1)?.date || new Date());
  const end = addDays(asOf, 1);
  const sessionsSoFar = snap.sessions.filter((s) => s.date < end);
  const day = [...snap.days].reverse().find((d) => sameDay(d.date, asOf)) || null;
  const daysBack = (n, from = asOf) => {
    const to = addDays(from, 1);
    const start = addDays(from, -(n - 1));
    return snap.days.filter((d) => d.date >= start && d.date < to);
  };
  const sets = (sessions, g) => sessions.reduce((sum, s) => sum + s.exercises.filter((e) => e.group === g).reduce((x, e) => x + e.sets, 0), 0);
  const average = (list, key) => (list.length ? list.reduce((s, d) => s + key(d), 0) / list.length : 0);

  const heat = (g) => {
    const load = sessionsSoFar
      .filter((s) => s.date >= addDays(asOf, -9))
      .reduce((sum, s) => sum + sets([s], g) * 0.5 ** ((end - s.date) / DAY / 2), 0);
    return Math.min(load / 7, 1);
  };
  const growth = (g) => Math.min(sets(sessionsSoFar, g) / GROWTH_TARGET, 1);

  const weekStart = startOfWeek(asOf);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const found = snap.days.find((x) => sameDay(x.date, d));
    return { letter: LETTERS[d.getDay()], score: d <= asOf ? found?.score ?? null : null, current: sameDay(d, asOf), date: d };
  });

  const byName = new Map();
  for (const s of sessionsSoFar) for (const e of s.exercises) byName.set(e.name, [...(byName.get(e.name) || []), e]);
  const records = [...byName.entries()]
    .map(([name, list]) => {
      const loaded = list.map((e) => e.topWeight).filter((w) => w > 0);
      const best = loaded.length ? Math.max(...loaded) : 0;
      return { name, group: list[0].group, best, gain: best - (loaded[0] || 0), sessions: list.length };
    })
    .sort((a, b) => b.gain - a.gain || b.best - a.best || b.sessions - a.sessions);

  const volumeBetween = (from, to) => sessionsSoFar.filter((s) => s.date >= from && s.date < to).reduce((x, s) => x + s.volume, 0);

  const change = (key) => {
    if (!day) return 0;
    const prev = daysBack(7, addDays(asOf, -1)).map(key).filter((v) => v > 0);
    if (!prev.length) return 0;
    const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
    return avg ? ((key(day) - avg) / avg) * 100 : 0;
  };

  let streak = 0;
  let cursor = (day?.score ?? 0) < 0.8 ? addDays(asOf, -1) : asOf;
  for (;;) {
    const s = snap.days.find((x) => sameDay(x.date, cursor));
    if (!s || s.score < 0.8) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    asOf,
    day,
    sessionsSoFar,
    heat,
    growth,
    week,
    weekAverage: average(daysBack(7), (d) => d.score),
    lastWeekAverage: average(daysBack(7, addDays(asOf, -7)), (d) => d.score),
    records,
    weights: snap.weights.filter((w) => w.date < end),
    workoutsThisWeek: daysBack(7).filter((d) => d.workout).length,
    volume7d: volumeBetween(addDays(asOf, -6), end),
    volumePrev7d: volumeBetween(addDays(asOf, -13), addDays(asOf, -6)),
    change,
    streak
  };
}

// ---------------------------------------------------------------- formatos

export const fmt = {
  duration: (min) => {
    const m = Math.round(Number(min) || 0);
    if (!m) return '0h';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r}min`;
  },
  liters: (ml) => `${((Number(ml) || 0) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L`,
  kg: (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`,
  tons: (v) => {
    const n = Number(v) || 0;
    return n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t` : `${Math.round(n)} kg`;
  },
  int: (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR'),
  dayMonth: (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '').toUpperCase(),
  weekday: (d) => d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase(),
  time: (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  ago: (d, now = Date.now()) => {
    const s = Math.max(0, Math.round((now - d) / 1000));
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    const n = Math.floor(s / 86400);
    return `há ${n} ${n === 1 ? 'dia' : 'dias'}`;
  }
};
