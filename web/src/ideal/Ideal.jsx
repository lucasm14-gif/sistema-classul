import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Lock, Smartphone, Copy, Check, RefreshCw, LoaderCircle, LayoutGrid, Brain, Target, Play, Square, Sun, ListChecks, Dumbbell, SlidersHorizontal, CloudUpload, Undo2, AlertTriangle } from 'lucide-react';
import { api, setIdealToken, IdealLockError, AuthError } from '../api';
import { IdealMark } from './mark';
import { analytics, prepare, GROUPS, fmt, sameDay, startOfDay } from './analytics';
import { applyPending, describeAction } from './pending';
import { Panel, Delta } from './ui';
import Today from './pages/Today';
import Routine from './pages/Routine';
import { Workout, Goals, Ideas, Targets } from './pages/More';
import './ideal.css';

// Ideal na web: o painel do app do Mac, com os dados que o iPhone manda para o
// sistema. Área secreta (entra pelo morcego do rodapé) com senha própria.

const POLL_MS = 30000;
const PAGES = [
  ['hoje', 'Hoje', Sun],
  ['rotina', 'Rotina', ListChecks],
  ['treino', 'Treino', Dumbbell],
  ['painel', 'Painel', LayoutGrid],
  ['objetivos', 'Objetivos', Target],
  ['ideias', 'Ideias', Brain],
  ['metas', 'Metas', SlidersHorizontal]
];

/* ------------------------------------------------------------------ peças */

const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

/* ------------------------------------------------------------------ senha */

