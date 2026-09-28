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
  Power,
  Minus,
  Mail,
  Feather
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

// Isola o efeito: sem isso, cada quadro da decodificação re-renderizava a tela
// inteira (o painel com todas as missões e rotinas).
function Scramble({ text, delay }) {
  return useScramble(text, delay) || '\u00a0';
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

function Rain({ paused }) {
  const canvasRef = useRef(null);
  const [flash, setFlash] = useState(false);

  // `paused` congela a cena (editor aberto ou janela em segundo plano): sem
  // desenhar, o navegador fica inteiro à disposição da digitação.
  useEffect(() => {
    if (paused) return undefined;
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
      ctx.clearRect(0, 0, w, h);
    };
  }, [paused]);

  // Relâmpago de vez em quando.
  useEffect(() => {
    if (paused) return undefined;
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
  }, [paused]);

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
      <div className="btm-sigil-wrap">
        <BatSigil className="btm-sigil" />
        <BatSigil className="btm-sigil btm-sigil-ghost" line />
      </div>
      <div>
        <h1 className="btm-display btm-lock-title">
          <Scramble text={creating ? 'PROTOCOLO' : 'GOTHAM'} delay={900} />
        </h1>
        <p className="btm-lock-sub" style={{ marginTop: 14 }}>
          <Scramble
            text={creating ? 'DEFINA O CÓDIGO DE ACESSO' : 'ACESSO RESTRITO — SOMENTE LUCAS'}
            delay={1400}
          />
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

// Avisa a raiz que um editor abriu/fechou, para ela congelar o cenário.
const overlayEvent = (delta) => window.dispatchEvent(new CustomEvent('btm-overlay', { detail: delta }));

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    overlayEvent(1);
    return () => {
      window.removeEventListener('keydown', onKey);
      overlayEvent(-1);
    };
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

/* --------------------------------- Ano Um ---------------------------------- */
// O ano de foco: 28/09/2026 → 28/09/2027. Contagem, juramento, metas, diário,
// mapa dos 365 dias e uma carta lacrada que só abre no fim.

const MOODS = [
  { id: 1, label: 'afundou' },
  { id: 2, label: 'pesado' },
  { id: 3, label: 'de pé' },
  { id: 4, label: 'firme' },
  { id: 5, label: 'imparável' }
];

const ACTS = ['o começo', 'a disciplina', 'a prova', 'o retorno'];
const ROMAN = ['I', 'II', 'III', 'IV'];

const GOAL_AREAS = [
  { id: 'corpo', label: 'corpo' },
  { id: 'mente', label: 'mente' },
  { id: 'dinheiro', label: 'dinheiro' },
  { id: 'trabalho', label: 'trabalho' },
  { id: 'relacoes', label: 'relações' },
  { id: 'espirito', label: 'espírito' },
  { id: 'outro', label: 'outro' }
];
const AREA_LABEL = Object.fromEntries(GOAL_AREAS.map((a) => [a.id, a.label]));

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dotDay(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}.${m}.${y}`;
}

// Contagem regressiva até a meia-noite do último dia (fuso de São Paulo, -03:00).
function Countdown({ end }) {
  const target = useMemo(() => Date.parse(`${end}T00:00:00-03:00`), [end]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, target - now);
  const parts = [
    ['dias', Math.floor(left / 86400000)],
    ['horas', Math.floor(left / 3600000) % 24],
    ['min', Math.floor(left / 60000) % 60],
    ['seg', Math.floor(left / 1000) % 60]
  ];
  return (
    <div className="btm-countdown" title={`até ${dotDay(end)}`}>
      {parts.map(([label, value]) => (
        <div key={label}>
          <b>{String(value).padStart(label === 'dias' ? 3 : 2, '0')}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function VowModal({ vow, onClose, onSaved, notify }) {
  const [text, setText] = useState(vow || '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.lucasUpdateYear({ vow: text });
      await onSaved();
      onClose();
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="juramento" onClose={onClose}>
      <form className="btm-form" onSubmit={save}>
        <div className="btm-field">
          <label>por que este ano existe</label>
          <textarea
            className="btm-input btm-tall"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="o que você promete a si mesmo até 28.09.2027"
          />
        </div>
        <div className="btm-actions" style={{ padding: 0 }}>
          <button type="button" className="btm-btn" onClick={onClose}>
            cancelar
          </button>
          <button type="submit" className="btm-btn primary" disabled={busy}>
            {busy ? 'salvando…' : 'jurar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LetterModal({ year, onClose, onSaved, notify }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!text.trim()) return notify('a carta está vazia', 'err');
    if (year.letter_written && !window.confirm('Isso substitui a carta lacrada que já existe. Continuar?')) {
      return undefined;
    }
    setBusy(true);
    try {
      await api.lucasUpdateYear({ letter: text });
      await onSaved();
      notify('carta lacrada até 28.09.2027');
      onClose();
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  return (
    <Modal title={`carta para ${dotDay(year.end)}`} onClose={onClose}>
      <form className="btm-form" onSubmit={save}>
        <p className="btm-modal-note">
          escreva para o lucas que vai existir daqui a um ano. depois de lacrada, a carta some da tela e
          só volta a abrir em {dotDay(year.end)}.
        </p>
        <div className="btm-field">
          <label>carta</label>
          <textarea
            className="btm-input btm-tall"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="lucas, se você está lendo isso…"
          />
        </div>
        <div className="btm-actions" style={{ padding: 0 }}>
          <button type="button" className="btm-btn" onClick={onClose}>
            cancelar
          </button>
          <button type="submit" className="btm-btn primary" disabled={busy}>
            {busy ? 'lacrando…' : 'lacrar carta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GoalModal({ goal, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({
    title: goal?.title || '',
    area: goal?.area || 'corpo',
    why: goal?.why || '',
    progress: goal?.progress ?? 0
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return notify('dê um nome à meta', 'err');
    setBusy(true);
    try {
      if (goal) await api.lucasUpdateGoal(goal.id, form);
      else await api.lucasCreateGoal(form);
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
    <Modal title={goal ? 'editar meta' : 'nova meta do ano'} onClose={onClose}>
      <form className="btm-form" onSubmit={save}>
        <div className="btm-field">
          <label>meta</label>
          <input
            className="btm-input"
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="onde você quer estar em 28.09.2027"
          />
        </div>
        <div className="btm-field">
          <label>área</label>
          <div className="btm-seg">
            {GOAL_AREAS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`btm-chip${form.area === a.id ? ' on' : ''}`}
                onClick={() => set('area', a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="btm-field">
          <label>por que importa</label>
          <textarea
            className="btm-input"
            value={form.why}
            onChange={(e) => set('why', e.target.value)}
            placeholder="o motivo que vai te segurar nos dias ruins"
          />
        </div>
        <div className="btm-field">
          <label>progresso · {form.progress}%</label>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            className="btm-range"
            value={form.progress}
            onChange={(e) => set('progress', Number(e.target.value))}
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

// Formulário do diário, usado no painel de hoje e no modal de dias passados.
function JournalForm({ day, entry, onSaved, notify, compact, onCancel }) {
  const [mood, setMood] = useState(entry?.mood ?? null);
  const [note, setNote] = useState(entry?.note || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMood(entry?.mood ?? null);
    setNote(entry?.note || '');
  }, [entry?.mood, entry?.note, day]);

  const dirty = (entry?.mood ?? null) !== mood || (entry?.note || '') !== note;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.lucasSaveJournal({ day, mood, note });
      await onSaved();
      notify('registro do dia gravado');
    } catch (err) {
      notify(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`btm-form${compact ? ' btm-journal-inline' : ''}`} onSubmit={save}>
      <div className="btm-field">
        <label>como foi o dia</label>
        <div className="btm-moods">
          {MOODS.map((m) => (
            <button
              key={m.id}
              type="button"
              data-mood={m.id}
              className={`btm-mood${mood === m.id ? ' on' : ''}`}
              onClick={() => setMood(mood === m.id ? null : m.id)}
            >
              <b>{m.id}</b>
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="btm-field">
        <label>registro</label>
        <textarea
          className="btm-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="o que você fez por você hoje? o que aprendeu? o que evitou?"
        />
      </div>
      <div className="btm-actions" style={{ padding: 0 }}>
        {onCancel && (
          <button type="button" className="btm-btn" onClick={onCancel}>
            fechar
          </button>
        )}
        <button type="submit" className="btm-btn primary" disabled={busy || !dirty}>
          {busy ? 'gravando…' : dirty ? 'gravar' : 'gravado'}
        </button>
      </div>
    </form>
  );
}

function JournalModal({ day, onClose, onSaved, notify }) {
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    api
      .lucasJournal(day)
      .then(setEntry)
      .catch((err) => notify(err.message, 'err'));
  }, [day, notify]);
  const weekday = DAY_NAMES[weekdayOf(day)];
  return (
    <Modal title={`${weekday} · ${dotDay(day)}`} onClose={onClose}>
      {entry ? (
        <JournalForm
          day={day}
          entry={entry}
          notify={notify}
          onCancel={onClose}
          onSaved={async () => {
            await onSaved();
            onClose();
          }}
        />
      ) : (
        <p className="btm-hint" style={{ padding: 20 }}>
          abrindo…
        </p>
      )}
    </Modal>
  );
}

function GoalRow({ goal, onStep, onEdit, onDelete }) {
  const done = Boolean(goal.done_at);
  return (
    <div className={`btm-goal${done ? ' done' : ''}`}>
      <div className="btm-goal-top">
        <span className="btm-tag">{AREA_LABEL[goal.area] || goal.area}</span>
        <p className="btm-goal-title">{goal.title}</p>
        <b className="btm-goal-pct">{goal.progress}%</b>
      </div>
      {goal.why && <p className="btm-task-notes">{goal.why}</p>}
      <div className="btm-goal-bar">
        <i style={{ width: `${goal.progress}%` }} />
      </div>
      <div className="btm-goal-actions">
        <button className="btm-mini" type="button" title="-10%" onClick={() => onStep(goal, -10)} disabled={goal.progress <= 0}>
          <Minus size={14} />
        </button>
        <button className="btm-mini" type="button" title="+10%" onClick={() => onStep(goal, 10)} disabled={goal.progress >= 100}>
          <Plus size={14} />
        </button>
        {done && <span className="btm-streak">cumprida</span>}
        <span style={{ flex: 1 }} />
        <button className="btm-mini" title="editar" type="button" onClick={() => onEdit(goal)}>
          <Pencil size={14} />
        </button>
        <button className="btm-mini danger" title="apagar" type="button" onClick={() => onDelete(goal)}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// Os 365 dias em linhas por mês. Brilho = rotinas cumpridas; ponto âmbar = diário.
function YearMap({ days, today, onPick }) {
  const months = useMemo(() => {
    const groups = [];
    for (const d of days) {
      const key = d.day.slice(0, 7);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        const [y, m] = key.split('-');
        g = { key, label: `${MONTHS[Number(m) - 1]} ${y.slice(2)}`, lead: Number(d.day.slice(8)) - 1, days: [] };
        groups.push(g);
      }
      g.days.push(d);
    }
    return groups;
  }, [days]);

  return (
    <div className="btm-yearmap">
      {months.map((m) => (
        <div key={m.key} className="btm-yearmap-row">
          <span className="btm-yearmap-label">{m.label}</span>
          <div className="btm-yearmap-cells">
            {Array.from({ length: m.lead }).map((_, i) => (
              <i key={`pad${i}`} className="pad" />
            ))}
            {m.days.map((d) => {
              const cls = [
                d.future ? 'future' : '',
                d.day === today ? 'today' : '',
                d.mood || d.has_note ? 'noted' : ''
              ]
                .filter(Boolean)
                .join(' ');
              const tip = d.future
                ? dotDay(d.day)
                : `${dotDay(d.day)} — rotinas ${d.routines_done}/${d.routines_total}${
                    d.mood ? ` · ${MOODS[d.mood - 1].label}` : ''
                  }`;
              return (
                <button
                  key={d.day}
                  type="button"
                  className={cls}
                  data-level={d.level}
                  title={tip}
                  disabled={d.future}
                  onClick={() => onPick(d.day)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function YearView({ year, reload, notify }) {
  const [vowModal, setVowModal] = useState(false);
  const [letterModal, setLetterModal] = useState(false);
  const [goalModal, setGoalModal] = useState(null);
  const [journalDay, setJournalDay] = useState(null);

  const { stats } = year;
  const actIndex = Math.max(year.act, 1) - 1;

  const stepGoal = async (goal, delta) => {
    try {
      const progress = Math.min(100, Math.max(0, goal.progress + delta));
      await api.lucasUpdateGoal(goal.id, { progress });
      if (progress === 100) notify('meta cumprida');
      await reload();
    } catch (err) {
      notify(err.message, 'err');
    }
  };

  const removeGoal = async (goal) => {
    if (!window.confirm(`Apagar a meta "${goal.title}"?`)) return;
    try {
      await api.lucasDeleteGoal(goal.id);
      await reload();
    } catch (err) {
      notify(err.message, 'err');
    }
  };

  return (
    <>
      <section className="btm-hero btm-year-hero">
        <div>
          <p className="btm-kicker btm-rise">
            <Scramble text={`ANO UM · ATO ${ROMAN[actIndex]} — ${ACTS[actIndex].toUpperCase()}`} delay={150} />
          </p>
          <h2 className="btm-rise btm-daynum" style={{ '--d': '0.1s' }}>
            {year.started ? (
              <>
                dia {String(year.day_number).padStart(3, '0')}
                <small>/{year.total_days}</small>
              </>
            ) : (
              <>faltam {year.days_to_start}</>
            )}
          </h2>
          <p className="btm-hero-sub btm-rise" style={{ '--d': '0.25s' }}>
            {year.finished
              ? 'o ano terminou. abra a carta.'
              : `semana ${year.week} de 53 · ${year.days_left} dias até ${dotDay(year.end)} · ${year.pct}% do caminho`}
          </p>
        </div>
        <div className="btm-rise" style={{ '--d': '0.35s' }}>
          <Countdown end={year.end} />
        </div>
      </section>

      <section className="btm-acts btm-rise" style={{ '--d': '0.4s' }}>
        <div className="btm-acts-bar">
          <i style={{ width: `${year.pct}%` }} />
          <span className="btm-acts-mark" style={{ left: `${year.pct}%` }} />
        </div>
        <div className="btm-acts-labels">
          {ACTS.map((a, i) => (
            <span key={a} className={i === actIndex ? 'on' : i < actIndex ? 'past' : ''}>
              <b>ato {ROMAN[i]}</b> {a}
            </span>
          ))}
        </div>
      </section>

      <section className="btm-vow btm-rise" style={{ '--d': '0.45s' }}>
        <Feather size={16} />
        {year.vow ? (
          <blockquote>{year.vow}</blockquote>
        ) : (
          <p className="btm-vow-empty">escreva o seu juramento: por que este ano existe e o que você promete a si mesmo.</p>
        )}
        <button className="btm-chip" type="button" onClick={() => setVowModal(true)}>
          {year.vow ? 'reescrever' : 'jurar'}
        </button>
      </section>

      <section className="btm-stats btm-rise" style={{ '--d': '0.5s' }}>
        <Stat label="dias vividos" value={year.started ? year.day_number : 0} />
        <Stat label="dias restantes" value={year.days_left} tone="hot" />
        <Stat label="dias no diário" value={stats.journal_days} tone="amber" />
        <Stat label="sequência diário" value={stats.journal_streak} />
        <Stat label="dias completos" value={stats.full_days} />
        <Stat label="metas cumpridas" value={stats.goals_done} tone="hot" />
      </section>

      <div className="btm-grid">
        <section className="btm-panel btm-rise" style={{ '--d': '0.55s' }}>
          <div className="btm-panel-head">
            <BatSigil style={{ width: 26, fill: 'var(--beam-hot)' }} />
            <h3>Metas do ano</h3>
            <span className="btm-count">
              {stats.goals_done}/{stats.goals_total} · média {stats.goals_avg}%
            </span>
            <button className="btm-add" type="button" onClick={() => setGoalModal({})}>
              <Plus size={12} /> nova
            </button>
          </div>
          {year.goals.length === 0 ? (
            <div className="btm-empty">
              <BatSigil />
              <div>defina quem você vai ser em {dotDay(year.end)}</div>
            </div>
          ) : (
            year.goals.map((g, i) => (
              <div key={g.id} className="btm-rise" style={{ '--d': `${0.05 * i}s` }}>
                <GoalRow goal={g} onStep={stepGoal} onEdit={(x) => setGoalModal({ goal: x })} onDelete={removeGoal} />
              </div>
            ))
          )}
        </section>

        <div style={{ display: 'grid', gap: 22 }}>
          <section className="btm-panel btm-rise" style={{ '--d': '0.6s' }}>
            <div className="btm-panel-head">
              <BatSigil style={{ width: 26, fill: 'var(--amber)' }} />
              <h3>Diário de hoje</h3>
              <span className="btm-count">
                {stats.mood_avg ? `média ${stats.mood_avg}` : prettyDay(year.today)}
              </span>
            </div>
            {year.started && !year.finished ? (
              <JournalForm day={year.today} entry={year.today_entry} onSaved={reload} notify={notify} compact />
            ) : (
              <div className="btm-empty">{year.finished ? 'o ano terminou' : 'o ano ainda não começou'}</div>
            )}
          </section>

          <section className="btm-panel btm-rise" style={{ '--d': '0.7s' }}>
            <div className="btm-panel-head">
              <Mail size={16} style={{ color: 'var(--amber)' }} />
              <h3>Carta para {dotDay(year.end)}</h3>
            </div>
            {year.finished && year.letter ? (
              <div className="btm-letter-open">{year.letter}</div>
            ) : (
              <div className="btm-letter">
                <div className={`btm-seal${year.letter_written ? ' on' : ''}`}>
                  <BatSigil />
                </div>
                <p>
                  {year.letter_written
                    ? `lacrada em ${prettyDay(dayOfTimestamp(year.letter_at))} · abre em ${dotDay(year.end)}`
                    : 'escreva para o lucas do fim do ano. ela fica lacrada até lá.'}
                </p>
                {!year.finished && (
                  <button className="btm-chip" type="button" onClick={() => setLetterModal(true)}>
                    {year.letter_written ? 'reescrever' : 'escrever carta'}
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="btm-panel btm-rise" style={{ '--d': '0.75s', marginTop: 22 }}>
        <div className="btm-panel-head">
          <h3>Mapa do ano</h3>
          <span className="btm-count">
            {year.total_days} dias · clique num dia vivido para abrir o diário
          </span>
        </div>
        <YearMap days={year.days} today={year.today} onPick={setJournalDay} />
        <div className="btm-yearmap-legend">
          <span>
            <i data-level="0" /> nada
          </span>
          <span>
            <i data-level="1" />
            <i data-level="2" />
            <i data-level="3" /> rotinas cumpridas
          </span>
          <span>
            <i className="noted" data-level="0" /> com diário
          </span>
        </div>
      </section>

      {vowModal && <VowModal vow={year.vow} onClose={() => setVowModal(false)} onSaved={reload} notify={notify} />}
      {letterModal && (
        <LetterModal year={year} onClose={() => setLetterModal(false)} onSaved={reload} notify={notify} />
      )}
      {goalModal && (
        <GoalModal goal={goalModal.goal} onClose={() => setGoalModal(null)} onSaved={reload} notify={notify} />
      )}
      {journalDay && (
        <JournalModal day={journalDay} onClose={() => setJournalDay(null)} onSaved={reload} notify={notify} />
      )}
    </>
  );
}

const dayOfTimestamp = (ts) =>
  ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : '';

const VIEW_KEY = 'classul_lucas_view';

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'noite' ? 'noite' : 'ano';
  } catch {
    return 'ano';
  }
}

const FILTERS = [
  { id: 'ativas', label: 'em aberto' },
  { id: 'criticas', label: 'críticas' },
  { id: 'hoje', label: 'com prazo' },
  { id: 'concluidas', label: 'concluídas' },
  { id: 'todas', label: 'todas' }
];

function Deck({ data, reload, onLock, onExit, notify }) {
  const [view, setViewState] = useState(readView);
  const [year, setYear] = useState(null);
  const [filter, setFilter] = useState('ativas');
  const [taskModal, setTaskModal] = useState(null); // {task} | {}
  const [routineModal, setRoutineModal] = useState(null);
  const [pinModal, setPinModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { tasks, routines, stats, today } = data;

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
      await reloadAll();
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

  const loadYear = useCallback(async () => {
    try {
      setYear(await api.lucasYear());
    } catch (err) {
      notify(err.message, 'err');
    }
  }, [notify]);

  useEffect(() => {
    loadYear();
  }, [loadYear]);

  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* só uma preferência */
    }
  };

  // Rotinas marcadas mudam o mapa do ano; o "atualizar" recarrega os dois.
  const reloadAll = useCallback(async () => {
    await Promise.all([reload(), loadYear()]);
  }, [reload, loadYear]);

  const refresh = async () => {
    setRefreshing(true);
    await reloadAll();
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
        <div className="btm-views" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'noite'}
            className={view === 'noite' ? 'on' : ''}
            onClick={() => setView('noite')}
          >
            a noite
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'ano'}
            className={view === 'ano' ? 'on' : ''}
            onClick={() => setView('ano')}
          >
            ano um
          </button>
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
              cumpridas hoje •{' '}
              {year?.started && !year.finished
                ? `ano um: dia ${year.day_number} de ${year.total_days}, faltam ${year.days_left} • `
                : ''}
              {prettyDay(today)} •
            </span>
          ))}
        </div>
      </div>

      <div className="btm-scroll">
        {view === 'ano' ? (
          year ? (
            <YearView year={year} reload={loadYear} notify={notify} />
          ) : (
            <div className="btm-empty">abrindo o ano…</div>
          )
        ) : (
          <>
            {year?.started && !year.finished && (
              <button type="button" className="btm-yearstrip btm-rise" onClick={() => setView('ano')}>
                <span>ano um</span>
                <b>
                  dia {year.day_number}/{year.total_days}
                </b>
                <i>
                  <em style={{ width: `${year.pct}%` }} />
                </i>
                <span>faltam {year.days_left}</span>
              </button>
            )}
            <section className="btm-hero">
              <div>
                <h2 className="btm-rise" style={{ '--d': '0.1s' }}>
                  <Scramble text="REGISTRO DA NOITE" delay={200} />
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
          </>
        )}
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
  const torchRef = useRef(null);
  const [overlays, setOverlays] = useState(0);
  const [hidden, setHidden] = useState(() => document.hidden);
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

  // Editores abertos e janela em segundo plano congelam o cenário.
  useEffect(() => {
    const onOverlay = (e) => setOverlays((n) => Math.max(0, n + (e.detail || 0)));
    const onVisibility = () => setHidden(document.hidden);
    window.addEventListener('btm-overlay', onOverlay);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('btm-overlay', onOverlay);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const frozen = overlays > 0 || hidden;

  // Holofote que segue o cursor: só transform, e no máximo um por quadro.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || frozen) return undefined;
    let raf = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      raf = 0;
      if (torchRef.current) torchRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const move = (e) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    el.addEventListener('mousemove', move, { passive: true });
    return () => {
      el.removeEventListener('mousemove', move);
      cancelAnimationFrame(raf);
    };
  }, [frozen]);

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
    <div className={`btm${frozen ? ' paused' : ''}`} ref={rootRef} style={{ '--bat-mask': BAT_MASK }}>
      <div className="btm-spot" />
      <div className="btm-torch" ref={torchRef} />
      <Rain paused={frozen} />
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
