import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Phone,
  Building2,
  LoaderCircle,
  Save,
  Trash2,
  X,
  ChevronRight,
  MessageCircle
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { COLUMNS, formatBRL, formatDateBR, parseBRL } from '../constants';
import { useToast } from './Toast';
import OrderModal from './OrderModal';

const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2';
const input =
  'w-full border-2 border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white';

const STATUS_BADGE = {
  novo: 'bg-sky-100 text-sky-700',
  producao: 'bg-sun-100 text-yellow-700',
  pronto: 'bg-brand-100 text-brand-700',
  entregue: 'bg-slate-200 text-slate-600'
};

function formatPhoneBR(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone || '';
}

const emptyForm = { name: '', phone: '', email: '', company: '', notes: '' };

function ClientModal({ client, onClose, onSaved, onDeleted, onAuthError }) {
  const isNew = !client;
  const [form, setForm] = useState(client ? { ...emptyForm, ...client } : emptyForm);
  const [orders, setOrders] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [orderModal, setOrderModal] = useState(null);
  const toast = useToast();

  const reloadOrders = useCallback(() => {
    if (!client) return;
    api
      .getClient(client.id)
      .then((full) => setOrders(full.orders || []))
      .catch((err) => onAuthError(err));
  }, [client, onAuthError]);

  useEffect(() => {
    reloadOrders();
  }, [reloadOrders]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const save = async () => {
    if (!String(form.name || '').trim()) {
      setError('Preencha o nome do cliente.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name: form.name,
      phone: form.phone || '',
      email: form.email || '',
      company: form.company || '',
      notes: form.notes || ''
    };
    try {
      const saved = isNew ? await api.createClient(payload) : await api.updateClient(client.id, payload);
      onSaved(saved, isNew);
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Excluir o cliente "${client.name}"? Os pedidos dele não são apagados, só perdem o vínculo.`))
      return;
    try {
      await api.deleteClient(client.id);
      onDeleted(client);
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    }
  };

  const total = (orders || []).reduce((sum, o) => sum + parseBRL(o.value), 0);

  return createPortal(
    <div
      className="fixed inset-0 bg-brand-950/60 backdrop-blur-sm z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-[1.75rem] shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-fade-up"
      >
        <div className="px-6 py-5 flex items-center justify-between border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-brand-500 text-white flex items-center justify-center font-extrabold text-lg shadow-md shadow-brand-500/30">
              {(form.name || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="font-extrabold tracking-tight text-brand-950 leading-tight">
                {isNew ? 'Novo Cliente' : form.name}
              </h2>
              {!isNew && orders && (
                <p className="text-xs font-semibold text-slate-400 leading-tight">
                  {orders.length} pedido{orders.length !== 1 ? 's' : ''}
                  {total > 0 && (
                    <>
                      {' '}· total <span className="text-brand-700">{formatBRL(String(total).replace('.', ','))}</span>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-brand-950 hover:bg-black/5 transition-colors"
          >
            <X size={19} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-[#F7F8F3] grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Nome *</label>
            <input className={input} value={form.name || ''} onChange={set('name')} placeholder="Nome do cliente" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Telefone (WhatsApp)</label>
            <input className={input} value={form.phone || ''} onChange={set('phone')} placeholder="5551999999999" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>E-mail</label>
            <input className={input} value={form.email || ''} onChange={set('email')} placeholder="cliente@email.com" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Empresa</label>
            <input className={input} value={form.company || ''} onChange={set('company')} placeholder="Nome da empresa" />
          </div>
          <div className="col-span-2">
            <label className={label}>Observações</label>
            <textarea
              className={`${input} h-20 resize-none`}
              value={form.notes || ''}
              onChange={set('notes')}
              placeholder="Preferências, endereço, detalhes de entrega..."
            />
          </div>

          {!isNew && (
            <div className="col-span-2">
              <label className={label}>Histórico de pedidos</label>
              {!orders ? (
                <p className="text-xs font-medium text-slate-400">Carregando…</p>
              ) : orders.length === 0 ? (
                <p className="text-xs font-medium text-slate-400">
                  Nenhum pedido vinculado ainda. Pedidos novos com o telefone deste cliente entram aqui sozinhos.
                </p>
              ) : (
                <ul className="space-y-2">
                  {orders.map((o) => (
                    <li
                      key={o.id}
                      onClick={() => setOrderModal(o)}
                      title="Abrir pedido completo"
                      className="bg-white border border-black/5 rounded-xl px-3.5 py-3 text-xs flex items-center gap-3 shadow-sm cursor-pointer transition-all hover:border-brand-300 hover:shadow-md group"
                    >
                      <span className="font-extrabold text-brand-600">{o.order_number}</span>
                      <span className="flex-1 min-w-0 truncate text-slate-500 font-medium">
                        {[o.product_type, o.description].filter(Boolean).join(' · ') || 'Sem descrição'}
                      </span>
                      {o.value && <span className="font-extrabold text-brand-700">{formatBRL(o.value)}</span>}
                      {o.due_date && <span className="text-slate-400 font-medium">{formatDateBR(o.due_date)}</span>}
                      <span className={`px-2.5 py-0.5 rounded-full font-extrabold ${STATUS_BADGE[o.status] || ''}`}>
                        {COLUMNS.find((c) => c.id === o.status)?.title || o.status}
                        {o.archived ? ' · arq.' : ''}
                      </span>
                      <ChevronRight
                        size={14}
                        className="text-slate-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all shrink-0"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-black/5 flex items-center gap-2 bg-white">
          {!isNew && (
            <button
              onClick={remove}
              title="Excluir cliente"
              className="p-2.5 rounded-full text-flame-600 hover:bg-flame-50 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
          {error && <p className="text-sm font-semibold text-flame-600 ml-2">{error}</p>}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-full text-sm font-bold text-slate-500 hover:bg-black/5 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-6 py-2.5 rounded-full text-sm font-extrabold text-white bg-brand-600 hover:bg-brand-700 flex items-center gap-2 shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
              {isNew ? 'Criar Cliente' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      {orderModal && (
        <OrderModal
          order={orderModal}
          onClose={() => setOrderModal(null)}
          onSaved={(saved) => {
            setOrderModal(null);
            reloadOrders();
            toast(`Pedido ${saved.order_number} atualizado.`, 'success');
          }}
          onDeleted={(o) => {
            setOrderModal(null);
            reloadOrders();
            toast(`Pedido ${o.order_number} excluído.`, 'info');
          }}
          onArchived={(o) => {
            setOrderModal(null);
            reloadOrders();
            toast(
              o.archived ? `Pedido ${o.order_number} arquivado.` : `Pedido ${o.order_number} restaurado para o quadro.`,
              'info'
            );
          }}
          onAuthError={onAuthError}
        />
      )}
    </div>,
    document.body
  );
}

export default function Clients({ onAuthError }) {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'new' | client
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setClients(await api.listClients());
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.phone || '').includes(term.replace(/\D/g, '') || ' ') ||
          (c.company || '').toLowerCase().includes(term)
      )
    : clients;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto h-full overflow-y-auto animate-fade-up">
      <div className="mb-4">
        <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Clientes</h2>
        <p className="text-xs font-medium text-slate-400">
          Criados automaticamente a cada pedido novo — ou cadastre manualmente.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou empresa..."
            className="w-full bg-white border border-black/5 rounded-full pl-9 pr-4 py-2.5 text-sm font-medium outline-none transition-colors focus:border-brand-400 shadow-sm"
          />
        </div>
        <button
          onClick={() => setModal('new')}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-extrabold px-5 py-2.5 rounded-full shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand-600/30"
        >
          <Plus size={16} strokeWidth={3} /> Novo Cliente
        </button>
      </div>

      {loading ? (
        <p className="text-sm font-medium text-slate-400">Carregando…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-black/[0.02] border border-dashed border-black/10 rounded-3xl">
          <p className="text-sm font-bold text-slate-400 mb-1">
            {clients.length === 0 ? 'Nenhum cliente cadastrado ainda.' : 'Nenhum cliente encontrado.'}
          </p>
          {clients.length === 0 && (
            <p className="text-xs font-medium text-slate-400">
              Clientes são criados automaticamente quando você cria pedidos.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-black/5 divide-y divide-black/5 overflow-hidden">
          {filtered.map((client) => (
            <div
              key={client.id}
              onClick={() => setModal(client)}
              className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-brand-50/50 transition-colors group"
            >
              <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-extrabold shrink-0 group-hover:bg-brand-500 group-hover:text-white transition-colors">
                {client.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-brand-950 truncate">{client.name}</p>
                <p className="text-xs font-medium text-slate-400 truncate flex items-center gap-2.5">
                  {client.phone && (
                    <span className="flex items-center gap-1">
                      <Phone size={11} /> {formatPhoneBR(client.phone)}
                    </span>
                  )}
                  {client.company && (
                    <span className="flex items-center gap-1">
                      <Building2 size={11} /> {client.company}
                    </span>
                  )}
                </p>
              </div>
              <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-black/[0.04] text-slate-500">
                {client.orders_count} pedido{client.orders_count !== 1 ? 's' : ''}
              </span>
              {client.phone && (
                <a
                  href={`https://wa.me/${client.phone}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Abrir conversa no WhatsApp"
                  className="p-2 rounded-full text-brand-600 hover:bg-brand-100 transition-colors"
                >
                  <MessageCircle size={16} />
                </a>
              )}
              <ChevronRight size={16} className="text-slate-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all" />
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ClientModal
          client={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onAuthError={onAuthError}
          onSaved={(saved, isNew) => {
            setModal(null);
            load();
            toast(isNew ? `Cliente "${saved.name}" criado!` : 'Cliente atualizado.', 'success');
          }}
          onDeleted={(client) => {
            setModal(null);
            setClients((prev) => prev.filter((c) => c.id !== client.id));
            toast(`Cliente "${client.name}" excluído.`, 'info');
          }}
        />
      )}
    </div>
  );
}
