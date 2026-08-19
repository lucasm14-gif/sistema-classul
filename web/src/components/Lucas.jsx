import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Lock,
  LogOut,
  KeyRound,
  Delete,
  Flame,
  Clock3,
  RefreshCw,
  Power
} from 'lucide-react';
import { api, LucasLockError, getLucasToken, setLucasToken } from '../api';
import '../lucas.css';

/* ============================================================================
   Área pessoal do Lucas — "PROTOCOLO MORCEGO".
   Uma tela só dela: quando destravada pelo PIN, cobre o sistema inteiro
   (portal no body, position fixed) e nada do Classul aparece. Estética noir
   inspirada em The Batman: chuva, grão de filme, holofote no cursor e o
   símbolo do morcego como marca. Estilos ficam em ../lucas.css.
   ========================================================================== */

// Metade direita do morcego; a esquerda é a mesma espelhada. Desenhar só um lado
// garante simetria perfeita e mantém o traço editável em um lugar só.
const BAT_HALF =
  'M100 14 L104 3 C106 13 110 21 116 27 C140 14 170 8 197 14 ' +
  'C176 24 170 40 166 56 C152 54 138 58 130 70 C120 74 110 80 100 92 Z';

export function BatSigil({ className, line = false, style }) {
  return (
    <svg viewBox="0 0 200 100" className={className} style={style} aria-hidden="true">
      <g className={line ? 'btm-sigil-line' : 'btm-sigil-fill'}>
        <path d={BAT_HALF} />
        <path d={BAT_HALF} transform="scale(-1 1) translate(-200 0)" />
      </g>
    </svg>
  );
}

// O mesmo morcego como imagem, para usar de marca-d'água em CSS.
const BAT_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 100'><g fill='#ffffff'><path d='${BAT_HALF}'/><path d='${BAT_HALF}' transform='scale(-1 1) translate(-200 0)'/></g></svg>`
)}")`;

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;600;700&family=JetBrains+Mono:wght@300;400;600&display=swap';

