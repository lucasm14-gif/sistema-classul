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
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="font-bold text-slate-800 mb-4">Pedidos arquivados</h2>
      {loading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum pedido arquivado.</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-100">
          {orders.map((order) => (
            <div key={order.id} className="flex items-center gap-4 px-4 py-3 text-sm">
              <span className="font-black text-slate-400 text-xs w-14">{order.order_number}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{order.customer_name}</p>
                <p className="text-xs text-slate-400 truncate">
                  {[order.product_type, order.value && formatBRL(order.value), order.due_date && formatDateBR(order.due_date)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="text-xs text-slate-500">{COLUMNS.find((c) => c.id === order.status)?.title}</span>
              <button
                onClick={() => restore(order)}
                title="Restaurar para o quadro"
                className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50"
              >
                <RotateCcw size={16} />
              </button>
              <button
                onClick={() => remove(order)}
                title="Excluir definitivamente"
                className="p-2 rounded-lg text-red-500 hover:bg-red-50"
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
