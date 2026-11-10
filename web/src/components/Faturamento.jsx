import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CircleDollarSign, FileText, TrendingUp, TrendingDown, Ban, Package, Ruler, Users, MapPin, Wallet, Layers, Boxes,
  LoaderCircle, Search, ChevronLeft, ChevronRight, X, CalendarDays, Filter, Download, ArrowLeft, UserPlus, CalendarRange
} from 'lucide-react';
import { faturamentoApi } from '../api';
import { useToast } from './Toast';

// ------------------------------------------------------------------ formatos

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const brl0 = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const numero = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const brlCurto = (n) => {
  const v = Math.abs(n);
  if (v >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: v >= 1e4 ? 0 : 1 })} mil`;
  return `R$ ${Math.round(n)}`;
};
const numCurto = (n) => (Math.abs(n) >= 1e3 ? `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : numero(Math.round(n)));
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const hojeSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const addDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fimDoMes = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5);
const dm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const dmy = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
const diaSemana = (dia) => DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()];
const dataBR = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtDoc = (d) => {
  const s = String(d || '');
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return s;
};

const ehMesInteiro = (de, ate) => de.endsWith('-01') && ate === fimDoMes(de.slice(0, 7));
const ehAnoInteiro = (de, ate) => de.endsWith('-01-01') && ate.endsWith('-12-31') && de.slice(0, 4) === ate.slice(0, 4);

// Nome do período em português ("Novembro de 2026", "Ano de 2025", "03/11 a 09/11/2026").
function nomePeriodo(de, ate) {
  if (ehAnoInteiro(de, ate)) return `Ano de ${de.slice(0, 4)}`;
  if (ehMesInteiro(de, ate)) return `${cap(MESES_LONGOS[Number(de.slice(5, 7)) - 1])} de ${de.slice(0, 4)}`;
  if (de === ate) return dmy(de);
  if (de.slice(0, 4) === ate.slice(0, 4)) return `${dm(de)} a ${dmy(ate)}`;
  return `${dmy(de)} a ${dmy(ate)}`;
}
// Rótulo curto de um ponto da série (eixo) e longo (dica).
function rotuloPonto(chave, g, longo = false) {
  if (g === 'ano') return chave;
  if (g === 'mes') {
    const m = Number(chave.slice(5, 7)) - 1;
    return longo ? `${cap(MESES_LONGOS[m])} de ${chave.slice(0, 4)}` : `${MESES[m]}/${chave.slice(2, 4)}`;
  }
  if (g === 'semana') return longo ? `Semana de ${dm(chave)} a ${dmy(addDias(chave, 6))}` : dm(chave);
  return longo ? `${cap(diaSemana(chave))}, ${dmy(chave)}` : dm(chave);
}
// Intervalo de um ponto clicado (para "entrar" nele).
function intervaloDoPonto(chave, g) {
  if (g === 'ano') return { de: `${chave}-01-01`, ate: `${chave}-12-31` };
  if (g === 'mes') return { de: `${chave}-01`, ate: fimDoMes(chave) };
  if (g === 'semana') return { de: chave, ate: addDias(chave, 6) };
  return { de: chave, ate: chave };
}

// Cores fixas por entidade: a categoria tem sempre a mesma cor, o ano também.
const CORES_CATEGORIA = {
  Placas: 'var(--viz-1)', Estojos: 'var(--viz-2)', Medalhas: 'var(--viz-3)', 'Troféus': 'var(--viz-4)',
  'Pins e botons': 'var(--viz-5)', 'Crachás': 'var(--viz-6)', 'Quadros e molduras': 'var(--viz-7)'
};
const corCategoria = (c) => CORES_CATEGORIA[c] || 'var(--viz-demais)';
const corAno = (ano) => `var(--viz-${(((Number(ano) - 2024) % 8) + 8) % 8 + 1})`;

// Escala "redonda" para o eixo.
function escala(max, n = 4) {
  if (max <= 0) return { topo: 1, passos: [0, 1] };
  const bruto = max / n;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((s) => s >= bruto) || 10 * pot;
  const topo = Math.ceil(max / passo) * passo;
  return { topo, passos: Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo) };
}

