import React, { useCallback, useEffect, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, MessageCircle, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import { COLUMNS } from '../constants';
import OrderCard from './OrderCard';
import OrderModal from './OrderModal';
import { useToast } from './Toast';

export default function Board({ onAuthError }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'new' | order object
  const [search, setSearch] = useState('');
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
      const pendencias = [];
      if (status === 'entregue' && !order.has_invoice) pendencias.push('nota fiscal');
      if (status === 'entregue' && order.payment_status !== 'pago') pendencias.push('pagamento');
      if (pendencias.length) {
        toast(
          `📄 Pedido ${order.order_number} entregue com pendência: ${pendencias.join(' e ')}. Abra o card para resolver.`,
          'info',
          8000
        );
      }
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

  const term = search.trim().toLowerCase();
  const visible = term
    ? orders.filter(
        (o) =>
          o.customer_name.toLowerCase().includes(term) ||
          o.order_number.includes(term) ||
          String(o.id) === term.replace(/\D/g, '') ||
          (o.pickup_code || '').includes(term) ||
          (o.description || '').toLowerCase().includes(term)
      )
    : orders;

  return (
    <div className="h-full flex flex-col animate-fade-up">
      <div className="px-4 sm:px-6 pt-5 pb-3 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Quadro de Pedidos</h2>
          <p className="text-xs font-medium text-slate-400">
            Em <span className="font-bold text-brand-600">Pronto</span> e{' '}
            <span className="font-bold text-slate-500">Entregue</span> o cliente recebe WhatsApp automático{' '}
            <MessageCircle size={12} className="inline -mt-0.5 text-brand-500" />
          </p>
        </div>

        <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pedido ou cliente..."
            className="w-full bg-white border border-black/5 rounded-full pl-9 pr-4 py-2.5 text-sm font-medium outline-none transition-colors focus:border-brand-400 shadow-sm"
          />
        </div>
        <button
          onClick={load}
          title="Atualizar"
          className="p-2.5 rounded-full bg-white border border-black/5 text-slate-400 hover:text-brand-700 shadow-sm transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setModal('new')}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-extrabold px-5 py-2.5 rounded-full shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand-600/30"
        >
          <Plus size={16} strokeWidth={3} /> Novo Pedido
        </button>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-x-auto px-4 sm:px-6 pb-6 pt-1">
          <div className="grid grid-cols-4 gap-4 min-w-[920px] h-full">
            {COLUMNS.map((col) => {
              const cards = visible.filter((o) => o.status === col.id);
              return (
                <div
                  key={col.id}
                  className="flex flex-col bg-black/[0.03] border border-black/5 rounded-3xl max-h-full"
                >
                  <div className="flex items-center gap-2 px-4 py-3.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                    <h2 className="font-extrabold text-[13px] tracking-tight text-brand-950">{col.title}</h2>
                    {col.whatsapp && (
                      <MessageCircle size={12} className="text-brand-500" title="Envia WhatsApp automático" />
                    )}
                    <span className={`ml-auto text-[11px] font-extrabold px-2.5 py-0.5 rounded-full ${col.badge}`}>
                      {cards.length}
                    </span>
                  </div>
                  <Droppable droppableId={col.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-2.5 rounded-b-3xl transition-colors ${
                          snapshot.isDraggingOver ? 'bg-brand-100/60' : ''
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
                          <p className="text-xs font-medium text-slate-300 text-center py-8">Nenhum pedido</p>
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
          onAuthError={onAuthError}
        />
      )}
    </div>
  );
}
