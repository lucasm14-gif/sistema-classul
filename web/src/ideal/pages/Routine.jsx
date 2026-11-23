import React, { useState } from 'react';
import { Plus, Pencil, ChevronLeft, ChevronRight, Archive, ArchiveRestore } from 'lucide-react';
import { Panel, Modal, Field, WeekdayPicker, describeDays, minToTime, timeToMin, weekdayOf, slotOf } from '../ui';
import { dayKey, fromKey } from '../pending';
import { fmt } from '../analytics';
import { CheckRow } from './Today';

const isPending = (id) => String(id).startsWith('pending:');

function RoutineEditor({ item, onSave, onDelete, onClose }) {
  const [f, setF] = useState(() => ({
    title: item?.title || '',
    time: minToTime(item?.minutes ?? 480),
    duration: item?.duration ?? 30,
    weekdays: item?.weekdays || [1, 2, 3, 4, 5, 6, 7],
    note: item?.note || '',
    notify: item?.notify ?? true,
    hasFallback: (item?.fallbackMinutes ?? -1) >= 0,
    fallback: minToTime((item?.fallbackMinutes ?? -1) >= 0 ? item.fallbackMinutes : 20 * 60 + 40)
  }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const ok = f.title.trim() && f.weekdays.length;
  return (
    <Modal
      title={item ? 'Editar item da rotina' : 'Novo item da rotina'}
      onClose={onClose}
      footer={
        <>
          {item && !isPending(item.id) && (
            <button className="idl-btn danger" onClick={onDelete}>
              Apagar
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="idl-btn" onClick={onClose}>Cancelar</button>
          <button
            className="idl-btn primary"
            disabled={!ok}
            onClick={() => onSave({ title: f.title.trim(), minutes: timeToMin(f.time), duration: Math.max(5, Number(f.duration) || 30), weekdays: f.weekdays, note: f.note.trim(), notify: f.notify, fallbackMinutes: f.hasFallback ? timeToMin(f.fallback) : null })}
          >
            Salvar
          </button>
        </>
      }
    >
      <Field label="O quê"><input className="idl-input" value={f.title} onChange={set('title')} placeholder="Treino, leitura, deep work…" autoFocus /></Field>
      <div className="idl-row2">
        <Field label="Horário"><input className="idl-input" type="time" value={f.time} onChange={set('time')} /></Field>
        <Field label="Duração (min)"><input className="idl-input" type="number" min="5" step="5" value={f.duration} onChange={set('duration')} /></Field>
      </div>
      <Field label="Dias"><WeekdayPicker value={f.weekdays} onChange={(weekdays) => setF((x) => ({ ...x, weekdays }))} /></Field>
      <Field label="Nota (opcional)"><input className="idl-input" value={f.note} onChange={set('note')} /></Field>
      <label className="idl-toggle">
        <input type="checkbox" checked={f.hasFallback} onChange={set('hasFallback')} /> Plano B: se não marcar até o fim do horário, passa para
        <input className="idl-input idl-time-inline" type="time" value={f.fallback} onChange={set('fallback')} disabled={!f.hasFallback} />
      </label>
      <label className="idl-toggle">
        <input type="checkbox" checked={f.notify} onChange={set('notify')} /> Avisar no iPhone na hora
      </label>
    </Modal>
  );
}

function HabitEditor({ habit, onSave, onDelete, onClose }) {
  const [name, setName] = useState(habit?.name || '');
  const [weekdays, setWeekdays] = useState(habit?.weekdays || [1, 2, 3, 4, 5, 6, 7]);
  return (
    <Modal
      title={habit ? 'Editar hábito' : 'Novo hábito'}
      onClose={onClose}
      footer={
        <>
          {habit && !isPending(habit.id) && <button className="idl-btn danger" onClick={onDelete}>Apagar</button>}
          <span style={{ flex: 1 }} />
          <button className="idl-btn" onClick={onClose}>Cancelar</button>
          <button className="idl-btn primary" disabled={!name.trim() || !weekdays.length} onClick={() => onSave({ name: name.trim(), weekdays })}>
            Salvar
          </button>
        </>
      }
    >
      <Field label="Hábito"><input className="idl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ler 10 páginas" autoFocus /></Field>
      <Field label="Dias"><WeekdayPicker value={weekdays} onChange={setWeekdays} /></Field>
    </Modal>
  );
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export default function Routine({ raw, act }) {
  const todayKey = raw.today || dayKey();
  const today = fromKey(todayKey);
  const [sel, setSel] = useState(todayKey);
  const [editing, setEditing] = useState(null); // {kind, item}
  const [showArchived, setShowArchived] = useState(false);
  const selDate = fromKey(sel);
  const monday = addDays(selDate, -((selDate.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const wd = weekdayOf(selDate);
  const routine = raw.routine || [];
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const slot = (r) => slotOf(r, sel, todayKey, nowMin);
  const ofDay = routine.filter((r) => r.weekdays.includes(wd)).sort((a, b) => slot(a) - slot(b));
  const habits = (raw.habits || []).filter((h) => showArchived || !h.archived);
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const future = sel > todayKey;

  const close = () => setEditing(null);

  return (
    <div className="idl-routine">
      <Panel
        title="Rotina"
        right={
          <button className="idl-btn sm" onClick={() => setEditing({ kind: 'routine' })}>
            <Plus size={14} /> Novo item
          </button>
        }
      >
        <div className="idl-weekbar">
          <button className="idl-icon sm" onClick={() => setSel(dayKey(addDays(selDate, -7)))} aria-label="Semana anterior"><ChevronLeft size={14} /></button>
          {week.map((d) => {
            const k = dayKey(d);
            const items = routine.filter((r) => r.weekdays.includes(weekdayOf(d)));
            const done = items.filter((r) => r.doneDays.includes(k)).length;
            return (
              <button key={k} className={`idl-weekday ${k === sel ? 'on' : ''} ${k === todayKey ? 'today' : ''}`} onClick={() => setSel(k)}>
                <small>{fmt.weekday(d)}</small>
                <b>{d.getDate()}</b>
                <i>{items.length ? `${done}/${items.length}` : '—'}</i>
              </button>
            );
          })}
          <button className="idl-icon sm" onClick={() => setSel(dayKey(addDays(selDate, 7)))} aria-label="Próxima semana"><ChevronRight size={14} /></button>
        </div>
        {!ofDay.length && <p className="idl-empty">Nada na rotina neste dia.</p>}
        <ul className="idl-checks">
          {ofDay.map((r) => {
            const done = r.doneDays.includes(sel);
            return (
              <CheckRow
                key={r.id}
                done={done}
                title={r.title}
                sub={`${minToTime(slot(r))}–${minToTime(slot(r) + r.duration)}${slot(r) !== r.minutes ? ` · plano B (era ${minToTime(r.minutes)})` : r.fallbackMinutes >= 0 ? ` · plano B ${minToTime(r.fallbackMinutes)}` : ''} · ${describeDays(r.weekdays)}${r.note ? ` · ${r.note}` : ''}`}
                onToggle={() => !future && act('routine.check', { id: r.id, day: sel, done: !done })}
                right={
                  <button className="idl-icon sm" title="Editar" onClick={() => setEditing({ kind: 'routine', item: r })}>
                    <Pencil size={12} />
                  </button>
                }
              />
            );
          })}
        </ul>
        {future && <p className="idl-note">Dias futuros só mostram a rotina; marcar fica para o dia.</p>}
      </Panel>

      <Panel
        title="Hábitos"
        right={
          <div className="idl-inline">
            <button className="idl-link" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'esconder arquivados' : 'ver arquivados'}</button>
            <button className="idl-btn sm" onClick={() => setEditing({ kind: 'habit' })}>
              <Plus size={14} /> Novo hábito
            </button>
          </div>
        }
      >
        {!habits.length && <p className="idl-empty">Nenhum hábito ainda.</p>}
        <div className="idl-habits">
          <div className="idl-habit-row head">
            <span />
            {last14.map((d) => <small key={d.getTime()}>{d.getDate()}</small>)}
            <span />
          </div>
          {habits.map((h) => (
            <div key={h.id} className={`idl-habit-row ${h.archived ? 'archived' : ''}`}>
              <div className="idl-habit-name">
                <p>{h.name}</p>
                <small>{describeDays(h.weekdays)}{h.streak ? ` · ${h.streak} seguidos` : ''}</small>
              </div>
              {last14.map((d) => {
                const k = dayKey(d);
                const sched = h.weekdays.includes(weekdayOf(d));
                const done = h.doneDays.includes(k);
                return (
                  <button
                    key={k}
                    className={`idl-dot-btn ${done ? 'done' : ''} ${sched ? '' : 'off'}`}
                    title={`${fmt.weekday(d)} ${fmt.dayMonth(d)}${done ? ' · feito' : ''}`}
                    onClick={() => act('habit.check', { id: h.id, day: k, done: !done })}
                  />
                );
              })}
              <div className="idl-inline">
                <button className="idl-icon sm" title="Editar" onClick={() => setEditing({ kind: 'habit', item: h })}><Pencil size={12} /></button>
                {!isPending(h.id) && (
                  <button className="idl-icon sm" title={h.archived ? 'Reativar' : 'Arquivar'} onClick={() => act('habit.save', { id: h.id, name: h.name, archived: !h.archived })}>
                    {h.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {editing?.kind === 'routine' && (
        <RoutineEditor
          item={editing.item}
          onClose={close}
          onSave={(data) => {
            act('routine.save', editing.item ? { id: editing.item.id, ...data } : data);
            close();
          }}
          onDelete={() => {
            if (window.confirm(`Apagar "${editing.item.title}" da rotina?`)) {
              act('routine.delete', { id: editing.item.id });
              close();
            }
          }}
        />
      )}
      {editing?.kind === 'habit' && (
        <HabitEditor
          habit={editing.item}
          onClose={close}
          onSave={(data) => {
            act('habit.save', editing.item ? { id: editing.item.id, ...data } : data);
            close();
          }}
          onDelete={() => {
            if (window.confirm(`Apagar o hábito "${editing.item.name}" e o histórico dele?`)) {
              act('habit.delete', { id: editing.item.id });
              close();
            }
          }}
        />
      )}
    </div>
  );
}
