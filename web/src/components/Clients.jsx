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
import { api } from '../api';
import { COLUMNS, formatBRL, formatDateBR, parseBRL } from '../constants';
import { useToast } from './Toast';

const label = 'block text-[11px] font-bold text-slate-500 uppercase mb-1.5';
const input =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

const STATUS_BADGE = {
  novo: 'bg-blue-100 text-blue-700',
  producao: 'bg-amber-100 text-amber-700',
  pronto: 'bg-emerald-100 text-emerald-700',
  entregue: 'bg-slate-200 text-slate-700'
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

  useEffect(() => {
    if (!client) return;
    api
      .getClient(client.id)
      .then((full) => setOrders(full.orders || []))
      .catch((err) => onAuthError(err));
  }, [client, onAuthError]);

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
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center font-bold">
              {(form.name || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="font-bold leading-tight">{isNew ? 'Novo Cliente' : form.name}</h2>
              {!isNew && orders && (
                <p className="text-xs text-slate-300 leading-tight">
                  {orders.length} pedido{orders.length !== 1 ? 's' : ''}
                  {total > 0 && <> · total {formatBRL(String(total).replace('.', ','))}</>}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 grid grid-cols-2 gap-4">
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
                <p className="text-xs text-slate-400">Carregando…</p>
              ) : orders.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Nenhum pedido vinculado ainda. Pedidos novos com o telefone deste cliente entram aqui sozinhos.
                </p>
              ) : (
                <ul className="space-y-2">
                  {orders.map((o) => (
                    <li
                      key={o.id}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-xs flex items-center gap-3"
                    >
                      <span className="font-black text-slate-400">{o.order_number}</span>
                      <span className="flex-1 min-w-0 truncate text-slate-600">
                        {[o.product_type, o.description].filter(Boolean).join(' · ') || 'Sem descrição'}
                      </span>
                      {o.value && <span className="font-semibold text-emerald-700">{formatBRL(o.value)}</span>}
                      {o.due_date && <span className="text-slate-400">{formatDateBR(o.due_date)}</span>}
                      <span className={`px-2 py-0.5 rounded-full font-bold ${STATUS_BADGE[o.status] || ''}`}>
                        {COLUMNS.find((c) => c.id === o.status)?.title || o.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center gap-2">
          {!isNew && (
            <button
              onClick={remove}
              title="Excluir cliente"
              className="p-2.5 rounded-lg text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200"
            >
              <Trash2 size={16} />
            </button>
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
              {isNew ? 'Criar Cliente' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
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
          (c.phone || '').includes(term.replace(/\D/g, '') || ' ') ||
          (c.company || '').toLowerCase().includes(term)
      )
    : clients;

  return (
    <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou empresa..."
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-emerald-500 shadow-sm"
          />
        </div>
        <button
          onClick={() => setModal('new')}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 rounded-lg shadow-sm"
        >
          <Plus size={16} /> Novo Cliente
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-slate-400 mb-1">
            {clients.length === 0 ? 'Nenhum cliente cadastrado ainda.' : 'Nenhum cliente encontrado.'}
          </p>
          {clients.length === 0 && (
            <p className="text-xs text-slate-400">
              Clientes são criados automaticamente quando você cria pedidos — ou cadastre manualmente.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 divide-y divide-slate-100">
          {filtered.map((client) => (
            <div
              key={client.id}
              onClick={() => setModal(client)}
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0">
                {client.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-800 truncate">{client.name}</p>
                <p className="text-xs text-slate-400 truncate flex items-center gap-2">
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
              <span className="text-xs font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                {client.orders_count} pedido{client.orders_count !== 1 ? 's' : ''}
              </span>
              {client.phone && (
                <a
                  href={`https://wa.me/${client.phone}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Abrir conversa no WhatsApp"
                  className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50"
                >
                  <MessageCircle size={16} />
                </a>
              )}
              <ChevronRight size={16} className="text-slate-300" />
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
