// Aplica por cima do último snapshot as alterações feitas na web que o iPhone
// ainda não aplicou, para a tela mostrar o resultado na hora. Trabalha no snapshot
// cru (datas em segundos, dias como "yyyy-MM-dd").

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromKey = (k) => {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const secOf = (k) => Math.floor(fromKey(k).getTime() / 1000);
const keyOfSec = (s) => dayKey(new Date(Number(s) * 1000));

export function applyPending(raw, actions) {
  if (!raw) return raw;
  const pend = (actions || []).filter((a) => !a.applied_at);
  if (!pend.length) return raw;
  const s = structuredClone(raw);
  s.routine ||= [];
  s.habits ||= [];
  s.meals ||= [];
  s.ideas ||= [];
  const today = s.today || dayKey();

  const dayOf = (k) => {
    let d = s.days.find((x) => keyOfSec(x.date) === k);
    if (!d) {
      d = { date: secOf(k), score: 0, waterML: 0, kcal: 0, protein: 0, sleepMin: 0, focusMin: 0, cardioMin: 0, cardioKcal: 0, mood: 0, workout: false, habitsDone: 0, habitsTotal: 0, steps: 0 };
      s.days.push(d);
      s.days.sort((a, b) => a.date - b.date);
    }
    return d;
  };
  const toggleDay = (list, k, done) => {
    const set = new Set(list || []);
    if (done ?? !set.has(k)) set.add(k);
    else set.delete(k);
    return [...set].sort();
  };
  const upsert = (list, a, make, patch) => {
    const id = a.payload.id;
    const found = id && list.find((x) => x.id === id);
    if (found) Object.assign(found, patch(found));
    else if (!id) list.push({ ...make(), ...patch({}), id: `pending:${a.id}` });
  };

  for (const a of pend) {
    const p = a.payload || {};
    const k = p.day || today;
    switch (a.type) {
      case 'routine.check': {
        const it = s.routine.find((x) => x.id === p.id);
        if (it) it.doneDays = toggleDay(it.doneDays, k, p.done);
        break;
      }
      case 'routine.save':
        upsert(
          s.routine,
          a,
          () => ({ title: '', symbol: 'circle', minutes: 480, duration: 30, weekdays: [1, 2, 3, 4, 5, 6, 7], note: '', notify: true, doneDays: [] }),
          (o) => ({
            title: p.title ?? o.title,
            minutes: p.minutes ?? o.minutes,
            duration: p.duration ?? o.duration,
            weekdays: p.weekdays ?? o.weekdays,
            note: p.note ?? o.note,
            notify: p.notify ?? o.notify,
            fallbackMinutes: p.fallbackMinutes === undefined ? o.fallbackMinutes : p.fallbackMinutes
          })
        );
        s.routine.sort((x, y) => x.minutes - y.minutes);
        break;
      case 'routine.delete':
        s.routine = s.routine.filter((x) => x.id !== p.id);
        break;
      case 'habit.check': {
        const h = s.habits.find((x) => x.id === p.id);
        if (h) h.doneDays = toggleDay(h.doneDays, k, p.done);
        break;
      }
      case 'habit.save':
        upsert(
          s.habits,
          a,
          () => ({ name: '', symbol: 'checkmark', weekdays: [1, 2, 3, 4, 5, 6, 7], archived: false, streak: 0, doneDays: [] }),
          (o) => ({ name: p.name ?? o.name, weekdays: p.weekdays ?? o.weekdays, archived: p.archived ?? o.archived })
        );
        break;
      case 'habit.delete':
        s.habits = s.habits.filter((x) => x.id !== p.id);
        break;
      case 'goal.save':
        upsert(
          s.objectives,
          a,
          () => ({ title: '', area: 'Corpo', progress: 0, done: false, why: '' }),
          (o) => {
            const progress = p.progress ?? o.progress ?? 0;
            const done = p.done ?? o.done ?? false;
            return {
              title: p.title ?? o.title,
              area: p.area || o.area,
              why: p.why ?? o.why,
              deadline: p.deadline === null ? null : p.deadline ? secOf(p.deadline) : o.deadline,
              progress: done ? 1 : progress,
              done: done || progress >= 1
            };
          }
        );
        break;
      case 'goal.delete':
        s.objectives = s.objectives.filter((x) => x.id !== p.id);
        break;
      case 'idea.add':
        s.ideas.push({ id: `pending:${a.id}`, date: Math.floor(new Date(a.created_at || Date.now()).getTime() / 1000), text: p.text });
        break;
      case 'idea.delete':
        s.ideas = s.ideas.filter((x) => x.id !== p.id);
        break;
      case 'water.add':
        dayOf(k).waterML += Number(p.ml) || 0;
        break;
      case 'weight.add':
        s.weights.push({ date: secOf(k) + 43200, kg: Number(p.kg), bodyFat: Number(p.bodyFat) || 0, waistCm: Number(p.waistCm) || 0 });
        s.weights.sort((x, y) => x.date - y.date);
        break;
      case 'meal.add': {
        const m = { id: `pending:${a.id}`, date: secOf(k) + 43200, name: p.name, type: p.type || 'Lanche', kcal: +p.kcal || 0, protein: +p.protein || 0, carbs: +p.carbs || 0, fat: +p.fat || 0 };
        s.meals.push(m);
        const d = dayOf(k);
        d.kcal += m.kcal;
        d.protein += m.protein;
        break;
      }
      case 'meal.delete': {
        const m = s.meals.find((x) => x.id === p.id);
        if (m) {
          s.meals = s.meals.filter((x) => x !== m);
          const d = dayOf(keyOfSec(m.date));
          d.kcal = Math.max(0, d.kcal - m.kcal);
          d.protein = Math.max(0, d.protein - m.protein);
        }
        break;
      }
      case 'mood.add':
        dayOf(k).mood = Number(p.mood) || 0;
        break;
      case 'sleep.add':
        dayOf(k).sleepMin += Number(p.minutes) || 0;
        break;
      case 'focus.add':
        dayOf(k).focusMin += Number(p.minutes) || 0;
        break;
      case 'cardio.add': {
        const d = dayOf(k);
        d.cardioMin += Number(p.minutes) || 0;
        d.cardioKcal += Number(p.kcal) || 0;
        break;
      }
      case 'settings.save':
        s.goals = { ...s.goals, ...Object.fromEntries(['waterML', 'kcal', 'protein', 'sleepMin', 'steps', 'weightKg'].filter((x) => p[x] != null).map((x) => [x, Number(p[x])])) };
        if (p.userName != null) s.userName = p.userName;
        break;
      default:
        break;
    }
  }
  return s;
}

// Texto curto de cada alteração, para a lista "esperando o iPhone".
export function describeAction(a, raw) {
  const p = a.payload || {};
  const nameOf = (list, key = 'title') => (raw?.[list] || []).find((x) => x.id === p.id)?.[key] || '';
  switch (a.type) {
    case 'routine.check': return `${p.done === false ? 'Desmarcar' : 'Marcar'} rotina: ${nameOf('routine')}`;
    case 'routine.save': return `${p.id ? 'Editar' : 'Novo'} item da rotina: ${p.title}`;
    case 'routine.delete': return `Apagar da rotina: ${nameOf('routine')}`;
    case 'habit.check': return `${p.done === false ? 'Desmarcar' : 'Marcar'} hábito: ${nameOf('habits', 'name')}`;
    case 'habit.save': return `${p.id ? 'Editar' : 'Novo'} hábito: ${p.name}`;
    case 'habit.delete': return `Apagar hábito: ${nameOf('habits', 'name')}`;
    case 'goal.save': return `${p.id ? 'Editar' : 'Novo'} objetivo: ${p.title}`;
    case 'goal.delete': return `Apagar objetivo: ${nameOf('objectives')}`;
    case 'idea.add': return `Nova ideia: ${String(p.text).slice(0, 50)}`;
    case 'idea.delete': return 'Apagar ideia';
    case 'water.add': return `Água: ${p.ml > 0 ? '+' : ''}${p.ml} ml`;
    case 'weight.add': return `Peso: ${p.kg} kg`;
    case 'meal.add': return `Refeição: ${p.name} (${p.kcal || 0} kcal)`;
    case 'meal.delete': return 'Apagar refeição';
    case 'mood.add': return `Humor: ${p.mood}/5`;
    case 'sleep.add': return `Sono: ${Math.floor(p.minutes / 60)}h${String(p.minutes % 60).padStart(2, '0')}`;
    case 'focus.add': return `Foco: ${p.minutes} min`;
    case 'cardio.add': return `Cardio: ${p.kind} ${p.minutes} min`;
    case 'settings.save': return 'Metas diárias';
    default: return a.type;
  }
}