function Gate({ onUnlocked, onExit, onAuthError }) {
  const [mode, setMode] = useState(null); // unlock | create
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .idealStatus()
      .then((s) => setMode(s.has_pin ? 'unlock' : 'create'))
      .catch((e) => (onAuthError(e) ? null : setError(e.message)));
  }, [onAuthError]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'create' && pin !== pin2) return setError('As senhas não batem.');
    setBusy(true);
    try {
      const r = mode === 'create' ? await api.idealSetPin(pin) : await api.idealUnlock(pin);
      setIdealToken(r.token);
      onUnlocked();
    } catch (err) {
      if (onAuthError(err)) return;
      setError(err.message);
      setPin('');
      setPin2('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="idl-gate">
      <button className="idl-icon idl-close" onClick={onExit} aria-label="Fechar">
        <X size={18} />
      </button>
      <form onSubmit={submit} className="idl-gate-box">
        <IdealMark className="idl-gate-mark" columns={34} />
        <p className="idl-kicker">IDEAL</p>
        <h2>{mode === 'create' ? 'Crie a senha' : 'Senha'}</h2>
        {mode && (
          <>
            <input
              className="idl-input idl-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
            />
            {mode === 'create' && (
              <input
                className="idl-input idl-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
                placeholder="repita"
              />
            )}
            <button className="idl-btn primary" disabled={busy || pin.length < 4}>
              {busy ? <LoaderCircle size={15} className="idl-spin" /> : <Lock size={15} />} Entrar
            </button>
          </>
        )}
        {error && <p className="idl-error">{error}</p>}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ conectar iPhone */

function ConnectCard({ connected, onLocked, compact }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const gerar = async () => {
    if (connected && !window.confirm('Gerar uma chave nova? O iPhone para de enviar até você colar a nova chave nele.')) return;
    setBusy(true);
    setError('');
    try {
      setKey((await api.idealSyncKey()).key);
    } catch (e) {
      if (!onLocked(e)) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* o texto continua visível para copiar à mão */
    }
  };

  return (
    <div className={`idl-connect ${compact ? 'compact' : ''}`}>
      <Smartphone size={22} />
      <h3>{connected ? 'iPhone conectado' : 'Conecte o seu iPhone'}</h3>
      <p>
        {connected
          ? 'O Ideal do iPhone envia os dados para cá sozinho enquanto o app está aberto. Gere outra chave só se trocar de iPhone.'
          : 'Gere a chave, copie e cole no iPhone em Ideal → Mais → Ajustes → Sistema Classul. Os dados chegam pela internet, de qualquer lugar.'}
      </p>
      {key ? (
        <div className="idl-key">
          <code>{key}</code>
          <button className="idl-btn" onClick={copiar}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiada' : 'Copiar'}
          </button>
          <small>A chave aparece só agora. Com o iPhone perto do Mac, copiar aqui já cola lá (área de transferência universal).</small>
        </div>
      ) : (
        <button className="idl-btn primary" onClick={gerar} disabled={busy}>
          {busy ? <LoaderCircle size={15} className="idl-spin" /> : <Smartphone size={15} />} {connected ? 'Gerar chave nova' : 'Gerar chave do iPhone'}
        </button>
      )}
      {error && <p className="idl-error">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ painel */

function ScoreDial({ a, goals }) {
  const d = a.day;
  const score = d?.score ?? 0;
  const pillars = [
    ['Água', (d?.waterML ?? 0) / Math.max(goals.waterML || 1, 1)],
    ['Treino', d?.workout ? 1 : 0],
    ['Hábitos', d && d.habitsTotal > 0 ? d.habitsDone / d.habitsTotal : 0],
    ['Sono', (d?.sleepMin ?? 0) / Math.max(goals.sleepMin || 1, 1)]
  ];
  const R = 84;
  const C = 2 * Math.PI * R;
  const arc = 0.2;
  return (
    <div className="idl-dial">
      <svg viewBox="0 0 200 200">
        <g className="idl-dial-ticks">
          {Array.from({ length: 60 }, (_, i) => (
            <line key={i} x1="100" y1={i % 5 ? 8 : 6} x2="100" y2={i % 5 ? 12 : 14} transform={`rotate(${i * 6} 100 100)`} className={i % 5 ? '' : 'major'} />
          ))}
        </g>
        {pillars.map(([label, v], i) => {
          const rot = i * 90 - 126 + 90;
          const fill = Math.min(Math.max(v, 0), 1) * arc;
          const ang = (i * Math.PI) / 2;
          return (
            <g key={label}>
              <circle cx="100" cy="100" r={R} className="idl-dial-track" strokeDasharray={`${C * arc} ${C}`} transform={`rotate(${rot - 90} 100 100)`} />
              <circle
                cx="100"
                cy="100"
                r={R}
                className={`idl-dial-arc ${v >= 1 ? 'good' : ''}`}
                strokeDasharray={`${C * fill} ${C}`}
                transform={`rotate(${rot - 90} 100 100)`}
              />
              <text x={100 + Math.sin(ang) * 62} y={100 - Math.cos(ang) * 62 + 3} className={`idl-dial-label ${v >= 1 ? 'good' : ''}`}>
                {label.toUpperCase()}
              </text>
            </g>
          );
        })}
        <circle cx="100" cy="100" r="40" className="idl-dial-core" />
        <text x="100" y="104" className="idl-dial-score">
          {Math.round(score * 100)}
        </text>
        <text x="100" y="119" className="idl-dial-sub">
          SCORE
        </text>
      </svg>
    </div>
  );
}

function WeeklyPanel({ a }) {
  const diff = (a.weekAverage - a.lastWeekAverage) * 100;
  return (
    <Panel title="Progresso semanal" right={<span className="idl-mono">{pct(a.weekAverage)}</span>}>
      <div className="idl-week">
        {a.week.map((d, i) => (
          <div key={i} className={`idl-week-col ${d.current ? 'current' : ''}`} title={d.score != null ? pct(d.score) : 'sem dado'}>
            <div className="idl-week-bar">
              <span className={d.score == null ? 'empty' : d.score >= 0.8 ? 'good' : ''} style={{ height: `${Math.max(4, (d.score ?? 0) * 100)}%` }} />
            </div>
            <small>{d.letter}</small>
          </div>
        ))}
      </div>
      <p className={`idl-note ${diff >= 0 ? 'good' : 'bad'}`}>
        {diff >= 0 ? `Consistência subiu ${Math.round(diff)} pts` : `Consistência caiu ${Math.round(-diff)} pts`} <span>vs semana anterior</span>
      </p>
    </Panel>
  );
}

function RecordsPanel({ a }) {
  const records = a.records.slice(0, 6);
  const label = Object.fromEntries(GROUPS);
  return (
    <Panel title="Recordes" right={<span className="idl-mono">{a.records.length}</span>}>
      {!records.length && <p className="idl-empty">Finalize treinos no iPhone para ver seus recordes.</p>}
      <ol className="idl-records">
        {records.map((r, i) => (
          <li key={r.name}>
            <b>{i + 1}</b>
            <span className="idl-chip">{(label[r.group] || 'Outros').slice(0, 1)}</span>
            <div>
              <p>{r.name}</p>
              <small>{r.best > 0 ? `${fmt.kg(r.best)} · +${fmt.kg(r.gain)}` : `${r.sessions} treinos`}</small>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function WeightPanel({ a, goal }) {
  const ws = a.weights;
  const W = 260;
  const H = 120;
  let chart = null;
  if (ws.length >= 2) {
    const vals = ws.map((w) => w.kg).concat(goal > 0 ? [goal] : []);
    const min = Math.min(...vals) - 0.5;
    const max = Math.max(...vals) + 0.5;
    const t0 = ws[0].date.getTime();
    const t1 = ws.at(-1).date.getTime() || t0 + 1;
    const x = (d) => 8 + ((d.getTime() - t0) / Math.max(t1 - t0, 1)) * (W - 16);
    const y = (v) => 10 + (1 - (v - min) / (max - min || 1)) * (H - 24);
    const line = ws.map((w, i) => `${i ? 'L' : 'M'}${x(w.date).toFixed(1)} ${y(w.kg).toFixed(1)}`).join(' ');
    chart = (
      <div className="idl-weight">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {goal > 0 && <line x1="0" x2={W} y1={y(goal)} y2={y(goal)} className="idl-goal-line" />}
          <path d={`${line} L${x(ws.at(-1).date)} ${H} L${x(ws[0].date)} ${H} Z`} className="idl-area" />
          <path d={line} className="idl-line" />
        </svg>
        {goal > 0 && (
          <span className="idl-goal-text" style={{ top: `${(y(goal) / H) * 100}%` }}>
            meta {fmt.kg(goal)}
          </span>
        )}
        <span className="idl-weight-dot" style={{ left: `${(x(ws.at(-1).date) / W) * 100}%`, top: `${(y(ws.at(-1).kg) / H) * 100}%` }} />
      </div>
    );
  }
  const first = ws[0];
  const last = ws.at(-1);
  return (
    <Panel
      title="Peso"
      right={first && last && ws.length > 1 ? <Delta value={last.kg - first.kg} suffix=" kg" invert={!goal || goal < first.kg} /> : null}
    >
      {last && <p className="idl-big">{fmt.kg(last.kg)}</p>}
      {chart || <p className="idl-empty">{ws.length ? 'Registre mais um peso para ver a curva.' : 'Registre seu peso no iPhone.'}</p>}
      {last && (last.bodyFat > 0 || last.waistCm > 0) && (
        <p className="idl-note">
          {last.bodyFat > 0 && <>Gordura {last.bodyFat.toLocaleString('pt-BR')}% </>}
          {last.waistCm > 0 && <>· Cintura {last.waistCm.toLocaleString('pt-BR')} cm</>}
        </p>
      )}
    </Panel>
  );
}

function VitalsPanel({ a, goals }) {
  const d = a.day;
  const steps = d?.steps ?? 0;
  const stepsGoal = goals.steps || 10000;
  const rows = [
    ['Calorias', fmt.int(d?.kcal), a.change((x) => x.kcal), (d?.kcal ?? 0) >= goals.kcal && goals.kcal > 0],
    ['Proteína (g)', fmt.int(d?.protein), a.change((x) => x.protein), (d?.protein ?? 0) >= goals.protein && goals.protein > 0],
    ['Sono', fmt.duration(d?.sleepMin), a.change((x) => x.sleepMin), (d?.sleepMin ?? 0) >= goals.sleepMin && goals.sleepMin > 0],
    ['Água', fmt.liters(d?.waterML), a.change((x) => x.waterML), (d?.waterML ?? 0) >= goals.waterML && goals.waterML > 0],
    ['Passos', fmt.int(steps), a.change((x) => x.steps ?? 0), steps >= stepsGoal],
    ['Foco', fmt.duration(d?.focusMin), a.change((x) => x.focusMin), false],
    ['Cardio', `${fmt.int(d?.cardioMin)} min`, a.change((x) => x.cardioMin), false]
  ];
  return (
    <Panel title="Vitais do dia">
      <ul className="idl-vitals">
        {rows.map(([label, value, change, hit]) => (
          <li key={label}>
            <span>{label}</span>
            <b className={hit ? 'good' : ''}>{value}</b>
            <Delta value={change} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MusclesPanel({ a }) {
  const [mode, setMode] = useState('recent');
  const recent = mode === 'recent';
  return (
    <Panel
      title="Músculos"
      right={
        <div className="idl-seg">
          <button className={recent ? 'on' : ''} onClick={() => setMode('recent')}>7 dias</button>
          <button className={!recent ? 'on' : ''} onClick={() => setMode('total')}>Desde o início</button>
        </div>
      }
    >
      <ul className="idl-muscles">
        {GROUPS.map(([g, label]) => {
          const v = recent ? a.heat(g) : a.growth(g);
          return (
            <li key={g}>
              <span>{label}</span>
              <div className="idl-meter">
                <i style={{ width: `${Math.max(2, v * 100)}%` }} className={v >= 0.8 ? 'good' : ''} />
              </div>
              <small>{pct(v)}</small>
            </li>
          );
        })}
      </ul>
      <p className="idl-note">{recent ? 'Carga recente: cada série perde metade do peso a cada 2 dias.' : 'Séries acumuladas desde o início (140 = completo).'}</p>
    </Panel>
  );
}

function Timeline({ snap, a, selected, setSelected }) {
  const days = snap.days.slice(-90);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const play = () => {
    if (playing) {
      clearInterval(timer.current);
      setPlaying(false);
      setSelected(null);
      return;
    }
    if (days.length < 2) return;
    let i = 0;
    setPlaying(true);
    timer.current = setInterval(() => {
      if (i >= days.length) {
        clearInterval(timer.current);
        setPlaying(false);
        setSelected(null);
        return;
      }
      setSelected(days[i].date);
      i += 1;
    }, Math.max(40, Math.min(120, 6000 / days.length)));
  };

  const workouts = snap.days.filter((d) => d.workout && d.date <= a.asOf).length;
  const today = startOfDay(new Date());
  return (
    <Panel
      className="idl-timeline"
      title="Evolução"
      right={
        <div className="idl-timeline-stats">
          <span>Dia <b>{fmt.dayMonth(a.asOf)}</b></span>
          <span>Score <b>{pct(a.day?.score)}</b></span>
          <span>Treinos <b>{workouts}</b></span>
          {selected && (
            <button className="idl-link" onClick={() => setSelected(null)}>
              voltar para hoje
            </button>
          )}
          <button className="idl-icon sm" onClick={play} title={playing ? 'Parar' : 'Rever a evolução'}>
            {playing ? <Square size={12} /> : <Play size={12} />}
          </button>
        </div>
      }
    >
      {!days.length ? (
        <p className="idl-empty">Sem dados ainda.</p>
      ) : (
        <div className="idl-bars">
          {days.map((d) => {
            const sel = sameDay(d.date, a.asOf);
            const tone = sel ? 'sel' : d.score >= 0.8 ? 'good' : d.score < 0.5 && !sameDay(d.date, today) ? 'bad' : '';
            return (
              <button
                key={d.date.getTime()}
                className={`idl-bar ${tone}`}
                style={{ '--h': `${Math.max(6, d.score * 100)}%` }}
                title={`${fmt.weekday(d.date)} ${fmt.dayMonth(d.date)} · ${pct(d.score)}${d.workout ? ' · treino' : ''}`}
                onClick={() => setSelected(sameDay(d.date, days.at(-1).date) ? null : d.date)}
              >
                {d.workout && <i />}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Dashboard({ snap }) {
  const [selected, setSelected] = useState(null);
  const a = useMemo(() => analytics(snap, selected), [snap, selected]);
  const lastW = a.weights.at(-1);
  return (
    <div className="idl-grid">
      <div className="idl-col">
        <WeeklyPanel a={a} />
        <RecordsPanel a={a} />
      </div>
      <div className="idl-col idl-center">
        <ScoreDial a={a} goals={snap.goals} />
        <div className="idl-floats">
          <div>
            <span>Sequência</span>
            <b>
              {a.streak} {a.streak === 1 ? 'dia' : 'dias'}
            </b>
          </div>
          <div>
            <span>Peso</span>
            <b>{lastW ? fmt.kg(lastW.kg) : '—'}</b>
          </div>
          <div>
            <span>Volume 7d</span>
            <b>{fmt.tons(a.volume7d)}</b>
            {a.volumePrev7d > 0 && <Delta value={((a.volume7d - a.volumePrev7d) / a.volumePrev7d) * 100} />}
          </div>
          <div>
            <span>Treinos 7d</span>
            <b>{a.workoutsThisWeek}</b>
          </div>
          <div>
            <span>Hábitos</span>
            <b>{a.day ? `${a.day.habitsDone}/${a.day.habitsTotal}` : '—'}</b>
          </div>
        </div>
        <MusclesPanel a={a} />
      </div>
      <div className="idl-col">
        <WeightPanel a={a} goal={snap.goals.weightKg} />
        <VitalsPanel a={a} goals={snap.goals} />
      </div>
      <Timeline snap={snap} a={a} selected={selected} setSelected={setSelected} />
    </div>
  );
}

/* ------------------------------------------------------------------ tela */

export default function Ideal({ onAuthError, onExit }) {
  const [unlocked, setUnlocked] = useState(false);
  const [data, setData] = useState(null); // { snapshot, received_at, device, connected }
  const [page, setPage] = useState(() => {
    try {
      return localStorage.getItem('classul_ideal_page') || 'hoje';
    } catch {
      return 'hoje';
    }
  });
  const [showQueue, setShowQueue] = useState(false);
  const [hidden, setHidden] = useState(() => new Set());
  const go = (id) => {
    setPage(id);
    try {
      localStorage.setItem('classul_ideal_page', id);
    } catch {
      /* só conveniência */
    }
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [, tick] = useState(0);

  const onLocked = useCallback(
    (err) => {
      if (err instanceof AuthError) {
        onAuthError?.(err);
        return true;
      }
      if (err instanceof IdealLockError) {
        setIdealToken('');
        setUnlocked(false);
        return true;
      }
      return false;
    },
    [onAuthError]
  );

  const load = useCallback(
    async (silent) => {
      if (!silent) setLoading(true);
      try {
        setData(await api.idealSnapshot());
        setError('');
      } catch (e) {
        if (!onLocked(e) && !silent) setError(e.message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [onLocked]
  );

  // Se o token da sessão ainda vale, entra direto.
  useEffect(() => {
    api
      .idealSnapshot()
      .then((d) => {
        setData(d);
        setUnlocked(true);
      })
      .catch((e) => onLocked(e));
  }, [onLocked]);

  useEffect(() => {
    if (!unlocked) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) load(true);
      tick((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [unlocked, load]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '') && onExit();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onExit]);

  const actions = data?.actions || [];
  const raw = useMemo(() => applyPending(data?.snapshot, data?.actions), [data]);
  const snap = useMemo(() => prepare(raw), [raw]);
  const pending = actions.filter((a) => !a.applied_at);
  const failed = actions.filter((a) => a.ok === false && !hidden.has(a.id));

  // Alteração feita aqui: vai para a fila e já aparece na tela.
  const act = useCallback(
    async (type, payload) => {
      try {
        const a = await api.idealAction(type, payload);
        setData((d) => (d ? { ...d, actions: [...(d.actions || []), a] } : d));
      } catch (e) {
        if (!onLocked(e)) setError(e.message);
      }
    },
    [onLocked]
  );
  const undo = async (a) => {
    try {
      await api.idealCancelAction(a.id);
      setData((d) => ({ ...d, actions: d.actions.filter((x) => x.id !== a.id) }));
    } catch (e) {
      if (!onLocked(e)) setError(e.message);
      load(true);
    }
  };
  const received = data?.received_at ? new Date(data.received_at) : null;
  const fresh = received && Date.now() - received < 5 * 60000;

  let body;
  if (!unlocked) {
    body = (
      <Gate
        onExit={onExit}
        onAuthError={(e) => onLocked(e)}
        onUnlocked={() => {
          setUnlocked(true);
          load();
        }}
      />
    );
  } else {
    body = (
      <>
        <header className="idl-top">
          <div className="idl-brand">
            <IdealMark columns={24} className="idl-brand-mark" />
            <span>Ideal</span>
          </div>
          <nav className="idl-pages">
            {PAGES.map(([id, label, Icon]) => (
              <button key={id} className={page === id ? 'on' : ''} onClick={() => go(id)}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </nav>
          <button className={`idl-sync ${fresh ? 'live' : ''}`} onClick={() => setShowConnect((v) => !v)} title="Conexão com o iPhone">
            <i />
            {received ? `${data.device || 'iPhone'} · ${fmt.ago(received)}` : data?.connected ? 'aguardando o iPhone' : 'iPhone não conectado'}
          </button>
          <div className="idl-top-right">
            {snap?.userName && <span className="idl-user">{snap.userName}</span>}
            <button className="idl-icon" onClick={() => load()} title="Atualizar">
              <RefreshCw size={15} className={loading ? 'idl-spin' : ''} />
            </button>
            <button
              className="idl-icon"
              title="Trancar"
              onClick={() => {
                setIdealToken('');
                setUnlocked(false);
              }}
            >
              <Lock size={15} />
            </button>
            <button className="idl-icon" onClick={onExit} title="Fechar (Esc)">
              <X size={17} />
            </button>
          </div>
        </header>

        <main className="idl-main">
          {error && <p className="idl-error">{error}</p>}
          {(showConnect || (data && !snap)) && <ConnectCard connected={Boolean(data?.connected)} onLocked={onLocked} compact={Boolean(snap)} />}
          {(pending.length > 0 || failed.length > 0) && (
            <div className={`idl-queue ${failed.length ? 'has-error' : ''}`}>
              <button className="idl-queue-head" onClick={() => setShowQueue((v) => !v)}>
                {failed.length ? <AlertTriangle size={14} /> : <CloudUpload size={14} />}
                {pending.length > 0 && (
                  <span>
                    {pending.length} {pending.length === 1 ? 'alteração esperando' : 'alterações esperando'} o iPhone abrir o Ideal
                  </span>
                )}
                {failed.length > 0 && <span className="bad">{failed.length} não {failed.length === 1 ? 'entrou' : 'entraram'} no iPhone</span>}
                <small>{showQueue ? 'esconder' : 'ver'}</small>
              </button>
              {showQueue && (
                <ul>
                  {failed.map((a) => (
                    <li key={a.id} className="bad">
                      <span>{describeAction(a, data?.snapshot)} — {a.error}</span>
                      <button className="idl-link" onClick={() => setHidden((h) => new Set([...h, a.id]))}>ok</button>
                    </li>
                  ))}
                  {pending.map((a) => (
                    <li key={a.id}>
                      <span>{describeAction(a, raw)}</span>
                      <button className="idl-link" onClick={() => undo(a)}>
                        <Undo2 size={11} /> desfazer
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {snap && page === 'hoje' && <Today raw={raw} act={act} />}
          {snap && page === 'rotina' && <Routine raw={raw} act={act} />}
          {snap && page === 'treino' && <Workout snap={snap} raw={raw} />}
          {snap && page === 'painel' && <Dashboard snap={snap} />}
          {snap && page === 'objetivos' && <Goals snap={snap} act={act} />}
          {snap && page === 'ideias' && <Ideas snap={snap} act={act} />}
          {snap && page === 'metas' && <Targets raw={raw} act={act} />}
          {!data && !error && (
            <p className="idl-empty center">
              <LoaderCircle size={16} className="idl-spin" /> carregando…
            </p>
          )}
        </main>
      </>
    );
  }

  return createPortal(<div className="idl">{body}</div>, document.body);
}