// Carrega as fontes da tela só quando ela é aberta (não pesa o resto do sistema).
function useNightFonts() {
  useEffect(() => {
    if (document.querySelector('link[data-btm-fonts]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    link.dataset.btmFonts = '1';
    document.head.appendChild(link);
  }, []);
}

const todayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const DAY_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function weekdayOf(key) {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

function prettyDay(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

/* ------------------------- Efeitos de texto e tempo ------------------------ */

const GLYPHS = '▚▞▛▜█▓▒░/\\<>#*+=—01';

// Decodifica o texto letra a letra (efeito clássico de terminal).
function useScramble(text, delay = 0) {
  const [out, setOut] = useState('');
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOut(text);
      return undefined;
    }
    let frame = 0;
    let raf = 0;
    const total = text.length * 2 + 16;
    const tick = () => {
      frame += 1;
      setOut(
        text
          .split('')
          .map((ch, i) => {
            if (ch === ' ') return ' ';
            const start = i * 2;
            if (frame >= start + 10) return ch;
            if (frame < start) return ' ';
            return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          })
          .join('')
      );
      if (frame < total) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [text, delay]);
  return out;
}

// Contador que sobe até o valor final.
function useCountUp(value, duration = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const target = Number(value) || 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(target);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return n;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const date = now.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  });
  return (
    <div className="btm-clock">
      <strong>{time}</strong>
      <span>{date}</span>
    </div>
  );
}

/* ------------------------------ Chuva e trovão ---------------------------- */

function Rain() {
  const canvasRef = useRef(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let drops = [];
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 14000);
      drops = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 8 + Math.random() * 22,
        v: 5 + Math.random() * 11,
        a: 0.06 + Math.random() * 0.22
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      for (const d of drops) {
        ctx.strokeStyle = `rgba(190,200,220,${d.a})`;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.22, d.y + d.len);
        ctx.stroke();
        d.y += d.v;
        d.x -= d.v * 0.22;
        if (d.y > h) {
          d.y = -d.len;
          d.x = Math.random() * (w + 120);
        }
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Relâmpago de vez em quando.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let timer = 0;
    const schedule = () => {
      timer = setTimeout(() => {
        setFlash(true);
        setTimeout(() => setFlash(false), 1200);
        schedule();
      }, 9000 + Math.random() * 16000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="btm-rain" />
      <div className={`btm-flash${flash ? ' on' : ''}`} />
    </>
  );
}

/* ---------------------------- Tela de bloqueio ---------------------------- */

function LockScreen({ mode, onUnlocked, onExit, note }) {
  const creating = mode === 'create';
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage] = useState('pin'); // pin | confirm (só na criação)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const current = stage === 'confirm' ? confirm : pin;
  const setCurrent = stage === 'confirm' ? setConfirm : setPin;

  const title = useScramble(creating ? 'PROTOCOLO' : 'GOTHAM', 900);
  const sub = useScramble(
    creating ? 'DEFINA O CÓDIGO DE ACESSO' : 'ACESSO RESTRITO — SOMENTE LUCAS',
    1400
  );

  const fail = (msg) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 450);
    setPin('');
    setConfirm('');
    setStage('pin');
  };

  const submit = useCallback(
    async (value) => {
      setBusy(true);
      setError('');
      try {
        const res = creating ? await api.lucasSetPin(value) : await api.lucasUnlock(value);
        setLucasToken(res.token);
        onUnlocked();
      } catch (err) {
        fail(err.message || 'Falha no acesso');
      } finally {
        setBusy(false);
      }
    },
    [creating, onUnlocked]
  );

  const press = (key) => {
    if (busy) return;
    setError('');
    // Atualização funcional: dígitos digitados em rajada não se perdem.
    if (key === 'del') return setCurrent((prev) => prev.slice(0, -1));
    if (key === 'ok') {
      if (current.length < 4) return fail('mínimo de 4 dígitos');
      if (creating && stage === 'pin') return setStage('confirm');
      if (creating && pin !== confirm) return fail('os códigos não conferem');
      return submit(pin);
    }
    return setCurrent((prev) => (prev.length >= 8 ? prev : prev + key));
  };

  // Teclado físico também funciona.
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const dots = Array.from({ length: Math.max(6, current.length) });

  return (
    <div className="btm-lock">
      <BatSigil className="btm-sigil" />
      <div>
        <h1 className="btm-display btm-lock-title">{title || ' '}</h1>
        <p className="btm-lock-sub" style={{ marginTop: 14 }}>
          {sub || ' '}
        </p>
      </div>

      <div className={`btm-dots${shake ? ' btm-shake' : ''}`}>
        {dots.map((_, i) => (
          <i key={i} className={`btm-dot${i < current.length ? ' on' : ''}${error ? ' err' : ''}`} />
        ))}
      </div>

      <p className={`btm-hint${error ? ' err' : ''}`}>
        {error ||
          (creating
            ? stage === 'confirm'
              ? 'repita o código'
              : 'escolha de 4 a 8 dígitos'
            : note || 'digite o código')}
      </p>

      <div className="btm-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} className="btm-key" onClick={() => press(k)} type="button">
            <span>{k}</span>
          </button>
        ))}
        <button className="btm-key ghost" onClick={() => press('del')} type="button">
          <span>
            <Delete size={16} />
          </span>
        </button>
        <button className="btm-key" onClick={() => press('0')} type="button">
          <span>0</span>
        </button>
        <button className="btm-key ghost" onClick={() => press('ok')} type="button" disabled={busy}>
          <span>{busy ? '···' : 'ok'}</span>
        </button>
      </div>

      <button className="btm-chip" onClick={onExit} type="button" style={{ marginTop: 4 }}>
        voltar ao classul
      </button>
    </div>
  );
}

/* ------------------------------ Abertura ---------------------------------- */

function Boot() {
  return (
    <div className="btm-boot">
      <BatSigil className="btm-boot-sigil" />
      <div className="btm-boot-lines">
        <div className="btm-wipe" style={{ '--d': '0.5s' }}>acesso concedido</div>
        <div className="btm-wipe" style={{ '--d': '0.9s' }}>carregando registro pessoal</div>
        <div className="btm-wipe" style={{ '--d': '1.3s' }}>bem-vindo de volta, lucas</div>
      </div>
    </div>
  );
}

