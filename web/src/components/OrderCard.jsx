import React from 'react';
import { Calendar, Phone } from 'lucide-react';
import { CASE_COLOR_DOT, formatBRL, formatDateBR, isOverdue } from '../constants';

export default function OrderCard({ order, dragging, onClick }) {
  const overdue = isOverdue(order.due_date) && order.status !== 'entregue';

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg p-3 shadow-sm border border-slate-200 cursor-pointer hover:shadow-md transition-shadow select-none ${
        dragging ? 'shadow-xl ring-2 ring-emerald-400 rotate-1' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-black text-slate-400 tracking-wide">{order.order_number}</span>
        <div className="flex items-center gap-1.5">
          {order.case_color && (
            <span
              title={`Estojo ${order.case_color}`}
              className={`w-3 h-3 rounded-full border border-white shadow ${CASE_COLOR_DOT[order.case_color] || 'bg-slate-300'}`}
            />
          )}
          {order.product_type && (
            <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
              {order.product_type}
            </span>
          )}
        </div>
      </div>

      <p className="font-semibold text-sm text-slate-800 leading-snug mb-1.5">{order.customer_name}</p>

      {order.description && (
        <p className="text-xs text-slate-500 line-clamp-2 mb-2">{order.description}</p>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-500">
        {order.due_date && (
          <span className={`flex items-center gap-1 ${overdue ? 'text-red-600 font-bold' : ''}`}>
            <Calendar size={12} /> {formatDateBR(order.due_date)}
          </span>
        )}
        {order.value && <span className="font-semibold text-emerald-700">{formatBRL(order.value)}</span>}
        {order.phone && (
          <a
            href={`https://wa.me/${order.phone}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Abrir conversa no WhatsApp"
            className="ml-auto text-emerald-600 hover:text-emerald-800"
          >
            <Phone size={13} />
          </a>
        )}
      </div>
    </div>
  );
}
