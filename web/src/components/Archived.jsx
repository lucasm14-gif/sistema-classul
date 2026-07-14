import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api';
import { formatBRL, formatDateBR, COLUMNS } from '../constants';
import { useToast } from './Toast';

export default function Archived({ onAuthError }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setOrders(await api.listOrders(true));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (order) => {
    try {
      await api.archiveOrder(order.id, false);
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      toast(`Pedido ${order.order_number} restaurado para o quadro.`, 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const remove = async (order) => {
    if (!confirm(`Excluir definitivamente o pedido ${order.order_number}?`)) return;
    try {
      await api.deleteOrder(order.id);
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      toast(`Pedido ${order.order_number} excluído.`, 'info');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto animate-fade-up">
      <div className="mb-4">
        <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Pedidos arquivados</h2>
        <p className="text-xs font-medium text-slate-400">Fora do quadro, mas guardados no histórico.</p>
      </div>
      {loading ? (
        <p className="text-sm font-medium text-slate-400">Carregando…</p>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 bg-black/[0.02] border border-dashed border-black/10 rounded-3xl">
          <p className="text-sm font-bold text-slate-400">Nenhum pedido arquivado.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-black/5 divide-y divide-black/5 overflow-hidden">
          {orders.map((order) => (
            <div key={order.id} className="flex items-center gap-4 px-5 py-3.5 text-sm">
              <span className="font-extrabold text-brand-600 text-xs w-14">{order.order_number}</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-brand-950 truncate">{order.customer_name}</p>
                <p className="text-xs font-medium text-slate-400 truncate">
                  {[order.product_type, order.value && formatBRL(order.value), order.due_date && formatDateBR(order.due_date)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {COLUMNS.find((c) => c.id === order.status)?.title}
              </span>
              <button
                onClick={() => restore(order)}
                title="Restaurar para o quadro"
                className="p-2 rounded-full text-brand-600 hover:bg-brand-50 transition-colors"
              >
                <RotateCcw size={16} />
              </button>
              <button
                onClick={() => remove(order)}
                title="Excluir definitivamente"
                className="p-2 rounded-full text-flame-500 hover:bg-flame-50 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
