import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Lock, Smartphone, Copy, Check, RefreshCw, LoaderCircle, LayoutGrid, Brain, Target, Play, Square } from 'lucide-react';
import { api, setIdealToken, IdealLockError, AuthError } from '../api';
import { IdealMark } from './mark';
import { analytics, prepare, GROUPS, fmt, sameDay, startOfDay } from './analytics';
import './ideal.css';

// Ideal na web: o painel do app do Mac, com os dados que o iPhone manda para o
// sistema. Área secreta (entra pelo morcego do rodapé) com senha própria.

const POLL_MS = 30000;
const PAGES = [
  ['painel', 'Painel', LayoutGrid],
  ['ideias', 'Ideias', Brain],
  ['objetivos', 'Objetivos', Target]
];

/* ------------------------------------------------------------------ peças */

function Panel({ title, right, children, className = '' }) {
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

function Delta({ value, suffix = '%', invert = false }) {
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

/* ------------------------------------------------------------------ ideias e objetivos */

function IdeasPage({ snap }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const idea of snap.ideas) {
      const k = startOfDay(idea.date).getTime();
      map.set(k, [...(map.get(k) || []), idea]);
    }
    return [...map.entries()].sort((x, y) => y[0] - x[0]);
  }, [snap.ideas]);
  if (!groups.length) return <p className="idl-empty center">Registre ideias no iPhone (Mais → Ideias) para acender o megabrain.</p>;
  return (
    <div className="idl-ideas">
      <p className="idl-kicker">{snap.ideas.length} NEURÔNIOS</p>
      {groups.map(([k, list]) => {
        const d = new Date(k);
        return (
          <section key={k}>
            <h4>
              {fmt.weekday(d)} {fmt.dayMonth(d)} <span>{list.length}</span>
            </h4>
            {list.map((idea) => (
              <article key={idea.id} className="idl-idea">
                <small>{fmt.time(idea.date)}</small>
                <p>{idea.text}</p>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function GoalCard({ goal }) {
  const days = goal.deadline ? Math.ceil((startOfDay(goal.deadline) - startOfDay(new Date())) / 86400000) : null;
  return (
    <article className={`idl-goal ${goal.done ? 'done' : ''}`} style={goal.photo ? { '--photo': `url(data:image/jpeg;base64,${goal.photo})` } : undefined}>
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
    </article>
  );
}

function GoalsPage({ snap }) {
  const active = snap.objectives.filter((o) => !o.done);
  const done = snap.objectives.filter((o) => o.done);
  if (!snap.objectives.length) return <p className="idl-empty center">Crie objetivos com fotos no iPhone (Mais → Objetivos).</p>;
  return (
    <div className="idl-goals-page">
      <h2>Lembre por que você começou</h2>
      <p className="idl-mono muted">
        {active.length} ativos · {done.length} conquistados
      </p>
      <div className="idl-goals">
        {[...active, ...done].map((g, i) => (
          <GoalCard key={`${g.title}-${i}`} goal={g} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tela */

export default function Ideal({ onAuthError, onExit }) {
  const [unlocked, setUnlocked] = useState(false);
  const [data, setData] = useState(null); // { snapshot, received_at, device, connected }
  const [page, setPage] = useState('painel');
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

  const snap = useMemo(() => prepare(data?.snapshot), [data]);
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
              <button key={id} className={page === id ? 'on' : ''} onClick={() => setPage(id)}>
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
          {snap && page === 'painel' && <Dashboard snap={snap} />}
          {snap && page === 'ideias' && <IdeasPage snap={snap} />}
          {snap && page === 'objetivos' && <GoalsPage snap={snap} />}
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

