import React from 'react';
import { CalendarClock, Clock, AlertTriangle, KeyRound } from 'lucide-react';
import { COLUMNS, describeDay, addDaysISO, todayISO, formatPickupTime } from '../constants';

const STATUS_DOT = Object.fromEntries(COLUMNS.map((c) => [c.id, c.color]));

// Painel abaixo do quadro: pedidos a entregar nos próximos 3 dias (+ atrasados).
export default function UpcomingDeliveries({ orders, onOpen }) {
  const today = todayISO();

  // pedidos ainda não entregues, com data de entrega
  const pending = orders.filter(
    (o) => o.status !== 'entregue' && !o.archived && o.due_date
  );

  const overdue = pending
    .filter((o) => o.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  // um "grupo" por dia dentro da janela de 4 dias (hoje + próximos 3)
  const days = [today, addDaysISO(today, 1), addDaysISO(today, 2), addDaysISO(today, 3)].map((iso) => ({
    iso,
    ...describeDay(iso),
    orders: pending
      .filter((o) => o.due_date === iso)
      .sort((a, b) => (a.pickup_time || '99').localeCompare(b.pickup_time || '99'))
  }));

  const total = overdue.length + days.reduce((n, d) => n + d.orders.length, 0);

  const OrderRow = ({ o }) => (
    <button
      onClick={() => onOpen(o)}
      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-brand-50 transition-colors text-left"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[o.status] || 'bg-slate-400'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-brand-950 truncate">{o.customer_name}</p>
        <p className="text-[11px] font-medium text-slate-400 truncate">
          {o.order_number}
          {o.product_type ? ` · ${o.product_type}` : ''}
        </p>
      </div>
      {o.pickup_code && (
        <span className="hidden sm:flex items-center gap-0.5 text-[10px] font-extrabold text-slate-500 bg-black/[0.05] px-1.5 py-0.5 rounded-md tracking-widest shrink-0">
          <KeyRound size={9} /> {o.pickup_code}
        </span>
      )}
      <span className="flex items-center gap-1 text-[11px] font-extrabold text-brand-700 shrink-0">
        <Clock size={11} />
        {o.pickup_time ? `${formatPickupTime(o.pickup_time)}` : 'a combinar'}
      </span>
    </button>
  );

  return (
    <div className="px-4 sm:px-6 pb-5 shrink-0">
      <div className="bg-white border border-black/5 rounded-3xl shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock size={16} className="text-brand-600" />
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Próximas entregas (4 dias)</h3>
          <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-brand-100 text-brand-700">
            {total}
          </span>
          <span className="text-[11px] font-medium text-slate-400 ml-2 hidden sm:inline">
            horário = a partir de quando o cliente pode buscar
          </span>
        </div>

        <div
          className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${
            overdue.length ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4'
          }`}
        >
          {overdue.length > 0 && (
            <div className="bg-flame-50 border border-flame-100 rounded-2xl p-2.5">
              <div className="flex items-center gap-1.5 px-1 pb-1.5">
                <AlertTriangle size={13} className="text-flame-600" />
                <span className="text-xs font-extrabold text-flame-700">Atrasados</span>
                <span className="ml-auto text-[10px] font-extrabold text-flame-700">{overdue.length}</span>
              </div>
              <div className="space-y-0.5">
                {overdue.map((o) => (
                  <OrderRow key={o.id} o={o} />
                ))}
              </div>
            </div>
          )}

          {days.map((d) => (
            <div key={d.iso} className="bg-black/[0.02] border border-black/5 rounded-2xl p-2.5">
              <div className="flex items-baseline gap-1.5 px-1 pb-1.5">
                <span className="text-xs font-extrabold text-brand-950">{d.rel || d.weekday}</span>
                <span className="text-[11px] font-semibold text-slate-400">
                  {d.rel ? d.weekday : ''} {d.dayMonth}
                </span>
                <span className="ml-auto text-[10px] font-extrabold text-slate-400">{d.orders.length}</span>
              </div>
              {d.orders.length === 0 ? (
                <p className="text-[11px] font-medium text-slate-300 text-center py-3">Sem entregas</p>
              ) : (
                <div className="space-y-0.5">
                  {d.orders.map((o) => (
                    <OrderRow key={o.id} o={o} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
