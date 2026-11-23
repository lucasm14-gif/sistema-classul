import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export function Panel({ title, right, children, className = '' }) {
  return (
    <section className={`idl-panel ${className}`}>
      {(title || right) && (
        <header className="idl-panel-head">
          <h3>{title}</h3>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Delta({ value, suffix = '%', invert = false }) {
  if (!Number.isFinite(value)) return null;
  const good = invert ? value <= 0 : value >= 0;
  const cls = value === 0 ? 'flat' : good ? 'good' : 'bad';
  return (
    <span className={`idl-delta ${cls}`}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
      {suffix}
    </span>
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="idl-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="idl-modal" role="dialog" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <button className="idl-icon" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>
        <div className="idl-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="idl-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

// Dias como no app: 1 = domingo … 7 = sábado, mostrados de segunda a domingo.
const ORDER = [2, 3, 4, 5, 6, 7, 1];
const SHORT = { 1: 'D', 2: 'S', 3: 'T', 4: 'Q', 5: 'Q', 6: 'S', 7: 'S' };
const LONG = { 1: 'DOM', 2: 'SEG', 3: 'TER', 4: 'QUA', 5: 'QUI', 6: 'SEX', 7: 'SÁB' };

export function WeekdayPicker({ value, onChange }) {
  const set = new Set(value || []);
  return (
    <div className="idl-days">
      {ORDER.map((d) => (
        <button
          type="button"
          key={d}
          title={LONG[d]}
          className={set.has(d) ? 'on' : ''}
          onClick={() => {
            const next = new Set(set);
            if (next.has(d)) next.delete(d);
            else next.add(d);
            onChange([...next].sort());
          }}
        >
          {SHORT[d]}
        </button>
      ))}
      <button type="button" className="idl-days-all" onClick={() => onChange(set.size === 7 ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7])}>
        {set.size === 7 ? 'dias úteis' : 'todos'}
      </button>
    </div>
  );
}

export function describeDays(days) {
  const s = new Set(days || []);
  if (s.size === 7) return 'Todos os dias';
  if (s.size === 5 && [2, 3, 4, 5, 6].every((d) => s.has(d))) return 'Dias úteis';
  if (s.size === 2 && s.has(1) && s.has(7)) return 'Fins de semana';
  if (!s.size) return 'Nenhum dia';
  return ORDER.filter((d) => s.has(d)).map((d) => LONG[d]).join(' ');
}

export const weekdayOf = (date) => date.getDay() + 1;
export const minToTime = (m) => `${String(Math.floor((m || 0) / 60)).padStart(2, '0')}:${String((m || 0) % 60).padStart(2, '0')}`;
export const timeToMin = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
// Horário que vale no dia (igual ao app): plano B se o principal passou sem marcar.
export function slotOf(r, day, today, nowMin) {
  const fb = r.fallbackMinutes;
  if (fb == null || fb < 0 || (r.doneDays || []).includes(day)) return r.minutes;
  const missed = day < today || (day === today && nowMin >= r.minutes + Math.max(r.duration || 0, 1));
  return missed ? fb : r.minutes;
}

export const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
