import React, { useState } from 'react';
import { Check, Droplet, Trash2, Plus } from 'lucide-react';
import { Panel, Field, minToTime, weekdayOf, num } from '../ui';
import { dayKey, fromKey } from '../pending';
import { fmt } from '../analytics';

const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const MEAL_TYPES = ['Café da manhã', 'Almoço', 'Lanche', 'Jantar', 'Ceia'];
const CARDIO = ['Corrida', 'Caminhada', 'Bicicleta', 'Natação', 'Corda', 'Escada', 'Elíptico', 'Luta', 'Esporte', 'Outro'];

function Meter({ value, goal, label, text }) {
  const p = goal > 0 ? Math.min(value / goal, 1) : 0;
  return (
    <div className="idl-goalbar">
      <div className="idl-goalbar-top">
        <span>{label}</span>
        <b className={p >= 1 ? 'good' : ''}>{text}</b>
      </div>
      <div className="idl-meter">
        <i style={{ width: `${Math.max(2, p * 100)}%` }} className={p >= 1 ? 'good' : ''} />
      </div>
    </div>
  );
}

export function CheckRow({ done, title, sub, onToggle, right }) {
  return (
    <li className={`idl-check ${done ? 'done' : ''}`}>
      <button className="idl-checkbox" onClick={onToggle} aria-pressed={done} aria-label={done ? 'Desmarcar' : 'Marcar'}>
        {done && <Check size={14} strokeWidth={3} />}
      </button>
      <div className="idl-check-text">
        <p>{title}</p>
        {sub && <small>{sub}</small>}
      </div>
      {right}
    </li>
  );
}

function QuickForms({ act, todayKey }) {
  const [tab, setTab] = useState('peso');
  const [f, setF] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const done = () => setF({});

  const forms = {
    peso: (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (num(f.kg) <= 20) return;
          act('weight.add', { day: todayKey, kg: num(f.kg), bodyFat: num(f.bf), waistCm: num(f.waist) });
          done();
        }}
      >
        <div className="idl-row3">
          <Field label="Peso (kg)"><input className="idl-input" inputMode="decimal" value={f.kg || ''} onChange={set('kg')} placeholder="82,4" /></Field>
          <Field label="Gordura %"><input className="idl-input" inputMode="decimal" value={f.bf || ''} onChange={set('bf')} placeholder="opcional" /></Field>
          <Field label="Cintura cm"><input className="idl-input" inputMode="decimal" value={f.waist || ''} onChange={set('waist')} placeholder="opcional" /></Field>
        </div>
        <button className="idl-btn primary">Registrar peso</button>
      </form>
    ),
    refeicao: (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!String(f.name || '').trim()) return;
          act('meal.add', { day: todayKey, name: f.name.trim(), type: f.type || 'Almoço', kcal: num(f.kcal), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat) });
          done();
        }}
      >
        <div className="idl-row2">
          <Field label="O que comeu"><input className="idl-input" value={f.name || ''} onChange={set('name')} placeholder="Frango com arroz" autoFocus /></Field>
          <Field label="Tipo">
            <select className="idl-input" value={f.type || 'Almoço'} onChange={set('type')}>
              {MEAL_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="idl-row4">
          <Field label="kcal"><input className="idl-input" inputMode="numeric" value={f.kcal || ''} onChange={set('kcal')} /></Field>
          <Field label="Proteína g"><input className="idl-input" inputMode="numeric" value={f.protein || ''} onChange={set('protein')} /></Field>
          <Field label="Carbo g"><input className="idl-input" inputMode="numeric" value={f.carbs || ''} onChange={set('carbs')} /></Field>
          <Field label="Gordura g"><input className="idl-input" inputMode="numeric" value={f.fat || ''} onChange={set('fat')} /></Field>
        </div>
        <button className="idl-btn primary">Registrar refeição</button>
      </form>
    ),
    sono: (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const minutes = Math.round(num(f.h) * 60 + num(f.m));
          if (minutes <= 0) return;
          const [wh, wm] = String(f.wake || '07:00').split(':').map(Number);
          act('sleep.add', { day: todayKey, minutes, wake: (wh || 0) * 60 + (wm || 0), quality: Number(f.q || 3) });
          done();
        }}
      >
        <div className="idl-row4">
          <Field label="Horas"><input className="idl-input" inputMode="numeric" value={f.h || ''} onChange={set('h')} placeholder="7" autoFocus /></Field>
          <Field label="Minutos"><input className="idl-input" inputMode="numeric" value={f.m || ''} onChange={set('m')} placeholder="30" /></Field>
          <Field label="Acordou"><input className="idl-input" type="time" value={f.wake || '07:00'} onChange={set('wake')} /></Field>
          <Field label="Qualidade 1–5"><input className="idl-input" type="number" min="1" max="5" value={f.q || 3} onChange={set('q')} /></Field>
        </div>
        <button className="idl-btn primary">Registrar sono</button>
      </form>
    ),
    foco: (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (num(f.min) <= 0) return;
          act('focus.add', { day: todayKey, minutes: Math.round(num(f.min)), label: f.label || '' });
          done();
        }}
      >
        <div className="idl-row2">
          <Field label="Minutos"><input className="idl-input" inputMode="numeric" value={f.min || ''} onChange={set('min')} placeholder="50" autoFocus /></Field>
          <Field label="No quê"><input className="idl-input" value={f.label || ''} onChange={set('label')} placeholder="opcional" /></Field>
        </div>
        <button className="idl-btn primary">Registrar foco</button>
      </form>
    ),
    cardio: (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (num(f.min) <= 0) return;
          act('cardio.add', { day: todayKey, kind: f.kind || 'Corrida', minutes: Math.round(num(f.min)), distanceKm: num(f.km), kcal: Math.round(num(f.kcal)) });
          done();
        }}
      >
        <div className="idl-row4">
          <Field label="Tipo">
            <select className="idl-input" value={f.kind || 'Corrida'} onChange={set('kind')}>
              {CARDIO.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Minutos"><input className="idl-input" inputMode="numeric" value={f.min || ''} onChange={set('min')} /></Field>
          <Field label="Km"><input className="idl-input" inputMode="decimal" value={f.km || ''} onChange={set('km')} placeholder="opcional" /></Field>
          <Field label="kcal"><input className="idl-input" inputMode="numeric" value={f.kcal || ''} onChange={set('kcal')} placeholder="opcional" /></Field>
        </div>
        <button className="idl-btn primary">Registrar cardio</button>
      </form>
    )
  };
  const TABS = [['peso', 'Peso'], ['refeicao', 'Refeição'], ['sono', 'Sono'], ['foco', 'Foco'], ['cardio', 'Cardio']];
  return (
    <Panel
      title="Registrar"
      right={
        <div className="idl-seg">
          {TABS.map(([id, l]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setF({}); }}>
              {l}
            </button>
          ))}
        </div>
      }
    >
      <div className="idl-form">{forms[tab]}</div>
    </Panel>
  );
}

