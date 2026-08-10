import React, { useCallback, useEffect, useState } from 'react';
import { MousePointerClick, CalendarDays, CalendarRange, Sigma, MessageCircle, Radio } from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';

function StatTile({ icon: Icon, label, value, sub, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-100 text-brand-700',
    slate: 'bg-black/[0.04] text-slate-500',
    flame: 'bg-flame-50 text-flame-700'
  };
  return (
    <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tones[tone]}`}>
          <Icon size={15} />
        </span>
        <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-2xl font-extrabold tracking-tight text-brand-950 leading-none">{value}</p>
      {sub && <p className="text-xs font-semibold text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

function dayShort(iso) {
  const [y, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

function whenLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function RankRow({ label, count, max, capitalize }) {
  return (
    <div className="px-6 py-3 flex items-center gap-3 text-sm">
      <span className={`flex-1 min-w-0 truncate font-bold text-brand-950 ${capitalize ? 'capitalize' : ''}`}>
        {label}
      </span>
      <span className="w-24 h-2 rounded-full bg-brand-100 overflow-hidden shrink-0">
        <span className="block h-full bg-brand-500" style={{ width: `${(count / max) * 100}%` }} />
      </span>
      <span className="font-extrabold text-brand-700 text-xs w-8 text-right">{count}</span>
    </div>
  );
}

function ClicksChart({ series }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...series.map((s) => s.count), 1);
  return (
    <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
      <h3 className="font-extrabold tracking-tight text-brand-950 mb-1">Cliques por dia</h3>
      <p className="text-xs font-medium text-slate-400 mb-5">Últimos 30 dias</p>
      <div className="flex items-end gap-[3px] h-40">
        {series.map((s) => {
          const h = s.count > 0 ? Math.max(6, (s.count / max) * 100) : 3;
          const show = hover === s.day || (s.count === max && s.count > 0);
          return (
            <div
              key={s.day}
              onMouseEnter={() => setHover(s.day)}
              onMouseLeave={() => setHover(null)}
              title={`${dayShort(s.day)}: ${s.count} clique${s.count !== 1 ? 's' : ''}`}
              className="flex-1 flex flex-col items-center justify-end gap-1 h-full group cursor-default"
            >
              {show && <span className="text-[10px] font-extrabold text-brand-950">{s.count}</span>}
              <div
                style={{ height: `${h}%` }}
                className={`w-full rounded-t transition-all ${
                  s.count === 0 ? 'bg-black/[0.06]' : 'bg-brand-400 group-hover:bg-brand-600'
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-2">
        <span>{series.length ? dayShort(series[0].day) : ''}</span>
        <span>Hoje</span>
      </div>
    </div>
  );
}

export default function Leads({ onAuthError }) {
  const [data, setData] = useState(null);
  const toast = useToast();

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        setData(await api.getLeads());
      } catch (err) {
        // Em atualização automática, não incomoda com toast de erro.
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      }
    },
    [onAuthError, toast]
  );

  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), 30000);
    return () => clearInterval(id);
  }, [load]);

  if (!data) return <p className="p-6 text-sm font-medium text-slate-400">Carregando…</p>;

  const maxPage = Math.max(...data.top_pages.map((p) => p.count), 1);
  const sources = data.top_sources || [];
  const maxSource = Math.max(...sources.map((s) => s.count), 1);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      <div className="flex items-center gap-2">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Leads do WhatsApp</h2>
          <p className="text-xs font-medium text-slate-400">
            Cliques nos botões de WhatsApp do site classul.com.br.
          </p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
          <Radio size={13} className="text-brand-500" /> ao vivo
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon={MousePointerClick} label="Hoje" value={String(data.today)} sub="cliques" />
        <StatTile icon={CalendarDays} label="Últimos 7 dias" value={String(data.last7)} sub="cliques" tone="slate" />
        <StatTile icon={CalendarRange} label="Últimos 30 dias" value={String(data.last30)} sub="cliques" tone="slate" />
        <StatTile icon={Sigma} label="Total geral" value={String(data.total)} sub="desde o início" tone="brand" />
      </div>

      <ClicksChart series={data.series} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Origem / campanha</h3>
          </div>
          {sources.length === 0 ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Sem cliques ainda.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {sources.map((s) => (
                <RankRow key={s.source} label={s.source} count={s.count} max={maxSource} />
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">De onde vieram</h3>
          </div>
          {data.top_pages.length === 0 ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Sem cliques ainda.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {data.top_pages.map((p) => (
                <RankRow key={p.page} label={p.page_label} count={p.count} max={maxPage} capitalize />
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Últimos cliques</h3>
        </div>
        {data.recent.length === 0 ? (
          <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Sem cliques ainda.</p>
        ) : (
          <div className="divide-y divide-black/5">
            {data.recent.map((r, i) => (
              <div key={i} className="px-6 py-3 flex items-center gap-3 text-sm">
                <MessageCircle size={14} className="text-brand-500 shrink-0" />
                <span className="flex-1 min-w-0 truncate font-bold text-brand-950 capitalize">{r.page_label}</span>
                {r.source && r.source !== 'Direto' && (
                  <span className="hidden sm:inline text-[10px] font-extrabold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full truncate max-w-[9rem]">
                    {r.source}
                  </span>
                )}
                <span className="text-xs font-medium text-slate-400 shrink-0">{whenLabel(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {data.total === 0 && (
        <p className="text-center text-xs font-medium text-slate-400 pt-2">
          Assim que alguém clicar no WhatsApp do site, aparece aqui.
        </p>
      )}
    </div>
  );
}
