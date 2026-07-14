import React, { useCallback, useEffect, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, MessageCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { COLUMNS } from '../constants';
import OrderCard from './OrderCard';
import OrderModal from './OrderModal';
import { useToast } from './Toast';

export default function Board({ onAuthError }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'new' | order object
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setOrders(await api.listOrders());
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const notifyResult = (notification, orderNumber) => {
    if (!notification) return;
    if (notification.sent) {
      toast(`WhatsApp enviado para o cliente do pedido ${orderNumber} ✅`, 'success');
    } else if (notification.error) {
      toast(`Pedido ${orderNumber}: falha no WhatsApp — ${notification.error}`, 'error', 8000);
    } else if (notification.reason && !notification.reason.includes('sem mensagem automática')) {
      toast(`Pedido ${orderNumber}: ${notification.reason}`, 'info');
    }
  };

  const onDragEnd = async ({ draggableId, destination, source }) => {
    if (!destination || destination.droppableId === source.droppableId) return;
    const id = Number(draggableId);
    const status = destination.droppableId;
    const previous = orders;
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      const { order, notification } = await api.moveOrder(id, status);
      setOrders((prev) => prev.map((o) => (o.id === id ? order : o)));
      notifyResult(notification, order.order_number);
    } catch (err) {
      setOrders(previous);
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const handleSaved = (order, isNew) => {
    setModal(null);
    setOrders((prev) =>
      isNew ? [...prev, order] : prev.map((o) => (o.id === order.id ? order : o))
    );
    toast(isNew ? `Pedido ${order.order_number} criado!` : `Pedido ${order.order_number} atualizado.`, 'success');
  };

  const handleDeleted = (order) => {
    setModal(null);
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    toast(`Pedido ${order.order_number} excluído.`, 'info');
  };

  const handleArchived = (order) => {
    setModal(null);
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    toast(`Pedido ${order.order_number} arquivado.`, 'info');
  };

  const handleResend = async (order, status) => {
    try {
      const { notification } = await api.notifyOrder(order.id, status);
      notifyResult(notification, order.order_number);
      if (notification && !notification.sent && notification.reason) {
        toast(notification.reason, 'info');
      }
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Arraste os cards entre as colunas. Ao chegar em{' '}
          <span className="font-semibold text-emerald-600">Pronto</span> e{' '}
          <span className="font-semibold text-slate-600">Entregue</span>, o cliente recebe WhatsApp
          automático <MessageCircle size={14} className="inline -mt-0.5" />.
        </p>
        <div className="flex gap-2">
          <button
            onClick={load}
            title="Atualizar"
            className="p-2.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-800 shadow-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setModal('new')}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 rounded-lg shadow-sm"
          >
            <Plus size={16} /> Novo Pedido
          </button>
        </div>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-x-auto px-6 pb-6 pt-2">
          <div className="grid grid-cols-4 gap-4 min-w-[900px] h-full">
            {COLUMNS.map((col) => {
              const cards = orders.filter((o) => o.status === col.id);
              return (
                <div key={col.id} className="flex flex-col bg-slate-200/60 rounded-xl max-h-full">
                  <div className="flex items-center gap-2 px-3 py-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                    <h2 className="font-bold text-sm text-slate-700">{col.title}</h2>
                    {col.whatsapp && <MessageCircle size={13} className="text-emerald-600" title="Envia WhatsApp automático" />}
                    <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${col.badge}`}>
                      {cards.length}
                    </span>
                  </div>
                  <Droppable droppableId={col.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex-1 overflow-y-auto px-2 pb-2 space-y-2 rounded-b-xl transition-colors ${
                          snapshot.isDraggingOver ? 'bg-emerald-100/60' : ''
                        }`}
                      >
                        {cards.map((order, index) => (
                          <Draggable key={order.id} draggableId={String(order.id)} index={index}>
                            {(prov, snap) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                style={prov.draggableProps.style}
                              >
                                <OrderCard
                                  order={order}
                                  dragging={snap.isDragging}
                                  onClick={() => setModal(order)}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {!cards.length && !loading && (
                          <p className="text-xs text-slate-400 text-center py-6">Nenhum pedido</p>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </div>
      </DragDropContext>

      {modal && (
        <OrderModal
          order={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onArchived={handleArchived}
          onResend={handleResend}
          onAuthError={onAuthError}
        />
      )}
    </div>
  );
}
