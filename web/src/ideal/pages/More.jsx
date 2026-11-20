import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Panel, Modal, Field, describeDays, num } from '../ui';
import { dayKey } from '../pending';
import { fmt, GROUPS, startOfDay } from '../analytics';

const AREAS = ['Corpo', 'Mente', 'Carreira', 'Finanças', 'Relações', 'Espírito', 'Outro'];
const isPending = (id) => String(id || '').startsWith('pending:');
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

/* ------------------------------------------------------------------ treino */

export function Workout({ snap, raw }) {
  const plans = raw.plans || [];
  const sessions = [...snap.sessions].reverse().slice(0, 20);
  const label = Object.fromEntries(GROUPS);
  return (
    <div className="idl-stack">
      <Panel title="Planos de treino" right={<span className="idl-mono">{plans.length}</span>}>
        {!plans.length && <p className="idl-empty">Crie planos no iPhone (Treino). Aqui eles aparecem para consulta.</p>}
        <div className="idl-plans">
          {plans.map((p) => (
            <article key={p.id} className="idl-plan">
              <header>
                <h4>{p.name}</h4>
                <small>{p.focus ? `${p.focus} · ` : ''}{p.weekdays.length ? describeDays(p.weekdays) : 'sem dia fixo'}</small>
              </header>
              <table>
                <tbody>
                  {p.exercises.map((e, i) => (
                    <tr key={i}>
                      <td>{e.name}</td>
                      <td className="idl-mono">{e.sets}×{e.reps}</td>
                      <td className="idl-mono">{e.weight > 0 ? fmt.kg(e.weight) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="Últimos treinos" right={<span className="idl-mono">{snap.sessions.length}</span>}>
        {!sessions.length && <p className="idl-empty">Os treinos finalizados no iPhone aparecem aqui.</p>}
        <ul className="idl-sessions">
          {sessions.map((s, i) => (
            <li key={i}>
              <div className="idl-session-head">
                <b>{s.name}</b>
                <small>{fmt.weekday(s.date)} {fmt.dayMonth(s.date)} · {s.minutes} min · {fmt.tons(s.volume)}</small>
              </div>
              <p>
                {s.exercises.map((e) => `${e.name} ${e.sets}×${e.topWeight > 0 ? ` ${fmt.kg(e.topWeight)}` : ''}`).join(' · ')}
              </p>
              <div className="idl-tags">
                {[...new Set(s.exercises.map((e) => e.group))].filter((g) => label[g]).map((g) => <span key={g}>{label[g]}</span>)}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <p className="idl-note center">Para registrar um treino de academia, use o iPhone (cronômetro e séries). Cardio dá para registrar na aba Hoje.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ objetivos */

function GoalEditor({ goal, onSave, onDelete, onClose }) {
  const toKey = (d) => (d ? dayKey(d instanceof Date ? d : new Date(d * 1000)) : '');
  const [f, setF] = useState(() => ({
    title: goal?.title || '',
    area: goal?.area || 'Corpo',
    why: goal?.why || '',
    deadline: toKey(goal?.deadline),
    progress: Math.round((goal?.progress || 0) * 100),
    done: goal?.done || false
  }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <Modal
      title={goal ? 'Editar objetivo' : 'Novo objetivo'}
      onClose={onClose}
      footer={
        <>
          {goal && !isPending(goal.id) && <button className="idl-btn danger" onClick={onDelete}>Apagar</button>}
          <span style={{ flex: 1 }} />
          <button className="idl-btn" onClick={onClose}>Cancelar</button>
          <button
            className="idl-btn primary"
            disabled={!f.title.trim()}
            onClick={() => onSave({ title: f.title.trim(), area: f.area, why: f.why.trim(), deadline: f.deadline || null, progress: Number(f.progress) / 100, done: f.done })}
          >
            Salvar
          </button>
        </>
      }
    >
      <Field label="Objetivo"><input className="idl-input" value={f.title} onChange={set('title')} placeholder="Correr 10 km" autoFocus /></Field>
      <div className="idl-row2">
        <Field label="Área">
          <select className="idl-input" value={f.area} onChange={set('area')}>
            {AREAS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Prazo (opcional)"><input className="idl-input" type="date" value={f.deadline} onChange={set('deadline')} /></Field>
      </div>
      <Field label="Por quê"><textarea className="idl-input" rows={3} value={f.why} onChange={set('why')} placeholder="O que muda na sua vida quando conseguir" /></Field>
      <Field label={`Progresso: ${f.done ? 100 : f.progress}%`}>
        <input type="range" min="0" max="100" step="5" value={f.done ? 100 : f.progress} disabled={f.done} onChange={set('progress')} className="idl-range" />
      </Field>
      <label className="idl-toggle">
        <input type="checkbox" checked={f.done} onChange={set('done')} /> Conquistado
      </label>
      <p className="idl-note">A foto do objetivo continua sendo escolhida no iPhone.</p>
    </Modal>
  );
}

function GoalCard({ goal, onClick }) {
  const days = goal.deadline ? Math.ceil((startOfDay(goal.deadline) - startOfDay(new Date())) / 86400000) : null;
  return (
    <button
      className={`idl-goal ${goal.done ? 'done' : ''} ${isPending(goal.id) ? 'pending' : ''}`}
      style={goal.photo ? { '--photo': `url(data:image/jpeg;base64,${goal.photo})` } : undefined}
      onClick={onClick}
    >
      <div className="idl-goal-top">
        <span>{String(goal.area || '').toUpperCase()}</span>
        {goal.done ? <span className="good">CONQUISTADO</span> : days != null && <span className={days < 0 ? 'bad' : ''}>{days >= 0 ? `${days} DIAS` : 'ATRASADO'}</span>}
      </div>
      <h4>{goal.title}</h4>
      {goal.why && (
        <div className="idl-goal-why">
          <small>POR QUÊ</small>
          <p>{goal.why}</p>
        </div>
      )}
      <div className="idl-goal-progress">
        <div className="idl-meter">
          <i style={{ width: `${Math.round((goal.done ? 1 : goal.progress || 0) * 100)}%` }} className={goal.done ? 'good' : ''} />
        </div>
        <b>{pct(goal.done ? 1 : goal.progress)}</b>
      </div>
    </button>
  );
}

export function Goals({ snap, act }) {
  const [editing, setEditing] = useState(null); // {goal?}
  const active = snap.objectives.filter((o) => !o.done);
  const done = snap.objectives.filter((o) => o.done);
  return (
    <div className="idl-goals-page">
      <div className="idl-page-head">
        <div>
          <h2>Lembre por que você começou</h2>
          <p className="idl-mono muted">{active.length} ativos · {done.length} conquistados</p>
        </div>
        <button className="idl-btn primary" onClick={() => setEditing({})}>
          <Plus size={15} /> Novo objetivo
        </button>
      </div>
      {!snap.objectives.length && <p className="idl-empty center">Nenhum objetivo ainda.</p>}
      <div className="idl-goals">
        {[...active, ...done].map((g, i) => (
          <GoalCard key={g.id || `${g.title}-${i}`} goal={g} onClick={() => g.id && setEditing({ goal: g })} />
        ))}
      </div>
      {snap.objectives.some((g) => !g.id) && <p className="idl-note">Atualize o app do iPhone para editar os objetivos antigos por aqui.</p>}
      {editing && (
        <GoalEditor
          goal={editing.goal}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            act('goal.save', editing.goal ? { id: editing.goal.id, ...data } : data);
            setEditing(null);
          }}
          onDelete={() => {
            if (window.confirm(`Apagar o objetivo "${editing.goal.title}"?`)) {
              act('goal.delete', { id: editing.goal.id });
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ideias */

export function Ideas({ snap, act }) {
  const [text, setText] = useState('');
  const groups = useMemo(() => {
    const map = new Map();
    for (const idea of snap.ideas) {
      const k = startOfDay(idea.date).getTime();
      map.set(k, [...(map.get(k) || []), idea]);
    }
    return [...map.entries()].sort((x, y) => y[0] - x[0]);
  }, [snap.ideas]);
  return (
    <div className="idl-ideas">
      <form
        className="idl-idea-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          act('idea.add', { text: text.trim() });
          setText('');
        }}
      >
        <textarea
          className="idl-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Uma ideia nova…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form.requestSubmit();
          }}
        />
        <button className="idl-btn primary" disabled={!text.trim()}>Guardar ideia</button>
      </form>
      <p className="idl-kicker">{snap.ideas.length} NEURÔNIOS</p>
      {!groups.length && <p className="idl-empty center">Nenhuma ideia ainda.</p>}
      {groups.map(([k, list]) => {
        const d = new Date(k);
        return (
          <section key={k}>
            <h4>
              {fmt.weekday(d)} {fmt.dayMonth(d)} <span>{list.length}</span>
            </h4>
            {list.map((idea) => (
              <article key={idea.id} className={`idl-idea ${isPending(idea.id) ? 'pending' : ''}`}>
                <div className="idl-idea-top">
                  <small>{fmt.time(idea.date)}</small>
                  {!isPending(idea.id) && (
                    <button className="idl-icon sm" title="Apagar" onClick={() => window.confirm('Apagar esta ideia?') && act('idea.delete', { id: idea.id })}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p>{idea.text}</p>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ metas diárias */

export function Targets({ raw, act }) {
  const g = raw.goals || {};
  const [f, setF] = useState(() => ({
    userName: raw.userName || '',
    waterML: g.waterML || 3000,
    kcal: g.kcal || 2500,
    protein: g.protein || 160,
    sleepH: ((g.sleepMin || 480) / 60).toString().replace('.', ','),
    steps: g.steps || 10000,
    weightKg: g.weightKg ? String(g.weightKg).replace('.', ',') : ''
  }));
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };
  return (
    <div className="idl-narrow">
      <Panel title="Metas diárias">
        <form
          className="idl-form"
          onSubmit={(e) => {
            e.preventDefault();
            act('settings.save', {
              userName: f.userName.trim(),
              waterML: Math.round(num(f.waterML)),
              kcal: Math.round(num(f.kcal)),
              protein: Math.round(num(f.protein)),
              sleepMin: Math.round(num(f.sleepH) * 60),
              steps: Math.round(num(f.steps)),
              weightKg: num(f.weightKg)
            });
            setSaved(true);
          }}
        >
          <Field label="Seu nome"><input className="idl-input" value={f.userName} onChange={set('userName')} /></Field>
          <div className="idl-row2">
            <Field label="Água (ml)"><input className="idl-input" inputMode="numeric" value={f.waterML} onChange={set('waterML')} /></Field>
            <Field label="Calorias (kcal)"><input className="idl-input" inputMode="numeric" value={f.kcal} onChange={set('kcal')} /></Field>
            <Field label="Proteína (g)"><input className="idl-input" inputMode="numeric" value={f.protein} onChange={set('protein')} /></Field>
            <Field label="Sono (horas)"><input className="idl-input" inputMode="decimal" value={f.sleepH} onChange={set('sleepH')} /></Field>
            <Field label="Passos"><input className="idl-input" inputMode="numeric" value={f.steps} onChange={set('steps')} /></Field>
            <Field label="Peso meta (kg)" hint="0 ou vazio = sem meta"><input className="idl-input" inputMode="decimal" value={f.weightKg} onChange={set('weightKg')} /></Field>
          </div>
          <button className="idl-btn primary">{saved ? 'Salvo — vai para o iPhone' : 'Salvar metas'}</button>
        </form>
      </Panel>
    </div>
  );
}