/* -------------------------------- Modais ---------------------------------- */

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="btm btm-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="btm-modal" role="dialog">
        <div className="btm-modal-head">
          <BatSigil style={{ width: 30, fill: 'var(--beam-hot)' }} />
          <h3>{title}</h3>
          <button className="btm-mini" onClick={onClose} type="button" style={{ marginLeft: 'auto' }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

const PRIORITY_LABEL = { baixa: 'baixa', media: 'média', critica: 'crítica' };

const PRIORITIES = [
  { id: 'baixa', label: 'baixa' },
  { id: 'media', label: 'média' },
  { id: 'critica', label: 'crítica' }
];

const STATUSES = [
  { id: 'aberta', label: 'aberta' },
  { id: 'andamento', label: 'em ação' },
  { id: 'concluida', label: 'concluída' }
];

function TaskModal({ task, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({
    title: task?.title || '',
    notes: task?.notes || '',
    priority: task?.priority || 'media',
    status: task?.status || 'aberta',
    due_date: task?.due_date || ''
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return notify('dê um nome à missão', 'err');
    setBusy(true);
    try {
      const payload = { ...form, due_date: form.due_date || null };
      if (task) await api.lucasUpdateTask(task.id, payload);
      else await api.lucasCreateTask(payload);
      await onSaved();
      onClose();
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Modal title={task ? 'editar missão' : 'nova missão'} onClose={onClose}>
      <form className="btm-form" onSubmit={save}>
        <div className="btm-field">
          <label>missão</label>
          <input
            className="btm-input"
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="o que precisa ser feito"
          />
        </div>
        <div className="btm-field">
          <label>anotações</label>
          <textarea
            className="btm-input"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="detalhes, contexto, links…"
          />
        </div>
        <div className="btm-field">
          <label>prioridade</label>
          <div className="btm-seg">
            {PRIORITIES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`btm-chip${form.priority === p.id ? ' on' : ''}`}
                onClick={() => set('priority', p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="btm-field">
          <label>situação</label>
          <div className="btm-seg">
            {STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`btm-chip${form.status === s.id ? ' on' : ''}`}
                onClick={() => set('status', s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="btm-field">
          <label>prazo</label>
          <input
            type="date"
            className="btm-input"
            value={form.due_date || ''}
            onChange={(e) => set('due_date', e.target.value)}
          />
        </div>
        <div className="btm-actions" style={{ padding: 0 }}>
          <button type="button" className="btm-btn" onClick={onClose}>
            cancelar
          </button>
          <button type="submit" className="btm-btn primary" disabled={busy}>
            {busy ? 'salvando…' : 'salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RoutineModal({ routine, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({
    title: routine?.title || '',
    time_of_day: routine?.time_of_day || '',
    days: routine?.days || '0123456',
    active: routine ? routine.active : 1
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleDay = (d) => {
    const has = form.days.includes(String(d));
    const next = has ? form.days.replace(String(d), '') : `${form.days}${d}`;
    set('days', next.split('').sort().join(''));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return notify('dê um nome à rotina', 'err');
    if (!form.days) return notify('escolha pelo menos um dia', 'err');
    setBusy(true);
    try {
      const payload = { ...form, time_of_day: form.time_of_day || null };
      if (routine) await api.lucasUpdateRoutine(routine.id, payload);
      else await api.lucasCreateRoutine(payload);
      await onSaved();
      onClose();
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Modal title={routine ? 'editar rotina' : 'nova rotina'} onClose={onClose}>
      <form className="btm-form" onSubmit={save}>
        <div className="btm-field">
          <label>rotina</label>
          <input
            className="btm-input"
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="treino, leitura, água…"
          />
        </div>
        <div className="btm-field">
          <label>horário (opcional)</label>
          <input
            type="time"
            className="btm-input"
            value={form.time_of_day || ''}
            onChange={(e) => set('time_of_day', e.target.value)}
          />
        </div>
        <div className="btm-field">
          <label>dias da semana</label>
          <div className="btm-days">
            {DAY_LETTERS.map((letter, i) => (
              <button
                key={i}
                type="button"
                title={DAY_NAMES[i]}
                className={`btm-day${form.days.includes(String(i)) ? ' on' : ''}`}
                onClick={() => toggleDay(i)}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>
        <div className="btm-field">
          <label>situação</label>
          <div className="btm-seg">
            <button
              type="button"
              className={`btm-chip${form.active ? ' on' : ''}`}
              onClick={() => set('active', 1)}
            >
              ativa
            </button>
            <button
              type="button"
              className={`btm-chip${!form.active ? ' on' : ''}`}
              onClick={() => set('active', 0)}
            >
              pausada
            </button>
          </div>
        </div>
        <div className="btm-actions" style={{ padding: 0 }}>
          <button type="button" className="btm-btn" onClick={onClose}>
            cancelar
          </button>
          <button type="submit" className="btm-btn primary" disabled={busy}>
            {busy ? 'salvando…' : 'salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PinModal({ onClose, notify }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (next.length < 4) return notify('o novo código precisa ter 4+ dígitos', 'err');
    setBusy(true);
    try {
      const res = await api.lucasSetPin(next, current);
      setLucasToken(res.token);
      notify('código atualizado');
      onClose();
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Modal title="trocar código" onClose={onClose}>
      <form className="btm-form" onSubmit={save}>
        <div className="btm-field">
          <label>código atual</label>
          <input
            className="btm-input"
            type="password"
            inputMode="numeric"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </div>
        <div className="btm-field">
          <label>novo código</label>
          <input
            className="btm-input"
            type="password"
            inputMode="numeric"
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </div>
        <div className="btm-actions" style={{ padding: 0 }}>
          <button type="button" className="btm-btn" onClick={onClose}>
            cancelar
          </button>
          <button type="submit" className="btm-btn primary" disabled={busy}>
            {busy ? 'salvando…' : 'trocar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------- Painel --------------------------------- */

function Ring({ done, total }) {
  const pct = total ? done / total : 0;
  const R = 68;
  const C = 2 * Math.PI * R;
  return (
    <div className="btm-ring">
      <svg viewBox="0 0 148 148">
        <circle className="track" cx="74" cy="74" r={R} />
        <circle
          className="value"
          cx="74"
          cy="74"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <div className="btm-ring-center">
        <b>{total ? Math.round(pct * 100) : 0}%</b>
        <span>
          {done}/{total} hoje
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const n = useCountUp(value);
  return (
    <div className="btm-stat">
      <b className={tone || ''}>{String(n).padStart(2, '0')}</b>
      <span className="btm-label">{label}</span>
    </div>
  );
}

function TaskRow({ task, today, onToggle, onEdit, onDelete }) {
  const [flying, setFlying] = useState(false);
  const done = task.status === 'concluida';
  const late = !done && task.due_date && task.due_date < today;

  const toggle = () => {
    if (!done) {
      setFlying(true);
      setTimeout(() => setFlying(false), 900);
    }
    onToggle(task, done ? 'aberta' : 'concluida');
  };

  return (
    <div className={`btm-task${done ? ' done' : ''}`}>
      <button
        className={`btm-check${done ? ' on' : ''}`}
        onClick={toggle}
        type="button"
        title={done ? 'reabrir' : 'concluir'}
      >
        <BatSigil />
        {flying && <BatSigil className="btm-fly" />}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="btm-task-title">{task.title}</p>
        {task.notes && <p className="btm-task-notes">{task.notes}</p>}
        <div className="btm-task-meta">
          <span className={`btm-tag ${task.priority}`}>{PRIORITY_LABEL[task.priority] || task.priority}</span>
          {task.status === 'andamento' && <span className="btm-tag andamento">em ação</span>}
          {task.due_date && (
            <span className={`btm-tag${late ? ' late' : ''}`}>
              <Clock3 size={10} />
              {late ? 'atrasada · ' : ''}
              {prettyDay(task.due_date)}
            </span>
          )}
        </div>
      </div>
      <div className="btm-row-actions">
        {!done && task.status !== 'andamento' && (
          <button
            className="btm-mini"
            title="marcar em ação"
            type="button"
            onClick={() => onToggle(task, 'andamento')}
          >
            <Power size={14} />
          </button>
        )}
        <button className="btm-mini" title="editar" type="button" onClick={() => onEdit(task)}>
          <Pencil size={14} />
        </button>
        <button className="btm-mini danger" title="apagar" type="button" onClick={() => onDelete(task)}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function RoutineRow({ routine, today, onCheck, onEdit, onDelete }) {
  const last7 = routine.history.slice(-7);
  return (
    <div className={`btm-routine${routine.active ? '' : ' off'}`}>
      <button
        className={`btm-check${routine.done_today ? ' on' : ''}`}
        type="button"
        title={routine.done_today ? 'desmarcar hoje' : 'marcar hoje'}
        onClick={() => onCheck(routine, !routine.done_today)}
      >
        <BatSigil />
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="btm-routine-title">{routine.title}</p>
        <div className="btm-routine-sub">
          {routine.time_of_day && <span>{routine.time_of_day}</span>}
          <span>
            {routine.days.length === 7
              ? 'todo dia'
              : routine.days
                  .split('')
                  .map((d) => DAY_LETTERS[Number(d)])
                  .join(' ')}
          </span>
          {routine.streak > 0 && (
            <span className="btm-streak">
              <Flame size={11} /> {routine.streak} dias
            </span>
          )}
          {!routine.active && <span>pausada</span>}
        </div>
      </div>
      <div className="btm-week" title="últimos 7 dias">
        {last7.map((d) => (
          <i key={d.day} className={`${d.done ? 'on' : ''}${d.day === today ? ' today' : ''}`} />
        ))}
      </div>
      <div className="btm-row-actions">
        <button className="btm-mini" title="editar" type="button" onClick={() => onEdit(routine)}>
          <Pencil size={14} />
        </button>
        <button className="btm-mini danger" title="apagar" type="button" onClick={() => onDelete(routine)}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

const FILTERS = [
  { id: 'ativas', label: 'em aberto' },
  { id: 'criticas', label: 'críticas' },
  { id: 'hoje', label: 'com prazo' },
  { id: 'concluidas', label: 'concluídas' },
  { id: 'todas', label: 'todas' }
];

function Deck({ data, reload, onLock, onExit, notify }) {
  const [filter, setFilter] = useState('ativas');
  const [taskModal, setTaskModal] = useState(null); // {task} | {}
  const [routineModal, setRoutineModal] = useState(null);
  const [pinModal, setPinModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { tasks, routines, stats, today } = data;
  const hero = useScramble('REGISTRO DA NOITE', 200);

  const visible = useMemo(() => {
    const open = (t) => t.status !== 'concluida';
    if (filter === 'todas') return tasks;
    if (filter === 'concluidas') return tasks.filter((t) => !open(t));
    if (filter === 'criticas') return tasks.filter((t) => open(t) && t.priority === 'critica');
    if (filter === 'hoje') return tasks.filter((t) => open(t) && t.due_date);
    return tasks.filter(open);
  }, [tasks, filter]);

  const toggleTask = async (task, status) => {
    try {
      await api.lucasUpdateTask(task.id, { status });
      if (status === 'concluida') {
        // Dá tempo do morcego "voar" antes da lista se refazer.
        await new Promise((r) => setTimeout(r, 460));
        notify('missão concluída');
      }
      await reload();
    } catch (err) {
      notify(err.message, 'err');
    }
  };

  const removeTask = async (task) => {
    if (!window.confirm(`Apagar a missão "${task.title}"?`)) return;
    try {
      await api.lucasDeleteTask(task.id);
      await reload();
    } catch (err) {
      notify(err.message, 'err');
    }
  };

  const checkRoutine = async (routine, done) => {
    try {
      await api.lucasCheckRoutine(routine.id, today, done);
      await reload();
    } catch (err) {
      notify(err.message, 'err');
    }
  };

  const removeRoutine = async (routine) => {
    if (!window.confirm(`Apagar a rotina "${routine.title}" e o histórico dela?`)) return;
    try {
      await api.lucasDeleteRoutine(routine.id);
      await reload();
    } catch (err) {
      notify(err.message, 'err');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setTimeout(() => setRefreshing(false), 500);
  };

  // Registro dos 28 dias: nível pela fatia de rotinas cumpridas no dia.
  const heat = useMemo(() => {
    const days = routines[0]?.history?.map((h) => h.day) || [];
    return days.map((day) => {
      const weekday = String(weekdayOf(day));
      const scheduled = routines.filter((r) => r.active && r.days.includes(weekday));
      const done = scheduled.filter((r) => r.history.find((h) => h.day === day)?.done).length;
      const ratio = scheduled.length ? done / scheduled.length : 0;
      const level = ratio === 0 ? 0 : ratio < 0.5 ? 1 : ratio < 1 ? 2 : 3;
      return { day, level, done, total: scheduled.length };
    });
  }, [routines]);

  const todayRoutines = routines.filter((r) => r.active && r.today);

  return (
    <>
      <header className="btm-top btm-rise">
        <div className="btm-mark">
          <BatSigil />
          <div>
            <h1>Lucas</h1>
            <p>protocolo pessoal</p>
          </div>
        </div>
        <Clock />
        <button className="btm-icon-btn" title="atualizar" type="button" onClick={refresh}>
          <RefreshCw size={16} className={refreshing ? 'btm-spin' : ''} />
        </button>
        <button className="btm-icon-btn" title="trocar código" type="button" onClick={() => setPinModal(true)}>
          <KeyRound size={16} />
        </button>
        <button className="btm-icon-btn" title="trancar" type="button" onClick={onLock}>
          <Lock size={16} />
        </button>
        <button className="btm-icon-btn" title="voltar ao Classul" type="button" onClick={onExit}>
          <LogOut size={16} />
        </button>
      </header>

      <div className="btm-ticker">
        <div className="btm-ticker-track">
          {[0, 1].map((k) => (
            <span key={k}>
              {stats.tasks_late > 0
                ? `${stats.tasks_late} missão(ões) fora do prazo — resolva antes do amanhecer`
                : 'nenhuma missão atrasada — a cidade dorme tranquila'}
              {' • '}
              {stats.tasks_critical} crítica(s) na fila • {stats.routines_done}/{stats.routines_today} rotinas
              cumpridas hoje • {prettyDay(today)} •
            </span>
          ))}
        </div>
      </div>

      <div className="btm-scroll">
        <section className="btm-hero">
          <div>
            <h2 className="btm-rise" style={{ '--d': '0.1s' }}>
              {hero || ' '}
            </h2>
            <p className="btm-hero-sub btm-rise" style={{ '--d': '0.25s' }}>
              {stats.tasks_open === 0
                ? 'nenhuma missão em aberto. aproveite o silêncio.'
                : `${stats.tasks_open} missão(ões) em aberto · ${stats.tasks_done_today} concluída(s) hoje`}
            </p>
          </div>
          <div className="btm-rise" style={{ '--d': '0.35s' }}>
            <Ring done={stats.routines_done} total={stats.routines_today} />
          </div>
        </section>

        <section className="btm-stats btm-rise" style={{ '--d': '0.4s' }}>
          <Stat label="em aberto" value={stats.tasks_open} />
          <Stat label="críticas" value={stats.tasks_critical} tone="hot" />
          <Stat label="atrasadas" value={stats.tasks_late} tone="hot" />
          <Stat label="feitas hoje" value={stats.tasks_done_today} tone="amber" />
          <Stat label="rotinas hoje" value={stats.routines_today} />
        </section>

        <div className="btm-grid">
          <section className="btm-panel btm-rise" style={{ '--d': '0.5s' }}>
            <div className="btm-panel-head">
              <BatSigil style={{ width: 26, fill: 'var(--beam-hot)' }} />
              <h3>Missões</h3>
              <span className="btm-count">{visible.length}</span>
              <button className="btm-add" type="button" onClick={() => setTaskModal({})}>
                <Plus size={12} /> nova
              </button>
            </div>
            <div className="btm-filters">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`btm-chip${filter === f.id ? ' on' : ''}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <div className="btm-empty">
                <BatSigil />
                <div>nada por aqui</div>
              </div>
            ) : (
              visible.map((task, i) => (
                <div key={task.id} className="btm-rise" style={{ '--d': `${0.05 * i}s` }}>
                  <TaskRow
                    task={task}
                    today={today}
                    onToggle={toggleTask}
                    onEdit={(t) => setTaskModal({ task: t })}
                    onDelete={removeTask}
                  />
                </div>
              ))
            )}
          </section>

          <div style={{ display: 'grid', gap: 22 }}>
            <section className="btm-panel btm-rise" style={{ '--d': '0.6s' }}>
              <div className="btm-panel-head">
                <BatSigil style={{ width: 26, fill: 'var(--amber)' }} />
                <h3>Rotinas</h3>
                <span className="btm-count">
                  {stats.routines_done}/{stats.routines_today} hoje
                </span>
                <button className="btm-add" type="button" onClick={() => setRoutineModal({})}>
                  <Plus size={12} /> nova
                </button>
              </div>
              {routines.length === 0 ? (
                <div className="btm-empty">
                  <BatSigil />
                  <div>sem rotinas ainda</div>
                </div>
              ) : (
                routines.map((r, i) => (
                  <div key={r.id} className="btm-rise" style={{ '--d': `${0.05 * i}s` }}>
                    <RoutineRow
                      routine={r}
                      today={today}
                      onCheck={checkRoutine}
                      onEdit={(x) => setRoutineModal({ routine: x })}
                      onDelete={removeRoutine}
                    />
                  </div>
                ))
              )}
              {todayRoutines.length > 0 && (
                <div className="btm-empty" style={{ padding: '12px 16px', textAlign: 'left' }}>
                  {stats.routines_done === stats.routines_today
                    ? 'todas as rotinas de hoje cumpridas'
                    : `faltam ${stats.routines_today - stats.routines_done} de hoje`}
                </div>
              )}
            </section>

            <section className="btm-panel btm-rise" style={{ '--d': '0.7s' }}>
              <div className="btm-panel-head">
                <h3>Registro</h3>
                <span className="btm-count">28 dias</span>
              </div>
              {heat.length === 0 ? (
                <div className="btm-empty">sem histórico</div>
              ) : (
                <div className="btm-heat">
                  {heat.map((h, i) => (
                    <i
                      key={h.day}
                      data-level={h.level}
                      style={{ '--d': `${0.012 * i}s` }}
                      title={`${prettyDay(h.day)} — ${h.done}/${h.total}`}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {taskModal && (
        <TaskModal
          task={taskModal.task}
          onClose={() => setTaskModal(null)}
          onSaved={reload}
          notify={notify}
        />
      )}
      {routineModal && (
        <RoutineModal
          routine={routineModal.routine}
          onClose={() => setRoutineModal(null)}
          onSaved={reload}
          notify={notify}
        />
      )}
      {pinModal && <PinModal onClose={() => setPinModal(false)} notify={notify} />}
    </>
  );
}

/* --------------------------------- Raiz ----------------------------------- */

export default function Lucas({ onExit, onAuthError }) {
  useNightFonts();
  const rootRef = useRef(null);
  const [status, setStatus] = useState(null); // { has_pin }
  const [unlocked, setUnlocked] = useState(() => Boolean(getLucasToken()));
  const [booting, setBooting] = useState(false);
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState([]);

  const notify = useCallback((message, type = 'ok') => {
    const id = Date.now() + Math.random();
    setNotes((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setNotes((prev) => prev.filter((n) => n.id !== id)), 3800);
  }, []);

  // Holofote que segue o cursor.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const move = (e) => {
      el.style.setProperty('--mx', `${e.clientX}px`);
      el.style.setProperty('--my', `${e.clientY}px`);
    };
    el.addEventListener('mousemove', move);
    return () => el.removeEventListener('mousemove', move);
  }, []);

  useEffect(() => {
    api
      .lucasStatus()
      .then(setStatus)
      .catch((err) => {
        if (!onAuthError?.(err)) notify(err.message, 'err');
      });
  }, [onAuthError, notify]);

  const load = useCallback(async () => {
    try {
      setData(await api.lucasOverview());
    } catch (err) {
      if (err instanceof LucasLockError) {
        setLucasToken('');
        setUnlocked(false);
        return;
      }
      if (!onAuthError?.(err)) notify(err.message, 'err');
    }
  }, [onAuthError, notify]);

  useEffect(() => {
    if (unlocked) load();
  }, [unlocked, load]);

  const handleUnlocked = () => {
    setBooting(true);
    setUnlocked(true);
    setTimeout(() => setBooting(false), 2800);
  };

  const lock = () => {
    setLucasToken('');
    setUnlocked(false);
    setData(null);
    api.lucasStatus().then(setStatus).catch(() => {});
  };

  const body = (
    <div className="btm" ref={rootRef} style={{ '--bat-mask': BAT_MASK }}>
      <div className="btm-spot" />
      <Rain />
      <div className="btm-grain" />
      <div className="btm-scan" />
      <div className="btm-vignette" />

      <div className="btm-stage">
        {!unlocked &&
          (status ? (
            <LockScreen
              mode={status.has_pin ? 'unlock' : 'create'}
              onUnlocked={handleUnlocked}
              onExit={onExit}
            />
          ) : (
            <div className="btm-lock">
              <div className="btm-sigil-wrap">
                <BatSigil className="btm-sigil" />
              </div>
              <p className="btm-hint">conectando…</p>
            </div>
          ))}
        {unlocked && data && (
          <Deck data={data} reload={load} onLock={lock} onExit={onExit} notify={notify} />
        )}
        {unlocked && !data && (
          <div className="btm-lock">
            <div className="btm-sigil-wrap">
              <BatSigil className="btm-sigil" />
            </div>
            <p className="btm-hint">abrindo o registro…</p>
          </div>
        )}
      </div>

      {booting && <Boot />}

      {notes.length > 0 && (
        <div className="btm-notes">
          {notes.map((n) => (
            <div key={n.id} className={`btm-note${n.type === 'err' ? ' err' : ''}`}>
              {n.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(body, document.body);
}