export default function Today({ raw, act }) {
  const todayKey = raw.today || dayKey();
  const today = fromKey(todayKey);
  const wd = weekdayOf(today);
  const day = raw.days.find((d) => dayKey(new Date(d.date * 1000)) === todayKey) || {};
  const g = raw.goals || {};
  const routine = (raw.routine || []).filter((r) => r.weekdays.includes(wd)).sort((a, b) => a.minutes - b.minutes);
  const habits = (raw.habits || []).filter((h) => !h.archived && h.weekdays.includes(wd));
  const meals = (raw.meals || []).filter((m) => dayKey(new Date(m.date * 1000)) === todayKey);
  const [ml, setMl] = useState('');
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const rDone = routine.filter((r) => r.doneDays.includes(todayKey)).length;
  const hDone = habits.filter((h) => h.doneDays.includes(todayKey)).length;

  return (
    <div className="idl-today">
      <div className="idl-today-head">
        <p className="idl-kicker">{fmt.weekday(today)} · {fmt.dayMonth(today)}</p>
        <h2>{raw.userName ? `Bora, ${raw.userName}.` : 'Hoje'}</h2>
        <p className="idl-mono">
          Rotina {rDone}/{routine.length} · Hábitos {hDone}/{habits.length}
        </p>
      </div>

      <div className="idl-today-grid">
        <Panel title="Rotina de hoje" right={<span className="idl-mono">{rDone}/{routine.length}</span>}>
          {!routine.length && <p className="idl-empty">Nada na rotina para hoje. Crie itens na aba Rotina.</p>}
          <ul className="idl-checks">
            {routine.map((r) => {
              const done = r.doneDays.includes(todayKey);
              const now = !done && nowMin >= r.minutes && nowMin < r.minutes + r.duration;
              return (
                <CheckRow
                  key={r.id}
                  done={done}
                  title={r.title}
                  sub={`${minToTime(r.minutes)} · ${r.duration} min${r.note ? ` · ${r.note}` : ''}`}
                  onToggle={() => act('routine.check', { id: r.id, day: todayKey, done: !done })}
                  right={now ? <span className="idl-now">agora</span> : null}
                />
              );
            })}
          </ul>
        </Panel>

        <div className="idl-col">
          <Panel title="Hábitos" right={<span className="idl-mono">{hDone}/{habits.length}</span>}>
            {!habits.length && <p className="idl-empty">Nenhum hábito para hoje.</p>}
            <ul className="idl-checks">
              {habits.map((h) => {
                const done = h.doneDays.includes(todayKey);
                return (
                  <CheckRow
                    key={h.id}
                    done={done}
                    title={h.name}
                    sub={h.streak ? `${h.streak} ${h.streak === 1 ? 'dia' : 'dias'} seguidos` : null}
                    onToggle={() => act('habit.check', { id: h.id, day: todayKey, done: !done })}
                  />
                );
              })}
            </ul>
          </Panel>

          <Panel title="Água" right={<span className="idl-mono">{fmt.liters(day.waterML)} / {fmt.liters(g.waterML)}</span>}>
            <Meter value={day.waterML || 0} goal={g.waterML || 3000} label="" text={`${Math.round(((day.waterML || 0) / Math.max(g.waterML || 1, 1)) * 100)}%`} />
            <div className="idl-water">
              {[250, 500, 750].map((v) => (
                <button key={v} className="idl-btn" onClick={() => act('water.add', { day: todayKey, ml: v })}>
                  <Droplet size={14} /> +{v} ml
                </button>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (num(ml)) act('water.add', { day: todayKey, ml: Math.round(num(ml)) });
                  setMl('');
                }}
              >
                <input className="idl-input" inputMode="numeric" value={ml} onChange={(e) => setMl(e.target.value)} placeholder="outro (ml)" />
              </form>
              {(day.waterML || 0) >= 250 && (
                <button className="idl-link" onClick={() => act('water.add', { day: todayKey, ml: -250 })}>
                  desfazer 250 ml
                </button>
              )}
            </div>
          </Panel>

          <Panel title="Como você está?">
            <div className="idl-moods">
              {MOODS.map((m, i) => (
                <button key={m} className={day.mood === i + 1 ? 'on' : ''} onClick={() => act('mood.add', { day: todayKey, mood: i + 1 })}>
                  {m}
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <div className="idl-col">
          <Panel title="Metas do dia">
            <Meter label="Calorias" value={day.kcal || 0} goal={g.kcal} text={`${fmt.int(day.kcal)} / ${fmt.int(g.kcal)}`} />
            <Meter label="Proteína" value={day.protein || 0} goal={g.protein} text={`${fmt.int(day.protein)} / ${fmt.int(g.protein)} g`} />
            <Meter label="Sono" value={day.sleepMin || 0} goal={g.sleepMin} text={`${fmt.duration(day.sleepMin)} / ${fmt.duration(g.sleepMin)}`} />
            <Meter label="Passos" value={day.steps || 0} goal={g.steps || 10000} text={`${fmt.int(day.steps)} / ${fmt.int(g.steps || 10000)}`} />
            <Meter label="Foco" value={day.focusMin || 0} goal={120} text={fmt.duration(day.focusMin)} />
          </Panel>

          <Panel title="Refeições de hoje" right={<span className="idl-mono">{meals.length}</span>}>
            {!meals.length && <p className="idl-empty">Nenhuma refeição registrada hoje.</p>}
            <ul className="idl-list">
              {meals.map((m) => (
                <li key={m.id}>
                  <div>
                    <p>{m.name}</p>
                    <small>{m.type} · {m.kcal} kcal · {m.protein} g prot</small>
                  </div>
                  {!String(m.id).startsWith('pending:') && (
                    <button className="idl-icon sm" title="Apagar" onClick={() => window.confirm(`Apagar "${m.name}"?`) && act('meal.delete', { id: m.id })}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <QuickForms act={act} todayKey={todayKey} />
      <p className="idl-note center">
        <Plus size={11} /> Tudo o que você marca aqui vai para o iPhone na próxima vez que o Ideal abrir lá.
      </p>
    </div>
  );
}
