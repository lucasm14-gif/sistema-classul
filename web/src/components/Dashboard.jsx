import React, { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Package, Receipt, CircleDollarSign, FileWarning, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { formatDateBR, parseBRL } from '../constants';
import { useToast } from './Toast';

const brl = (n) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function monthLabel(key, long = false) {
  const [y, m] = key.split('-');
  const name = MONTH_NAMES[Number(m) - 1] || m;
  return long ? `${name.charAt(0).toUpperCase() + name.slice(1)}/${y}` : `${name}/${y.slice(2)}`;
}

function lastMonths(n = 12) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function StatTile({ icon: Icon, label, value, sub, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-100 text-brand-700',
    slate: 'bg-black/[0.04] text-slate-500',
    amber: 'bg-sun-100 text-yellow-700'
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

function RevenueChart({ months, selected, onSelect }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...months.map((m) => m.total), 1);
  return (
    <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
      <h3 className="font-extrabold tracking-tight text-brand-950 mb-1">Faturamento por mês</h3>
      <p className="text-xs font-medium text-slate-400 mb-5">Pedidos entregues nos últimos 6 meses</p>
      <div className="flex items-end gap-3 h-44">
        {months.map((m) => {
          const h = m.total > 0 ? Math.max(8, (m.total / max) * 100) : 4;
          const active = m.key === selected;
          const showLabel = active || (m.total === max && m.total > 0) || hover === m.key;
          return (
            <button
              key={m.key}
              onClick={() => onSelect(m.key)}
              onMouseEnter={() => setHover(m.key)}
              onMouseLeave={() => setHover(null)}
              title={`${monthLabel(m.key, true)} · ${brl(m.total)} · ${m.count} pedido(s)`}
              className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full group"
            >
              {showLabel && (
                <span className="text-[10px] font-extrabold text-brand-950 whitespace-nowrap">
                  {brl(m.total)}
                </span>
              )}
              <div
                style={{ height: `${h}%` }}
                className={`w-full max-w-[44px] rounded-t transition-all ${
                  m.total === 0
                    ? 'bg-black/[0.06]'
                    : active
                      ? 'bg-brand-600'
                      : 'bg-brand-300 group-hover:bg-brand-400'
                }`}
              />
              <span
                className={`text-[10px] font-bold ${active ? 'text-brand-800' : 'text-slate-400'}`}
              >
                {monthLabel(m.key)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard({ onAuthError }) {
  const [month, setMonth] = useState(() => lastMonths(1)[0]);
  const [stats, setStats] = useState(null);
  const toast = useToast();

  const load = useCallback(
    async (m) => {
      try {
        setStats(await api.getStats(m));
      } catch (err) {
        if (!onAuthError(err)) toast(err.message, 'error');
      }
    },
    [onAuthError, toast]
  );

  useEffect(() => {
    load(month);
  }, [load, month]);

  if (!stats) return <p className="p-6 text-sm font-medium text-slate-400">Carregando…</p>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Faturamento</h2>
          <p className="text-xs font-medium text-slate-400">
            Baseado nos pedidos entregues (valor preenchido no pedido).
          </p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-white border border-black/5 rounded-full px-4 py-2.5 text-sm font-bold text-brand-950 outline-none shadow-sm focus:border-brand-400"
        >
          {lastMonths(12).map((k) => (
            <option key={k} value={k}>
              {monthLabel(k, true)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          icon={CircleDollarSign}
          label={`Faturado · ${monthLabel(month)}`}
          value={brl(stats.month.total)}
          sub={`${stats.month.count} pedido${stats.month.count !== 1 ? 's' : ''} entregue${stats.month.count !== 1 ? 's' : ''}`}
        />
        <StatTile
          icon={TrendingUp}
          label="Ticket médio"
          value={brl(stats.month.avg)}
          sub="por pedido no mês"
        />
        <StatTile
          icon={Package}
          label="Em aberto"
          value={brl(stats.open.total)}
          sub={`${stats.open.count} pedido${stats.open.count !== 1 ? 's' : ''} no quadro`}
          tone="slate"
        />
        <StatTile
          icon={FileWarning}
          label="NF pendente"
          value={String(stats.pending_invoices.length)}
          sub={stats.pending_invoices.length ? 'entregues sem nota fiscal' : 'tudo em dia ✓'}
          tone={stats.pending_invoices.length ? 'amber' : 'brand'}
        />
      </div>

      <RevenueChart months={stats.months} selected={month} onSelect={setMonth} />

      {stats.pending_invoices.length > 0 && (
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 flex items-center gap-2 border-b border-black/5 bg-sun-100/50">
            <FileWarning size={16} className="text-yellow-700" />
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">
              Notas fiscais pendentes
            </h3>
            <span className="ml-auto text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-sun-100 text-yellow-700">
              {stats.pending_invoices.length}
            </span>
          </div>
          <div className="divide-y divide-black/5">
            {stats.pending_invoices.map((o) => (
              <div key={o.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                <span className="font-extrabold text-brand-600 text-xs">{o.order_number}</span>
                <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{o.customer_name}</span>
                {o.value && <span className="font-extrabold text-brand-700 text-xs">{brl(parseBRL(o.value))}</span>}
                <span className="text-xs font-medium text-slate-400">
                  entregue {o.delivered_at ? formatDateBR(new Date(o.delivered_at).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })) : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="px-6 py-3 text-[11px] font-medium text-slate-400 bg-black/[0.02]">
            Abra o pedido no quadro e use "Anexar NF" para resolver.
          </p>
        </section>
      )}

      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">
            Entregas de {monthLabel(month, true)}
          </h3>
        </div>
        {stats.month_orders.length === 0 ? (
          <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">
            Nenhum pedido entregue neste mês.
          </p>
        ) : (
          <div className="divide-y divide-black/5">
            {stats.month_orders.map((o) => (
              <div key={o.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                <span className="font-extrabold text-brand-600 text-xs">{o.order_number}</span>
                <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{o.customer_name}</span>
                {o.has_invoice ? (
                  <span className="flex items-center gap-1 text-[10px] font-extrabold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 size={11} /> NF
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-extrabold text-yellow-700 bg-sun-100 px-2 py-0.5 rounded-full">
                    <FileWarning size={11} /> sem NF
                  </span>
                )}
                <span className="font-extrabold text-brand-700 text-xs w-24 text-right">
                  {brl(parseBRL(o.value))}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
