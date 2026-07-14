import React, { useEffect, useState } from 'react';
import {
  X,
  LoaderCircle,
  Save,
  Trash2,
  Archive,
  Send,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { api } from '../api';
import { CASE_COLORS, PRODUCT_TYPES, COLUMNS } from '../constants';

const formatDateTime = (value) => {
  const d = new Date(value);
  return isNaN(d) ? value : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const emptyForm = {
  customer_name: '',
  phone: '',
  description: '',
  product_type: 'Maquina',
  case_color: '',
  value: '',
  due_date: ''
};

export default function OrderModal({ order, onClose, onSaved, onDeleted, onArchived, onResend, onAuthError }) {
  const isNew = !order;
  const [form, setForm] = useState(order ? { ...emptyForm, ...order, phone: order.phone || '' } : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [clients, setClients] = useState([]);

  useEffect(() => {
    if (!order) return;
    api
      .getOrder(order.id)
      .then((full) => setMessages(full.messages || []))
      .catch((err) => onAuthError(err));
  }, [order, onAuthError]);

  // Autocomplete de clientes ao criar pedido novo
  useEffect(() => {
    if (!isNew) return;
    api.listClients().then(setClients).catch(() => {});
  }, [isNew]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const setCustomerName = (e) => {
    const name = e.target.value;
    const match = clients.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    setForm((f) => ({
      ...f,
      customer_name: name,
      // ao escolher um cliente conhecido, puxa o telefone dele
      phone: match && match.phone && !f.phone ? match.phone : f.phone
    }));
  };

  const save = async () => {
    if (!form.customer_name.trim()) {
      setError('Preencha o nome do cliente.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      customer_name: form.customer_name,
      phone: form.phone,
      description: form.description,
      product_type: form.product_type,
      case_color: form.case_color,
      value: form.value,
      due_date: form.due_date
    };
    try {
      const saved = isNew ? await api.createOrder(payload) : await api.updateOrder(order.id, payload);
      onSaved(saved, isNew);
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Excluir o pedido ${order.order_number}? Essa ação não pode ser desfeita.`)) return;
    try {
      await api.deleteOrder(order.id);
      onDeleted(order);
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    }
  };

  const archive = async () => {
    try {
      await api.archiveOrder(order.id, true);
      onArchived(order);
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    }
  };

  const choice = (options, selected, onSelect, colorMap) => (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(selected === opt ? '' : opt)}
          className={`text-xs font-semibold rounded-lg border px-2 py-2 transition-colors ${
            selected === opt
              ? colorMap?.[opt] || 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );

  const label = 'block text-[11px] font-bold text-slate-500 uppercase mb-1.5';
  const input =
    'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <h2 className="font-bold">
            {isNew ? 'Novo Pedido' : `Pedido ${order.order_number}`}
            {!isNew && (
              <span className="ml-3 text-xs font-medium text-slate-300">
                {COLUMNS.find((c) => c.id === order.status)?.title}
              </span>
            )}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Nome do Cliente *</label>
            <input
              className={input}
              value={form.customer_name}
              onChange={isNew ? setCustomerName : set('customer_name')}
              placeholder="Nome do cliente"
              list={isNew ? 'clients-datalist' : undefined}
            />
            {isNew && (
              <datalist id="clients-datalist">
                {clients.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            )}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Telefone (WhatsApp)</label>
            <input className={input} value={form.phone} onChange={set('phone')} placeholder="5551999999999" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Data de Entrega</label>
            <input type="date" className={input} value={form.due_date || ''} onChange={set('due_date')} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Valor (R$)</label>
            <input className={input} inputMode="decimal" value={form.value || ''} onChange={set('value')} placeholder="150,00" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Tipo</label>
            {choice(PRODUCT_TYPES, form.product_type, (v) => setForm((f) => ({ ...f, product_type: v })))}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Estojo</label>
            {choice(CASE_COLORS, form.case_color, (v) => setForm((f) => ({ ...f, case_color: v })), {
              Preto: 'bg-slate-900 text-white border-slate-900',
              Azul: 'bg-blue-100 text-blue-700 border-blue-400',
              Vermelho: 'bg-red-100 text-red-700 border-red-400'
            })}
          </div>
          <div className="col-span-2">
            <label className={label}>Descrição</label>
            <textarea
              className={`${input} h-24 resize-none`}
              value={form.description || ''}
              onChange={set('description')}
              placeholder="Detalhes do pedido..."
            />
          </div>

          {!isNew && (
            <div className="col-span-2">
              <label className={label}>Mensagens WhatsApp enviadas</label>
              {messages.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhuma mensagem enviada ainda.</p>
              ) : (
                <ul className="space-y-2">
                  {messages.map((m) => (
                    <li key={m.id} className="bg-white border border-slate-200 rounded-lg p-3 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        {m.success ? (
                          <CheckCircle2 size={14} className="text-emerald-600" />
                        ) : (
                          <XCircle size={14} className="text-red-600" />
                        )}
                        <span className="font-bold uppercase text-slate-600">{m.status_trigger}</span>
                        <span className="text-slate-400 ml-auto">{formatDateTime(m.created_at)}</span>
                      </div>
                      {m.success ? (
                        <p className="text-slate-500 line-clamp-2 whitespace-pre-line">{m.body}</p>
                      ) : (
                        <p className="text-red-600">{m.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {(order.status === 'pronto' || order.status === 'entregue') && (
                <button
                  onClick={() => onResend(order, order.status)}
                  className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
                >
                  <Send size={13} /> Reenviar mensagem da etapa atual
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-2">
          {!isNew && (
            <>
              <button
                onClick={remove}
                title="Excluir pedido"
                className="p-2.5 rounded-lg text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={archive}
                title="Arquivar pedido"
                className="p-2.5 rounded-lg text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200"
              >
                <Archive size={16} />
              </button>
            </>
          )}
          {error && <p className="text-sm text-red-600 ml-2">{error}</p>}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 flex items-center gap-2 disabled:opacity-60"
            >
              {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
              {isNew ? 'Criar Pedido' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
