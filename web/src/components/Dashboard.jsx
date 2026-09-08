import React, { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Package, CircleDollarSign, FileWarning, CheckCircle2, Wallet, HandCoins, ShoppingBag, Ruler } from 'lucide-react';
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

// O que foi vendido, em português claro.
function productLabel(o) {
  if (o.case_only) return 'Estojo avulso';
  return o.product_type ? `Placa ${o.product_type}` : 'Placa (tipo não informado)';
}

// Detalhes do item: tamanho e cor, já explicados.
function soldDetails(o) {
  const parts = [];
  if (o.size) parts.push(o.case_only ? `cabe placa de ${o.size} cm` : `${o.size} cm`);
  if (o.case_color) parts.push(o.case_only ? `cor ${o.case_color}` : `estojo ${o.case_color}`);
  return parts;
}

// Agrupa os pedidos do mês somando quantidade e valor.
function groupSales(orders, keyFn) {
  const map = new Map();
  for (const o of orders) {
    const key = keyFn(o);
    const cur = map.get(key) || { key, count: 0, total: 0 };
    cur.count += 1;
    cur.total += parseBRL(o.value);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count);
}

// Lista com barra proporcional — usada nos dois recortes de "O que foi vendido".
function BreakdownList({ icon: Icon, title, hint, rows, empty }) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-black/5">
        <h3 className="font-extrabold tracking-tight text-brand-950 text-sm flex items-center gap-2">
          <Icon size={15} className="text-brand-600" /> {title}
        </h3>
        <p className="text-[11px] font-medium text-slate-400 mt-0.5">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">{empty}</p>
      ) : (
        <div className="divide-y divide-black/5">
          {rows.map((r) => (
            <div key={r.key} className="px-6 py-3 flex items-center gap-3 text-sm">
              <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{r.key}</span>
              <span className="text-[11px] font-bold text-slate-400 shrink-0 w-16 text-right">
                {r.count} {r.count === 1 ? 'pedido' : 'pedidos'}
              </span>
              <span className="w-20 h-2 rounded-full bg-brand-100 overflow-hidden shrink-0">
                <span className="block h-full bg-brand-500" style={{ width: `${(r.total / max) * 100}%` }} />
              </span>
              <span className="font-extrabold text-brand-700 text-xs w-24 text-right">{brl(r.total)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
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

  // Recortes do que foi vendido no mês selecionado.
  const byProduct = groupSales(stats.month_orders, productLabel);
  const bySize = groupSales(stats.month_orders, (o) => (o.size ? `${o.size} cm` : 'Sem tamanho informado'));

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

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatTile
          icon={CircleDollarSign}
          label={`Faturado · ${monthLabel(month)}`}
          value={brl(stats.month.total)}
          sub={`${stats.month.count} pedido${stats.month.count !== 1 ? 's' : ''} entregue${stats.month.count !== 1 ? 's' : ''}`}
        />
        <StatTile
          icon={Wallet}
          label={`Recebido · ${monthLabel(month)}`}
          value={brl(stats.month.paid)}
          sub="entregas do mês marcadas como pagas"
        />
        <StatTile
          icon={TrendingUp}
          label="Ticket médio"
          value={brl(stats.month.avg)}
          sub="por pedido no mês"
        />
        <StatTile
          icon={HandCoins}
          label="A receber"
          value={brl(stats.receivable.total)}
          sub={`${stats.receivable.count} pedido${stats.receivable.count !== 1 ? 's' : ''} não pago${stats.receivable.count !== 1 ? 's' : ''}`}
          tone={stats.receivable.count ? 'amber' : 'brand'}
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

      <div className="grid gap-5 lg:grid-cols-2">
        <BreakdownList
          icon={ShoppingBag}
          title="O que foi vendido"
          hint={`Cada produto entregue em ${monthLabel(month, true)}, com quantidade e quanto rendeu.`}
          rows={byProduct}
          empty="Nenhum produto entregue neste mês."
        />
        <BreakdownList
          icon={Ruler}
          title="Por tamanho"
          hint="Medida da placa em cm — no estojo avulso, é a placa que cabe dentro dele."
          rows={bySize}
          empty="Nenhum tamanho registrado neste mês."
        />
      </div>

      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">
            Entregas de {monthLabel(month, true)}
          </h3>
          <p className="text-[11px] font-medium text-slate-400 mt-0.5">
            Pedido a pedido: o que era, tamanho, pagamento e nota fiscal.
          </p>
        </div>
        {stats.month_orders.length === 0 ? (
          <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">
            Nenhum pedido entregue neste mês.
          </p>
        ) : (
          <div className="divide-y divide-black/5">
            {stats.month_orders.map((o) => (
              <div key={o.id} className="px-6 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-extrabold text-brand-600 text-xs">{o.order_number}</span>
                  <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{o.customer_name}</span>
                  {o.payment_status === 'pago' ? (
                    <span className="flex items-center gap-1 text-[10px] font-extrabold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
                      <Wallet size={11} /> pago
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-extrabold text-flame-700 bg-flame-50 px-2 py-0.5 rounded-full">
                      <Wallet size={11} /> {o.payment_status === 'sinal' ? 'sinal' : 'a receber'}
                    </span>
                  )}
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
                <p className="text-xs font-semibold text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                      o.case_only ? 'bg-sun-100 text-yellow-800' : 'bg-brand-50 text-brand-700'
                    }`}
                  >
                    {productLabel(o)}
                  </span>
                  {soldDetails(o).map((d) => (
                    <span key={d} className="text-[11px] text-slate-500">
                      · {d}
                    </span>
                  ))}
                  {o.description && (
                    <span className="text-[11px] text-slate-400 truncate max-w-full">· {o.description}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
