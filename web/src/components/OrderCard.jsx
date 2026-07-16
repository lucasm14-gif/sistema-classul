import React from 'react';
import { Calendar, MessageCircle, Paperclip, FileWarning, CircleDollarSign, CheckCircle2, KeyRound } from 'lucide-react';
import { CASE_COLOR_DOT, formatBRL, formatDateBR, isOverdue } from '../constants';

export default function OrderCard({ order, dragging, onClick }) {
  const overdue = isOverdue(order.due_date) && order.status !== 'entregue';

  return (
    <div
      onClick={onClick}
      className={`group bg-white rounded-2xl p-3.5 border border-black/5 cursor-pointer select-none transition-all duration-200 hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5 hover:border-brand-300 ${
        dragging ? 'shadow-2xl shadow-brand-900/20 ring-2 ring-brand-400 rotate-2 scale-[1.03]' : 'shadow-sm'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-[11px] font-extrabold text-brand-600 tracking-wider">
          {order.order_number}
          {order.pickup_code && (
            <span
              title="Código de retirada"
              className="flex items-center gap-0.5 text-[10px] font-extrabold text-slate-500 bg-black/[0.05] px-1.5 py-0.5 rounded-md tracking-widest"
            >
              <KeyRound size={9} /> {order.pickup_code}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {order.case_color && (
            <span
              title={`Estojo ${order.case_color}`}
              className={`w-3 h-3 rounded-full ring-2 ring-white shadow ${CASE_COLOR_DOT[order.case_color] || 'bg-slate-300'}`}
            />
          )}
          {order.product_type && (
            <span className="text-[9px] font-extrabold uppercase tracking-wide bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
              {order.product_type}
            </span>
          )}
        </div>
      </div>

      <p className="font-bold text-sm text-brand-950 leading-snug mb-1">{order.customer_name}</p>

      {(order.payment_status === 'pago' ||
        order.payment_status === 'sinal' ||
        (order.status === 'entregue' && (!order.has_invoice || order.payment_status === 'pendente'))) && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {order.payment_status === 'pago' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
              <CheckCircle2 size={11} /> Pago
            </span>
          )}
          {order.payment_status === 'sinal' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-yellow-800 bg-sun-100 px-2 py-0.5 rounded-full">
              <CircleDollarSign size={11} /> Sinal
            </span>
          )}
          {order.status === 'entregue' && order.payment_status === 'pendente' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-flame-700 bg-flame-50 px-2 py-0.5 rounded-full">
              <CircleDollarSign size={11} /> Pgto pendente
            </span>
          )}
          {order.status === 'entregue' && !order.has_invoice && (
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-yellow-800 bg-sun-100 px-2 py-0.5 rounded-full">
              <FileWarning size={11} /> Anexar NF
            </span>
          )}
        </div>
      )}

      {order.description && (
        <p className="text-xs text-slate-500 line-clamp-2 mb-2.5 leading-relaxed">{order.description}</p>
      )}

      <div className="flex items-center gap-3 text-xs">
        {order.due_date && (
          <span
            className={`flex items-center gap-1 font-semibold ${
              overdue ? 'text-flame-600 bg-flame-50 px-2 py-0.5 rounded-full' : 'text-slate-400'
            }`}
          >
            <Calendar size={11} /> {formatDateBR(order.due_date)}
          </span>
        )}
        {order.value && <span className="font-extrabold text-brand-700">{formatBRL(order.value)}</span>}
        {order.attachments_count > 0 && (
          <span className="flex items-center gap-0.5 font-bold text-slate-400" title={`${order.attachments_count} arquivo(s)`}>
            <Paperclip size={11} /> {order.attachments_count}
          </span>
        )}
        {order.phone && (
          <a
            href={`https://wa.me/${order.phone}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Abrir conversa no WhatsApp"
            className="ml-auto p-1.5 -m-1 rounded-full text-brand-500 opacity-60 group-hover:opacity-100 hover:bg-brand-50 transition-all"
          >
            <MessageCircle size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