function useLargura() {
  const ref = useRef(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    setW(ref.current.getBoundingClientRect().width || 640);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ------------------------------------------------------------------ peças visuais

const card = 'bg-white rounded-3xl border border-black/5 shadow-sm min-w-0';

function Cabecalho({ icon: Icon, titulo, dica, children }) {
  return (
    <div className="px-5 sm:px-6 pt-5 pb-3 flex flex-wrap items-start gap-3">
      <div className="mr-auto min-w-0">
        <h3 className="font-extrabold tracking-tight text-brand-950 text-sm flex items-center gap-2">
          {Icon && <Icon size={15} className="text-brand-600" />} {titulo}
        </h3>
        {dica && <p className="text-[11px] font-medium text-slate-400 mt-0.5">{dica}</p>}
      </div>
      {children}
    </div>
  );
}

function Segmentos({ opcoes, valor, onChange, pequeno }) {
  return (
    <div className="inline-flex bg-black/[0.04] rounded-full p-0.5 flex-wrap">
      {opcoes.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={valor === v}
          className={`rounded-full font-bold transition-colors ${pequeno ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} ${
            valor === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-brand-800'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, tone = 'brand' }) {
  const tones = { brand: 'bg-brand-100 text-brand-700', slate: 'bg-black/[0.04] text-slate-500', amber: 'bg-sun-100 text-yellow-700' };
  return (
    <div className={`${card} p-5 min-w-0`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`}>
          <Icon size={15} />
        </span>
        <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest truncate">{label}</p>
      </div>
      <p className="text-2xl font-extrabold tracking-tight text-brand-950 leading-none truncate">{value}</p>
      {sub && <div className="text-xs font-semibold text-slate-400 mt-1.5">{sub}</div>}
    </div>
  );
}

// Variação em relação a outro período (texto + ícone, nunca só cor).
function Variacao({ atual, base, rotuloBase, fmt = brl0 }) {
  if (!base) return <span>sem {rotuloBase} para comparar</span>;
  const pct = ((atual - base) / base) * 100;
  const sobe = pct >= 0;
  const Icon = sobe ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${sobe ? 'text-brand-700' : 'text-flame-600'}`}>
      <Icon size={12} /> {sobe ? '+' : ''}
      {pct.toFixed(0)}% <span className="text-slate-400">vs {rotuloBase} ({fmt(base)})</span>
    </span>
  );
}

function Legenda({ itens, onClick }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 sm:px-6 pb-1">
      {itens.map((i) => (
        <button
          key={i.chave}
          onClick={onClick ? () => onClick(i.chave) : undefined}
          aria-pressed={onClick ? !i.apagado : undefined}
          className={`flex items-center gap-1.5 text-[11px] font-bold ${i.apagado ? 'text-slate-300' : 'text-slate-500'} ${onClick ? 'hover:text-brand-800' : 'cursor-default'}`}
        >
          {i.tracejado ? (
            <svg width="16" height="8" aria-hidden><line x1="0" y1="4" x2="16" y2="4" stroke={i.cor} strokeWidth="2" strokeDasharray="4 3" /></svg>
          ) : (
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: i.apagado ? 'transparent' : i.cor, border: `2px solid ${i.cor}` }} />
          )}
          {i.rotulo}
        </button>
      ))}
    </div>
  );
}

function Dica({ x, largura, children }) {
  const esquerda = x > largura - 200;
  return (
    <div
      className="absolute top-1 z-10 pointer-events-none bg-white border border-black/5 shadow-lg rounded-xl px-3 py-2 text-xs min-w-[160px]"
      style={esquerda ? { right: Math.max(0, largura - x + 12) } : { left: x + 12 }}
    >
      {children}
    </div>
  );
}

/**
 * Barras (simples ou empilhadas) com linha de comparação opcional.
 * dados: [{ chave, rotulo, segs: [{ chave, valor, cor }], comparacao? }]
 */
function Barras({ dados, altura = 230, fmtEixo, dica, onClick, realce, vazio = 'Nada no período.' }) {
  const [ref, w] = useLargura();
  const [hover, setHover] = useState(null);
  const m = { l: 58, r: 10, t: 12, b: 26 };
  const pw = Math.max(50, w - m.l - m.r);
  const ph = altura - m.t - m.b;
  const n = dados.length || 1;
  const banda = pw / n;
  const barW = Math.max(2, Math.min(56, banda * (banda > 14 ? 0.72 : 0.86)));
  const somaDe = (d) => d.segs.reduce((s, x) => s + Math.max(0, x.valor), 0);
  const temComparacao = dados.some((d) => d.comparacao != null);
  const max = Math.max(...dados.map((d) => Math.max(somaDe(d), temComparacao ? d.comparacao || 0 : 0)), 0);
  const { topo, passos } = escala(max);
  const y = (v) => m.t + ph - (v / topo) * ph;
  const cx = (i) => m.l + banda * i + banda / 2;
  const cadaRotulo = Math.max(1, Math.ceil(46 / banda));
  const tudoZero = max === 0;

  return (
    <div ref={ref} className="relative select-none w-full min-w-0" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={altura} role="img" aria-label="gráfico de barras" className="block overflow-visible">
        {passos.map((p) => (
          <g key={p}>
            <line x1={m.l} x2={m.l + pw} y1={y(p)} y2={y(p)} stroke="currentColor" className="text-black/5" />
            <text x={m.l - 8} y={y(p)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] font-semibold">
              {fmtEixo(p)}
            </text>
          </g>
        ))}
        {hover != null && <rect x={m.l + banda * hover} y={m.t} width={banda} height={ph} className="fill-black/[0.03]" />}
        {dados.map((d, i) => {
          let topoAtual = 0;
          const segs = d.segs.filter((s) => s.valor > 0);
          const forte = realce && d.chave === realce;
          return (
            <g key={d.chave} opacity={realce && !forte && hover !== i ? 0.55 : 1}>
              {segs.map((s, k) => {
                const y0 = y(topoAtual);
                topoAtual += s.valor;
                const y1 = y(topoAtual);
                const ultimo = k === segs.length - 1;
                const h = Math.max(ultimo ? 1.5 : 0, y0 - y1 - (ultimo ? 0 : 2));
                const x = cx(i) - barW / 2;
                const r = ultimo ? Math.min(4, barW / 2, h) : 0;
                const top = y0 - h;
                return (
                  <path
                    key={s.chave}
                    d={`M${x},${y0} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y0} Z`}
                    style={{ fill: s.cor }}
                  />
                );
              })}
            </g>
          );
        })}
        {temComparacao && dados.length > 1 && (
          <polyline
            points={dados.map((d, i) => `${cx(i)},${y(d.comparacao || 0)}`).join(' ')}
            fill="none"
            stroke="var(--viz-comparacao)"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        )}
        {temComparacao && dados.length === 1 && (
          <line x1={cx(0) - barW / 2 - 6} x2={cx(0) + barW / 2 + 6} y1={y(dados[0].comparacao || 0)} y2={y(dados[0].comparacao || 0)} stroke="var(--viz-comparacao)" strokeWidth="2" strokeDasharray="5 4" />
        )}
        <line x1={m.l} x2={m.l + pw} y1={m.t + ph} y2={m.t + ph} stroke="currentColor" className="text-black/10" />
        {dados.map((d, i) =>
          i % cadaRotulo === 0 ? (
            <text key={d.chave} x={cx(i)} y={altura - 8} textAnchor="middle" className={`text-[10px] font-bold ${realce === d.chave ? 'fill-brand-700' : 'fill-slate-400'}`}>
              {d.rotulo}
            </text>
          ) : null
        )}
        {dados.map((d, i) => (
          <rect
            key={d.chave}
            x={m.l + banda * i}
            y={m.t}
            width={banda}
            height={ph + m.b}
            fill="transparent"
            className={onClick ? 'cursor-pointer' : ''}
            onMouseEnter={() => setHover(i)}
            onClick={onClick ? () => onClick(d.chave) : undefined}
          />
        ))}
      </svg>
      {tudoZero && <p className="absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-400 pointer-events-none">{vazio}</p>}
      {hover != null && dados[hover] && (
        <Dica x={cx(hover)} largura={w}>
          {dica(dados[hover])}
        </Dica>
      )}
    </div>
  );
}

/** Linhas (um ponto por mês, uma linha por ano) com cruz de leitura. */
function Linhas({ series, rotulos, fmtEixo, fmtValor, altura = 250, rotuloDica }) {
  const [ref, w] = useLargura();
  const [hover, setHover] = useState(null);
  const m = { l: 58, r: 14, t: 12, b: 26 };
  const pw = Math.max(50, w - m.l - m.r);
  const ph = altura - m.t - m.b;
  const n = rotulos.length;
  const x = (i) => m.l + (n > 1 ? (pw * i) / (n - 1) : pw / 2);
  const max = Math.max(0, ...series.flatMap((s) => s.valores.filter((v) => v != null)));
  const { topo, passos } = escala(max);
  const y = (v) => m.t + ph - (v / topo) * ph;
  const caminho = (vals) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v == null) return;
      d += `${d && vals[i - 1] != null ? 'L' : 'M'}${x(i)},${y(v)} `;
    });
    return d;
  };
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - m.l) / pw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div ref={ref} className="relative select-none w-full min-w-0" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={altura} className="block overflow-visible" onMouseMove={mover} role="img" aria-label="gráfico de linhas">
        {passos.map((p) => (
          <g key={p}>
            <line x1={m.l} x2={m.l + pw} y1={y(p)} y2={y(p)} stroke="currentColor" className="text-black/5" />
            <text x={m.l - 8} y={y(p)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] font-semibold">
              {fmtEixo(p)}
            </text>
          </g>
        ))}
        {rotulos.map((r, i) => (
          <text key={r} x={x(i)} y={altura - 8} textAnchor="middle" className="fill-slate-400 text-[10px] font-bold">
            {pw / n < 26 && i % 2 ? '' : r}
          </text>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ph} stroke="currentColor" className="text-black/15" />}
        {series.map((s) => (
          <path key={s.chave} d={caminho(s.valores)} fill="none" style={{ stroke: s.cor }} strokeWidth={s.grosso ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover != null &&
          series.map((s) =>
            s.valores[hover] != null ? (
              <circle key={s.chave} cx={x(hover)} cy={y(s.valores[hover])} r="4.5" style={{ fill: s.cor, stroke: 'var(--viz-superficie)' }} strokeWidth="2" />
            ) : null
          )}
        <rect x={m.l} y={m.t} width={pw} height={ph} fill="transparent" />
      </svg>
      {hover != null && (
        <Dica x={x(hover)} largura={w}>
          <p className="font-extrabold text-brand-950 mb-1">{rotuloDica(hover)}</p>
          {series
            .filter((s) => s.valores[hover] != null)
            .sort((a, b) => b.valores[hover] - a.valores[hover])
            .map((s) => (
              <p key={s.chave} className="flex items-center gap-2 font-semibold text-slate-500">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.cor }} />
                <span className="mr-auto">{s.chave}</span>
                <span className="font-extrabold text-brand-950">{fmtValor(s.valores[hover])}</span>
              </p>
            ))}
        </Dica>
      )}
    </div>
  );
}

// Lista com barra proporcional; clicar numa linha filtra o painel por ela.
function Ranking({ icon: Icon, titulo, dica, linhas, unidade = 'un.', vazio, mostrarUnidades = true, limite = 8, onClick, ativo, cor }) {
  const [todos, setTodos] = useState(false);
  const max = Math.max(...linhas.map((r) => r.total), 1);
  const total = linhas.reduce((s, r) => s + r.total, 0) || 1;
  const visiveis = todos ? linhas : linhas.slice(0, limite);
  return (
    <section className={`${card} overflow-hidden`}>
      <Cabecalho icon={Icon} titulo={titulo} dica={dica} />
      {!linhas.length ? (
        <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">{vazio}</p>
      ) : (
        <div className="divide-y divide-black/5 border-t border-black/5">
          {visiveis.map((r) => {
            const sel = ativo === r.chave;
            return (
              <button
                key={r.chave}
                onClick={onClick ? () => onClick(r.chave) : undefined}
                title={onClick ? (sel ? 'Tirar este filtro' : `Filtrar por ${r.chave}`) : undefined}
                className={`w-full px-5 sm:px-6 py-2.5 flex items-center gap-3 text-sm text-left ${onClick ? 'hover:bg-brand-50/60' : 'cursor-default'} ${sel ? 'bg-brand-50' : ''}`}
              >
                {cor && <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: cor(r.chave) }} />}
                <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{r.chave}</span>
                {mostrarUnidades && r.unidades !== undefined && (
                  <span className="hidden sm:inline text-[11px] font-bold text-slate-400 shrink-0 w-16 text-right">
                    {numero(r.unidades)} {unidade}
                  </span>
                )}
                <span className="hidden sm:block w-20 h-2 rounded-full bg-brand-100 overflow-hidden shrink-0">
                  <span className="block h-full rounded-full" style={{ width: `${(r.total / max) * 100}%`, background: 'var(--viz-barra)' }} />
                </span>
                <span className="text-[11px] font-bold text-slate-400 w-9 text-right shrink-0">{Math.round((r.total / total) * 100)}%</span>
                <span className="font-extrabold text-brand-700 text-xs w-24 text-right shrink-0">{brl(r.total)}</span>
              </button>
            );
          })}
          {linhas.length > limite && (
            <button onClick={() => setTodos((v) => !v)} className="w-full px-6 py-2.5 text-xs font-bold text-brand-700 hover:bg-brand-50/50 text-left">
              {todos ? 'Mostrar menos' : `Ver todos (${linhas.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ filtros

const SEM_FILTRO = { categoria: '', tamanho: '', material: '', produto: '', uf: '', tipo: '', pagamento: '', cliente: '' };

function presetDe(id, primeira) {
  const h = hojeSP();
  const y = Number(h.slice(0, 4));
  switch (id) {
    case 'mes': return { de: `${h.slice(0, 7)}-01`, ate: fimDoMes(h.slice(0, 7)) };
    case 'mes_passado': {
      const p = addDias(`${h.slice(0, 7)}-01`, -1).slice(0, 7);
      return { de: `${p}-01`, ate: fimDoMes(p) };
    }
    case '30d': return { de: addDias(h, -29), ate: h };
    case '90d': return { de: addDias(h, -89), ate: h };
    case '12m': return { de: `${addDias(`${h.slice(0, 7)}-01`, -330).slice(0, 7)}-01`, ate: fimDoMes(h.slice(0, 7)) };
    case 'ano': return { de: `${y}-01-01`, ate: `${y}-12-31` };
    case 'ano_passado': return { de: `${y - 1}-01-01`, ate: `${y - 1}-12-31` };
    case 'tudo': return { de: primeira || `${y - 5}-01-01`, ate: `${y}-12-31` };
    default: return null;
  }
}
const PRESETS = [
  ['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['30d', '30 dias'], ['90d', '90 dias'],
  ['12m', '12 meses'], ['ano', 'Este ano'], ['ano_passado', 'Ano passado'], ['tudo', 'Tudo']
];

// Anda um período para trás/frente do mesmo tamanho.
function andar(de, ate, dir) {
  if (ehAnoInteiro(de, ate)) {
    const y = Number(de.slice(0, 4)) + dir;
    return { de: `${y}-01-01`, ate: `${y}-12-31` };
  }
  if (ehMesInteiro(de, ate)) {
    const ref = dir < 0 ? addDias(de, -1) : addDias(ate, 1);
    return { de: `${ref.slice(0, 7)}-01`, ate: fimDoMes(ref.slice(0, 7)) };
  }
  const n = diasEntre(de, ate) + 1;
  return { de: addDias(de, dir * n), ate: addDias(ate, dir * n) };
}

const ROTULO_FILTRO = { categoria: 'Produto', tamanho: 'Tamanho', material: 'Material', produto: 'Descrição', uf: 'Estado', tipo: 'Cliente', pagamento: 'Pagamento', cliente: 'Cliente' };
const valorFiltro = (k, v) => (k === 'tipo' ? (v === 'pf' ? 'Pessoa física' : 'Empresa') : v);

function Select({ label, value, onChange, opcoes }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`border-2 rounded-xl px-2.5 py-1.5 text-sm font-semibold outline-none bg-white min-w-0 ${value ? 'border-brand-400 text-brand-900' : 'border-slate-200 text-slate-600'} focus:border-brand-500`}
      >
        <option value="">Todos</option>
        {opcoes.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
      </select>
    </label>
  );
}

function CampoTexto({ label, value, onChange, placeholder }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return undefined;
    const t = setTimeout(() => onChange(v.trim()), 450);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{label}</span>
      <span className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={placeholder}
          className={`w-full border-2 rounded-xl pl-7 pr-2.5 py-1.5 text-sm font-semibold outline-none bg-white ${value ? 'border-brand-400' : 'border-slate-200'} focus:border-brand-500`}
        />
      </span>
    </label>
  );
}

// ------------------------------------------------------------------ gráficos do painel

const METRICAS = {
  total: { rotulo: 'Faturamento', fmt: brl, eixo: brlCurto, comp: 'ano_passado' },
  notas: { rotulo: 'Notas', fmt: (n) => `${numero(n)} nota${n === 1 ? '' : 's'}`, eixo: numCurto, comp: 'notas_ano_passado' },
  ticket_medio: { rotulo: 'Ticket médio', fmt: brl, eixo: brlCurto },
  unidades: { rotulo: 'Unidades', fmt: (n) => `${numero(n)} un.`, eixo: numCurto },
  clientes_novos: { rotulo: 'Clientes novos', fmt: (n) => `${numero(n)} cliente${n === 1 ? '' : 's'} novo${n === 1 ? '' : 's'}`, eixo: numCurto }
};

function GraficoTempo({ dados, granularidade, onGranularidade, onEntrar }) {
  const [metrica, setMetrica] = useState('total');
  const [comparar, setComparar] = useState(true);
  const M = METRICAS[metrica];
  const g = dados.filtros.granularidade;
  const podeComparar = Boolean(M.comp);
  const pontos = dados.serie.map((p) => ({
    chave: p.chave,
    rotulo: rotuloPonto(p.chave, g),
    segs: [{ chave: 'v', valor: p[metrica], cor: 'var(--viz-barra)' }],
    comparacao: podeComparar && comparar ? p[M.comp] : null,
    p
  }));
  const pas = dados.resumo.ano_passado;
  const nDias = diasEntre(dados.filtros.de, dados.filtros.ate) + 1;
  const grans = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['ano', 'Ano']].filter(([k]) =>
    k === 'dia' ? nDias <= 400 : k === 'semana' ? nDias <= 1100 && nDias > 7 : k === 'mes' ? nDias > 31 : nDias > 365
  );
  return (
    <section className={card}>
      <Cabecalho
        icon={CalendarRange}
        titulo={`${M.rotulo} por ${{ dia: 'dia', semana: 'semana', mes: 'mês', ano: 'ano' }[g]}`}
        dica={g === 'dia' ? 'Passe o mouse para ver os números.' : 'Passe o mouse para ver os números · clique numa barra para abrir aquele período.'}
      >
        <div className="flex flex-wrap gap-2 items-center">
          <Segmentos pequeno opcoes={grans} valor={granularidade || g} onChange={onGranularidade} />
        </div>
      </Cabecalho>
      <div className="px-5 sm:px-6 pb-2 flex flex-wrap items-center gap-2">
        <Segmentos pequeno opcoes={Object.entries(METRICAS).map(([k, v]) => [k, v.rotulo])} valor={metrica} onChange={setMetrica} />
        {podeComparar && (
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 ml-auto cursor-pointer">
            <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} className="accent-brand-600" />
            comparar com o ano anterior
          </label>
        )}
      </div>
      {podeComparar && comparar && (
        <Legenda
          itens={[
            { chave: 'a', rotulo: nomePeriodo(dados.filtros.de, dados.filtros.ate), cor: 'var(--viz-barra)' },
            { chave: 'b', rotulo: `Mesmo período de ${pas.de.slice(0, 4)}${pas.de.slice(0, 4) !== pas.ate.slice(0, 4) ? `/${pas.ate.slice(2, 4)}` : ''}`, cor: 'var(--viz-comparacao)', tracejado: true }
          ]}
        />
      )}
      <div className="px-2 sm:px-4 pb-4 pt-2">
        <Barras
          dados={pontos}
          altura={250}
          fmtEixo={M.eixo}
          onClick={g === 'dia' ? undefined : (k) => onEntrar(intervaloDoPonto(k, g))}
          dica={(d) => (
            <>
              <p className="font-extrabold text-brand-950 mb-1">{rotuloPonto(d.chave, g, true)}</p>
              <p className="font-semibold text-slate-500">Faturado: <b className="text-brand-950">{brl(d.p.total)}</b></p>
              <p className="font-semibold text-slate-500">{d.p.notas} nota{d.p.notas !== 1 ? 's' : ''} · ticket {brl0(d.p.ticket_medio)}</p>
              <p className="font-semibold text-slate-500">{numero(d.p.unidades)} un. · {d.p.clientes_novos} cliente{d.p.clientes_novos !== 1 ? 's' : ''} novo{d.p.clientes_novos !== 1 ? 's' : ''}</p>
              {podeComparar && comparar && (
                <p className="font-semibold text-slate-500 mt-1 pt-1 border-t border-black/5">
                  Ano anterior: <b className="text-brand-950">{M.fmt(d.p[M.comp])}</b>
                  {d.p[M.comp] > 0 && (
                    <span className={d.p[metrica] >= d.p[M.comp] ? ' text-brand-700' : ' text-flame-600'}>
                      {' '}({d.p[metrica] >= d.p[M.comp] ? '+' : ''}{(((d.p[metrica] - d.p[M.comp]) / d.p[M.comp]) * 100).toFixed(0)}%)
                    </span>
                  )}
                </p>
              )}
            </>
          )}
        />
      </div>
    </section>
  );
}

function GraficoAnos({ anos, hoje, onAno, anoSelecionado }) {
  const [modo, setModo] = useState('total');
  const corte = `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}`;
  const pontos = anos.map((a) => ({
    chave: a.ano,
    rotulo: a.ano,
    segs:
      modo === 'total'
        ? [{ chave: 'v', valor: a.total, cor: a.ano_corrente ? 'var(--viz-barra-forte)' : 'var(--viz-barra)' }]
        : [{ chave: 'v', valor: a.ate_hoje, cor: a.ano_corrente ? 'var(--viz-barra-forte)' : 'var(--viz-barra)' }],
    a
  }));
  const valorDe = (a) => (modo === 'total' ? a.total : a.ate_hoje);
  return (
    <section className={card}>
      <Cabecalho
        icon={CircleDollarSign}
        titulo="Total faturado por ano"
        dica={modo === 'total' ? 'O ano inteiro (o atual vai até hoje) · clique num ano para abri-lo.' : `Só de 1º/01 até ${corte} de cada ano — compara anos no mesmo ponto.`}
      >
        <Segmentos pequeno opcoes={[['total', 'Ano inteiro'], ['ate_hoje', `Até ${corte}`]]} valor={modo} onChange={setModo} />
      </Cabecalho>
      <div className="px-2 sm:px-4">
        <Barras
          dados={pontos}
          altura={200}
          fmtEixo={brlCurto}
          realce={anoSelecionado}
          onClick={onAno}
          vazio="Nenhuma nota com esses filtros."
          dica={(d) => (
            <>
              <p className="font-extrabold text-brand-950 mb-1">{d.a.ano}{d.a.ano_corrente ? ' (até hoje)' : ''}</p>
              <p className="font-semibold text-slate-500">Ano inteiro: <b className="text-brand-950">{brl(d.a.total)}</b></p>
              <p className="font-semibold text-slate-500">Até {corte}: <b className="text-brand-950">{brl(d.a.ate_hoje)}</b></p>
              <p className="font-semibold text-slate-500">{numero(d.a.notas)} notas · {numero(d.a.clientes)} clientes</p>
              <p className="font-semibold text-slate-500">Ticket médio {brl0(d.a.ticket_medio)}</p>
            </>
          )}
        />
      </div>
      <div className="border-t border-black/5 mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-slate-400">
              <th className="text-left font-extrabold px-5 sm:px-6 py-2">Ano</th>
              <th className="text-right font-extrabold px-2 py-2">{modo === 'total' ? 'Faturado' : `Até ${corte}`}</th>
              <th className="text-right font-extrabold px-2 py-2">vs anterior</th>
              <th className="text-right font-extrabold px-2 py-2 hidden sm:table-cell">Notas</th>
              <th className="text-right font-extrabold px-5 sm:px-6 py-2 hidden sm:table-cell">Ticket</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {[...anos].reverse().map((a, i, arr) => {
              const ant = arr[i + 1];
              const v = valorDe(a);
              // O ano em andamento compara com o anterior até a mesma data.
              const base = ant ? (a.ano_corrente ? ant.ate_hoje : valorDe(ant)) : 0;
              const pct = base ? ((v - base) / base) * 100 : null;
              return (
                <tr key={a.ano} onClick={() => onAno(a.ano)} className={`cursor-pointer hover:bg-brand-50/60 ${anoSelecionado === a.ano ? 'bg-brand-50' : ''}`}>
                  <td className="px-5 sm:px-6 py-2 font-extrabold text-brand-950">{a.ano}{a.ano_corrente && <span className="text-[10px] text-slate-400 font-bold"> · até hoje</span>}</td>
                  <td className="px-2 py-2 text-right font-extrabold text-brand-700">{brl(v)}</td>
                  <td className={`px-2 py-2 text-right font-bold ${pct == null ? 'text-slate-300' : pct >= 0 ? 'text-brand-700' : 'text-flame-600'}`}>
                    {pct == null ? '—' : `${pct >= 0 ? '▲ +' : '▼ '}${pct.toFixed(0)}%`}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-slate-500 hidden sm:table-cell">{numero(a.notas)}</td>
                  <td className="px-5 sm:px-6 py-2 text-right font-semibold text-slate-500 hidden sm:table-cell">{brl0(a.ticket_medio)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GraficoComparaAnos({ anos, hoje }) {
  const [modo, setModo] = useState('mensal');
  const [ocultos, setOcultos] = useState(() => new Set(anos.slice(0, -3).map((a) => a.ano)));
  const mesAtual = Number(hoje.slice(5, 7)) - 1;
  const anoAtual = hoje.slice(0, 4);
  const series = anos
    .filter((a) => !ocultos.has(a.ano))
    .map((a) => {
      let acc = 0;
      const vals = a.meses.map((v, i) => {
        if (a.ano === anoAtual && i > mesAtual) return null;
        acc += v;
        return modo === 'acumulado' ? Math.round(acc * 100) / 100 : v;
      });
      return { chave: a.ano, cor: corAno(a.ano), valores: vals, grosso: a.ano === anoAtual };
    });
  return (
    <section className={card}>
      <Cabecalho icon={TrendingUp} titulo="Ano contra ano" dica="Cada linha é um ano, mês a mês · clique na legenda para mostrar ou esconder anos.">
        <Segmentos pequeno opcoes={[['mensal', 'Mês a mês'], ['acumulado', 'Acumulado']]} valor={modo} onChange={setModo} />
      </Cabecalho>
      <Legenda
        itens={anos.map((a) => ({ chave: a.ano, rotulo: a.ano, cor: corAno(a.ano), apagado: ocultos.has(a.ano) }))}
        onClick={(ano) =>
          setOcultos((s) => {
            const n = new Set(s);
            if (n.has(ano)) n.delete(ano);
            else n.add(ano);
            return n;
          })
        }
      />
      <div className="px-2 sm:px-4 pb-4 pt-2">
        {anos.length ? (
          <Linhas
            series={series}
            rotulos={MESES}
            fmtEixo={brlCurto}
            fmtValor={brl0}
            rotuloDica={(i) => (modo === 'acumulado' ? `Até o fim de ${MESES_LONGOS[i]}` : cap(MESES_LONGOS[i]))}
          />
        ) : (
          <p className="py-16 text-center text-sm font-medium text-slate-400">Nenhuma nota com esses filtros.</p>
        )}
      </div>
    </section>
  );
}

function GraficoCategorias({ dados, onCategoria, onEntrar }) {
  const [modo, setModo] = useState('valor');
  const g = dados.filtros.granularidade;
  // Categorias com cor própria aparecem separadas; o resto vira "Demais".
  const nomes = dados.categorias.map((c) => c.chave);
  const proprias = nomes.filter((c) => CORES_CATEGORIA[c]);
  const temDemais = nomes.some((c) => !CORES_CATEGORIA[c]);
  const ordem = [...proprias, ...(temDemais ? ['Demais'] : [])];
  const pontos = dados.serie.map((p) => {
    const vals = {};
    for (const [c, v] of Object.entries(p.categorias)) {
      const k = CORES_CATEGORIA[c] ? c : 'Demais';
      vals[k] = (vals[k] || 0) + v;
    }
    const soma = Object.values(vals).reduce((s, v) => s + v, 0) || 1;
    return {
      chave: p.chave,
      rotulo: rotuloPonto(p.chave, g),
      segs: ordem.map((c) => ({ chave: c, valor: modo === 'valor' ? vals[c] || 0 : ((vals[c] || 0) / soma) * 100, cor: c === 'Demais' ? 'var(--viz-demais)' : corCategoria(c) })),
      vals,
      soma
    };
  });
  return (
    <section className={card}>
      <Cabecalho icon={Boxes} titulo="O que foi vendido ao longo do tempo" dica="Valor dos itens das notas por tipo de produto · clique na legenda para filtrar só aquele produto.">
        <Segmentos pequeno opcoes={[['valor', 'Em R$'], ['pct', 'Em %']]} valor={modo} onChange={setModo} />
      </Cabecalho>
      <Legenda
        itens={ordem.map((c) => ({ chave: c, rotulo: c, cor: c === 'Demais' ? 'var(--viz-demais)' : corCategoria(c) }))}
        onClick={(c) => c !== 'Demais' && onCategoria(c)}
      />
      <div className="px-2 sm:px-4 pb-4 pt-2">
        <Barras
          dados={pontos}
          altura={240}
          fmtEixo={modo === 'valor' ? brlCurto : (v) => `${Math.round(v)}%`}
          onClick={g === 'dia' ? undefined : (k) => onEntrar(intervaloDoPonto(k, g))}
          dica={(d) => (
            <>
              <p className="font-extrabold text-brand-950 mb-1">{rotuloPonto(d.chave, g, true)}</p>
              {ordem
                .filter((c) => d.vals[c])
                .sort((a, b) => d.vals[b] - d.vals[a])
                .map((c) => (
                  <p key={c} className="flex items-center gap-2 font-semibold text-slate-500">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c === 'Demais' ? 'var(--viz-demais)' : corCategoria(c) }} />
                    <span className="mr-auto">{c}</span>
                    <b className="text-brand-950">{brl0(d.vals[c])}</b>
                    <span className="w-8 text-right">{Math.round((d.vals[c] / d.soma) * 100)}%</span>
                  </p>
                ))}
              {!Object.keys(d.vals).length && <p className="text-slate-400">Nenhuma venda.</p>}
            </>
          )}
        />
      </div>
    </section>
  );
}

function GraficoSemana({ semana }) {
  const ordem = [1, 2, 3, 4, 5, 6, 0].map((i) => semana[i]);
  const max = Math.max(...ordem.map((d) => d.total), 1);
  const total = ordem.reduce((s, d) => s + d.total, 0) || 1;
  return (
    <section className={`${card} pb-4`}>
      <Cabecalho icon={CalendarDays} titulo="Dia da semana" dica="Em que dia as notas saem." />
      <div className="px-5 sm:px-6 flex items-end gap-2 h-36">
        {ordem.map((d) => (
          <div key={d.chave} className="flex-1 h-full flex flex-col items-center justify-end gap-1" title={`${d.chave}: ${brl(d.total)} · ${d.qtd} notas`}>
            <span className="text-[10px] font-bold text-slate-400">{Math.round((d.total / total) * 100)}%</span>
            <div className="w-full max-w-[36px] rounded-t" style={{ height: `${Math.max(d.total ? 3 : 1, (d.total / max) * 80)}%`, background: 'var(--viz-barra)' }} />
            <span className="text-[10px] font-bold text-slate-500">{d.chave.slice(0, 3)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ tela

function baixarCsv(dados) {
  const linhas = [['Número', 'Série', 'Emissão', 'Cliente', 'CPF/CNPJ', 'UF', 'Pagamento', 'Valor considerado', 'Valor da nota', 'Itens']];
  for (const n of dados.notas) {
    linhas.push([
      n.numero, n.serie, dataBR(n.dh_emissao), n.cliente, n.documento || '', n.uf || '', n.pagamento,
      String(n.valor).replace('.', ','), String(n.valor_nota).replace('.', ','),
      n.itens.map((i) => `${numero(i.quantidade)}x ${i.descricao}`).join(' | ')
    ]);
  }
  const csv = linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `faturamento-${dados.filtros.de}-a-${dados.filtros.ate}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Faturamento({ onAuthError }) {
  const toast = useToast();
  const [filtros, setFiltros] = useState(() => ({ ...presetDe('mes'), granularidade: '', ...SEM_FILTRO }));
  const [historico, setHistorico] = useState([]);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [busca, setBusca] = useState('');
  const [verNotas, setVerNotas] = useState(30);
  const pedido = useRef(0);

  const carregar = useCallback(
    async (f) => {
      const meu = ++pedido.current;
      setCarregando(true);
      try {
        let r = await faturamentoApi.painel(f);
        if (meu !== pedido.current) return;
        setDados(r);
        // Primeira vez: os itens das notas antigas vão sendo lidos em partes.
        while (r.pendentes > 0 && meu === pedido.current) {
          r = await faturamentoApi.painel(f);
          if (meu === pedido.current) setDados(r);
        }
      } catch (err) {
        if (!onAuthError(err)) toast(err.message, 'error');
      } finally {
        if (meu === pedido.current) setCarregando(false);
      }
    },
    [onAuthError, toast]
  );

  useEffect(() => {
    carregar(filtros);
    setVerNotas(30);
  }, [carregar, filtros]);

  // Muda os filtros guardando o estado anterior (para o "Voltar").
  const mudar = (patch, { guardar = true } = {}) => {
    const novo = { ...filtros, ...patch };
    if (JSON.stringify(novo) === JSON.stringify(filtros)) return;
    if (guardar) setHistorico((h) => [...h.slice(-19), filtros]);
    setFiltros(novo);
  };
  const mudarPeriodo = (p) => mudar({ ...p, granularidade: '' });
  const alternar = (k, v) => mudar({ [k]: filtros[k] === v ? '' : v });
  const voltar = () => {
    if (!historico.length) return;
    setFiltros(historico.at(-1));
    setHistorico(historico.slice(0, -1));
  };

  const notasVisiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const l = dados?.notas || [];
    if (!b) return l;
    return l.filter((n) => n.cliente.toLowerCase().includes(b) || String(n.numero) === b || n.itens.some((i) => i.descricao.toLowerCase().includes(b)));
  }, [dados, busca]);

  if (!dados) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400">
        <LoaderCircle className="animate-spin" />
        <p className="text-sm font-semibold">Carregando o faturamento…</p>
      </div>
    );
  }

  const r = dados.resumo;
  const { de, ate } = dados.filtros;
  const presetAtivo = PRESETS.find(([id]) => {
    const p = presetDe(id, dados.primeira_nota);
    return p && p.de === filtros.de && p.ate === filtros.ate;
  })?.[0];
  const ativos = Object.keys(SEM_FILTRO).filter((k) => filtros[k]);
  const anoSelecionado = ehAnoInteiro(de, ate) ? de.slice(0, 4) : null;
  const nomeAnt = nomePeriodo(r.anterior.de, r.anterior.ate);
  const nomePas = nomePeriodo(r.ano_passado.de, r.ano_passado.ate);
  const nota = r.ate_hoje ? `Período em andamento: as comparações vão só até ${dm(dados.hoje)} nos dois lados.` : null;
  const placas = dados.categorias.find((c) => c.chave === 'Placas');
  const o = dados.opcoes;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      {/* ---- título */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Faturamento</h2>
          <p className="text-xs font-medium text-slate-400">Pelas notas fiscais autorizadas (produção). Canceladas ficam de fora.</p>
        </div>
        {carregando && <LoaderCircle size={16} className="animate-spin text-slate-400" />}
        <button
          onClick={() => baixarCsv(dados)}
          disabled={!dados.notas.length}
          className="flex items-center gap-1.5 bg-white border border-black/5 rounded-full px-3.5 py-2 text-xs font-bold text-brand-800 shadow-sm hover:bg-brand-50 disabled:opacity-40"
        >
          <Download size={14} /> Planilha das notas
        </button>
      </div>

      {/* ---- filtros */}
      <section className={`${card} p-4 sm:p-5 space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          {historico.length > 0 && (
            <button onClick={voltar} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-brand-800 hover:bg-black/[0.04]" title="Voltar ao filtro anterior">
              <ArrowLeft size={13} /> Voltar
            </button>
          )}
          <Segmentos opcoes={PRESETS} valor={presetAtivo} onChange={(id) => mudarPeriodo(presetDe(id, dados.primeira_nota))} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => mudarPeriodo(andar(de, ate, -1))} className="w-8 h-8 rounded-full hover:bg-black/[0.05] flex items-center justify-center text-slate-500" aria-label="Período anterior">
              <ChevronLeft size={16} />
            </button>
            <p className="font-extrabold text-brand-950 text-base min-w-[9rem] text-center">{nomePeriodo(de, ate)}</p>
            <button onClick={() => mudarPeriodo(andar(de, ate, 1))} className="w-8 h-8 rounded-full hover:bg-black/[0.05] flex items-center justify-center text-slate-500" aria-label="Próximo período">
              <ChevronRight size={16} />
            </button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">De</span>
            <input type="date" value={filtros.de} max={filtros.ate} onChange={(e) => e.target.value && mudarPeriodo({ de: e.target.value })} className="border-2 border-slate-200 rounded-xl px-2.5 py-1 text-sm font-semibold outline-none focus:border-brand-500 bg-white" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Até</span>
            <input type="date" value={filtros.ate} min={filtros.de} onChange={(e) => e.target.value && mudarPeriodo({ ate: e.target.value })} className="border-2 border-slate-200 rounded-xl px-2.5 py-1 text-sm font-semibold outline-none focus:border-brand-500 bg-white" />
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setMaisFiltros((v) => !v)}
              aria-expanded={maisFiltros}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold border ${maisFiltros || ativos.length ? 'border-brand-400 text-brand-800 bg-brand-50' : 'border-black/5 text-slate-500 hover:text-brand-800'}`}
            >
              <Filter size={13} /> Filtros{ativos.length ? ` (${ativos.length})` : ''}
            </button>
          </div>
        </div>
        {maisFiltros && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-1">
            <CampoTexto label="Cliente" value={filtros.cliente} onChange={(v) => mudar({ cliente: v })} placeholder="nome ou CPF/CNPJ" />
            <CampoTexto label="Descrição do produto" value={filtros.produto} onChange={(v) => mudar({ produto: v })} placeholder="ex.: inox, 20x30" />
            <Select label="Tipo de produto" value={filtros.categoria} onChange={(v) => mudar({ categoria: v })} opcoes={o.categorias} />
            <Select label="Tamanho da placa" value={filtros.tamanho} onChange={(v) => mudar({ tamanho: v })} opcoes={o.tamanhos} />
            <Select label="Material" value={filtros.material} onChange={(v) => mudar({ material: v })} opcoes={o.materiais} />
            <Select label="Estado" value={filtros.uf} onChange={(v) => mudar({ uf: v })} opcoes={o.ufs} />
            <Select label="Empresa ou PF" value={filtros.tipo} onChange={(v) => mudar({ tipo: v })} opcoes={[['pj', 'Empresa'], ['pf', 'Pessoa física']]} />
            <Select label="Pagamento" value={filtros.pagamento} onChange={(v) => mudar({ pagamento: v })} opcoes={o.pagamentos} />
          </div>
        )}
        {ativos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {ativos.map((k) => (
              <button key={k} onClick={() => mudar({ [k]: '' })} className="flex items-center gap-1.5 rounded-full bg-brand-100 text-brand-800 pl-3 pr-2 py-1 text-xs font-bold hover:bg-brand-200" title="Tirar este filtro">
                <span className="text-brand-600 font-semibold">{ROTULO_FILTRO[k]}:</span> {valorFiltro(k, filtros[k])} <X size={12} />
              </button>
            ))}
            <button onClick={() => mudar(SEM_FILTRO)} className="text-xs font-bold text-slate-400 hover:text-flame-600 px-1">Limpar filtros</button>
            {(filtros.categoria || filtros.tamanho || filtros.material || filtros.produto) && (
              <span className="text-[11px] font-medium text-slate-400">Os valores somam só os itens que batem com o filtro de produto.</span>
            )}
          </div>
        )}
      </section>

      {dados.pendentes > 0 && (
        <div className="rounded-2xl bg-sun-100 text-yellow-800 px-4 py-3 text-sm font-semibold flex items-center gap-2">
          <LoaderCircle size={15} className="animate-spin" /> Lendo os itens das notas antigas pela primeira vez… faltam {dados.pendentes}.
        </div>
      )}

      {/* ---- números */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile icon={CircleDollarSign} label="Faturado" value={brl(r.total)} sub={<Variacao atual={r.total} base={r.anterior.total} rotuloBase={nomeAnt} />} />
        <Tile icon={Layers} label="Ano anterior" value={brl(r.ano_passado.total)} sub={<Variacao atual={r.total} base={r.ano_passado.total} rotuloBase={nomePas} />} tone="slate" />
        <Tile
          icon={FileText}
          label="Notas · ticket"
          value={`${numero(r.notas)} · ${brl0(r.ticket_medio)}`}
          sub={<Variacao atual={r.ticket_medio} base={r.ano_passado.ticket_medio} rotuloBase="ticket do ano anterior" />}
        />
        <Tile
          icon={Users}
          label="Clientes"
          value={numero(r.clientes)}
          sub={
            <span className="inline-flex items-center gap-1">
              <UserPlus size={12} /> {r.clientes_novos} novo{r.clientes_novos !== 1 ? 's' : ''} · {r.clientes - r.clientes_novos} já compravam
            </span>
          }
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-slate-400 -mt-1 px-1">
        {nota && <span className="w-full">{nota}</span>}
        <span><b className="text-slate-600">{numero(r.unidades)}</b> unidades vendidas</span>
        <span>maior nota <b className="text-slate-600">{brl(r.maior_nota)}</b></span>
        <span>10 maiores clientes = <b className="text-slate-600">{numero(r.concentracao_top10)}%</b> do faturado</span>
        <span className="inline-flex items-center gap-1">
          <Ban size={12} /> {r.canceladas} cancelada{r.canceladas !== 1 ? 's' : ''}{r.canceladas ? ` (${brl(r.valor_cancelado)} fora do total)` : ''}
        </span>
      </div>

      {/* ---- gráficos */}
      <GraficoTempo dados={dados} granularidade={filtros.granularidade} onGranularidade={(g) => mudar({ granularidade: g }, { guardar: false })} onEntrar={mudarPeriodo} />

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <GraficoAnos anos={dados.anos} hoje={dados.hoje} anoSelecionado={anoSelecionado} onAno={(a) => mudarPeriodo({ de: `${a}-01-01`, ate: `${a}-12-31` })} />
        <GraficoComparaAnos key={dados.anos.map((a) => a.ano).join()} anos={dados.anos} hoje={dados.hoje} />
      </div>

      <GraficoCategorias dados={dados} onCategoria={(c) => alternar('categoria', c)} onEntrar={mudarPeriodo} />

      {/* ---- rankings (clicar filtra) */}
      <p className="text-[11px] font-semibold text-slate-400 px-1">Clique em qualquer linha das listas para filtrar o painel inteiro por ela.</p>
      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <Ranking
          icon={Boxes}
          titulo="O que foi vendido"
          dica="Cada item das notas, agrupado pelo tipo de produto."
          linhas={dados.categorias}
          vazio="Nenhuma venda neste período."
          onClick={(v) => alternar('categoria', v)}
          ativo={filtros.categoria}
          cor={(c) => corCategoria(c)}
        />
        <Ranking
          icon={Ruler}
          titulo="Placas por tamanho"
          dica={placas ? `${numero(placas.unidades)} placas · ${brl(placas.total)} no período` : 'Medida lida da descrição da nota.'}
          linhas={dados.tamanhos}
          vazio="Nenhuma placa neste período."
          onClick={(v) => alternar('tamanho', v)}
          ativo={filtros.tamanho}
        />
      </div>

      <Ranking
        icon={Package}
        titulo="Produtos mais vendidos"
        dica="Pela descrição exata que saiu na nota."
        linhas={dados.produtos}
        vazio="Nenhum produto neste período."
        limite={12}
        onClick={(v) => mudar({ produto: filtros.produto === v ? '' : v })}
        ativo={filtros.produto}
      />

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <section className={`${card} overflow-hidden`}>
          <Cabecalho icon={Users} titulo="Melhores clientes" dica={`${numero(dados.total_clientes)} clientes compraram no período · clique para ver só um.`} />
          {!dados.clientes.length ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Nenhum cliente neste período.</p>
          ) : (
            <ClientesLista clientes={dados.clientes} total={r.total} ativo={filtros.cliente} onClick={(c) => mudar({ cliente: filtros.cliente === c ? '' : c })} />
          )}
        </section>
        <div className="space-y-5">
          <Ranking icon={Layers} titulo="Por material" linhas={dados.materiais} vazio="Sem material identificado." onClick={(v) => alternar('material', v)} ativo={filtros.material} />
          <GraficoSemana semana={dados.semana} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3 items-start">
        <Ranking icon={MapPin} titulo="Por estado" linhas={dados.ufs} vazio="—" mostrarUnidades={false} limite={6} onClick={(v) => alternar('uf', v)} ativo={filtros.uf} />
        <Ranking
          icon={Users}
          titulo="Empresa ou pessoa física"
          linhas={dados.tipos}
          vazio="—"
          mostrarUnidades={false}
          onClick={(v) => alternar('tipo', v === 'Pessoa física' ? 'pf' : 'pj')}
          ativo={filtros.tipo ? valorFiltro('tipo', filtros.tipo) : ''}
        />
        <Ranking icon={Wallet} titulo="Forma de pagamento" linhas={dados.pagamentos} vazio="—" mostrarUnidades={false} onClick={(v) => alternar('pagamento', v)} ativo={filtros.pagamento} />
      </div>

      {/* ---- nota a nota */}
      <section className={`${card} overflow-hidden`}>
        <div className="px-5 sm:px-6 py-4 border-b border-black/5 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Notas · {nomePeriodo(de, ate)}</h3>
            <p className="text-[11px] font-medium text-slate-400 mt-0.5">
              {numero(dados.notas_total)} nota{dados.notas_total !== 1 ? 's' : ''}, da mais recente para a mais antiga
              {dados.notas_total > dados.notas.length ? ` (mostrando as ${dados.notas.length} mais recentes)` : ''}.
            </p>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="cliente, nº ou produto"
              className="border-2 border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-sm font-medium outline-none focus:border-brand-500 bg-white"
            />
          </div>
        </div>
        {!notasVisiveis.length ? (
          <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Nenhuma nota.</p>
        ) : (
          <div className="divide-y divide-black/5">
            {notasVisiveis.slice(0, verNotas).map((n) => (
              <div key={n.id} className="px-5 sm:px-6 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-extrabold text-brand-600 text-xs w-14 shrink-0">{n.numero}/{n.serie}</span>
                  <span className="text-[11px] font-bold text-slate-400 w-14 shrink-0">{dataBR(n.dh_emissao)}</span>
                  <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{n.cliente}</span>
                  <span className="hidden sm:inline text-[11px] font-semibold text-slate-400 shrink-0">{n.pagamento}</span>
                  <span className="font-extrabold text-brand-700 text-xs w-24 text-right shrink-0" title={n.valor !== n.valor_nota ? `Nota inteira: ${brl(n.valor_nota)}` : undefined}>
                    {brl(n.valor)}
                  </span>
                </div>
                <div className="mt-1 sm:pl-[8.5rem] flex flex-wrap gap-x-3 gap-y-0.5">
                  {n.itens.map((i, k) => (
                    <span key={k} className={`text-[11px] ${i.conta ? 'text-slate-500' : 'text-slate-300 line-through'}`}>
                      <span className="font-bold">{numero(i.quantidade)}×</span> {i.descricao}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {notasVisiveis.length > verNotas && (
              <button onClick={() => setVerNotas((v) => v + 50)} className="w-full px-6 py-3 text-xs font-bold text-brand-700 hover:bg-brand-50/50">
                Mostrar mais ({notasVisiveis.length - verNotas} restantes)
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ClientesLista({ clientes, total, ativo, onClick }) {
  const [todos, setTodos] = useState(false);
  const lista = todos ? clientes.slice(0, 100) : clientes.slice(0, 10);
  return (
    <div className="divide-y divide-black/5 border-t border-black/5">
      {lista.map((c, i) => (
        <button
          key={c.chave}
          onClick={() => onClick(c.nome)}
          className={`w-full px-5 sm:px-6 py-2.5 flex items-center gap-3 text-sm text-left hover:bg-brand-50/60 ${ativo === c.nome ? 'bg-brand-50' : ''}`}
        >
          <span className="w-5 text-[11px] font-extrabold text-slate-300 shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="truncate font-bold text-brand-950">
              {c.nome}
              {c.novo && <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-wider bg-sun-100 text-yellow-700 rounded-full px-1.5 py-0.5">novo</span>}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {fmtDoc(c.documento)} · {c.notas} nota{c.notas !== 1 ? 's' : ''} · última {dm(c.ultima)}
            </div>
          </div>
          <span className="text-[11px] font-bold text-slate-400 w-9 text-right shrink-0">{total ? Math.round((c.total / total) * 100) : 0}%</span>
          <span className="font-extrabold text-brand-700 text-xs w-24 text-right shrink-0">{brl(c.total)}</span>
        </button>
      ))}
      {clientes.length > 10 && (
        <button onClick={() => setTodos((v) => !v)} className="w-full px-6 py-2.5 text-xs font-bold text-brand-700 hover:bg-brand-50/50 text-left">
          {todos ? 'Mostrar menos' : `Ver mais (${Math.min(100, clientes.length)})`}
        </button>
      )}
    </div>
  );
}
