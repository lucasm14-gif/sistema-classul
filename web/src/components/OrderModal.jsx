import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  LoaderCircle,
  Save,
  Trash2,
  Archive,
  RotateCcw,
  Send,
  CheckCircle2,
  XCircle,
  Paperclip,
  FileText,
  ExternalLink,
  Receipt,
  FileWarning
} from 'lucide-react';
import { api } from '../api';
import { CASE_COLORS, PRODUCT_TYPES, COLUMNS, PAYMENT_STATUSES } from '../constants';
import { useToast } from './Toast';

const formatDateTime = (value) => {
  const d = new Date(value);
  return isNaN(d) ? value : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const formatBytes = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const emptyForm = {
  customer_name: '',
  phone: '',
  description: '',
  product_type: 'Maquina',
  case_color: '',
  value: '',
  due_date: '',
  payment_status: 'pendente'
};

export default function OrderModal({ order, onClose, onSaved, onDeleted, onArchived, onAuthError }) {
  const isNew = !order;
  const toast = useToast();
  const [form, setForm] = useState(order ? { ...emptyForm, ...order, phone: order.phone || '' } : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [clients, setClients] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const uploadCategoryRef = useRef('arquivo');

  useEffect(() => {
    if (!order) return;
    api
      .getOrder(order.id)
      .then((full) => {
        setMessages(full.messages || []);
        setAttachments(full.attachments || []);
      })
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
      due_date: form.due_date,
      payment_status: form.payment_status || 'pendente'
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

  // arquiva ou restaura, dependendo do estado atual do pedido
  const toggleArchive = async () => {
    try {
      const updated = await api.archiveOrder(order.id, !order.archived);
      onArchived(updated);
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    }
  };

  const resend = async () => {
    try {
      const { notification } = await api.notifyOrder(order.id, order.status);
      if (notification?.sent) {
        toast(`WhatsApp reenviado para o cliente do pedido ${order.order_number} ✅`, 'success');
      } else {
        toast(notification?.error || notification?.reason || 'Não foi possível enviar.', notification?.error ? 'error' : 'info', 7000);
      }
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    }
  };

  const pickFile = (category) => {
    uploadCategoryRef.current = category;
    fileInputRef.current?.click();
  };

  const uploadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const category = uploadCategoryRef.current;
    setUploading(true);
    setError('');
    try {
      const { uploadUrl } = await api.createUploadSession(order.id, {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        category
      });
      // envia o arquivo direto do navegador para o Google Drive
      const up = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      if (!up.ok) throw new Error(`Falha no envio para o Google Drive (${up.status}).`);
      const uploaded = await up.json();
      const attachment = await api.registerAttachment(order.id, uploaded.id, category);
      setAttachments((prev) => [attachment, ...prev]);
    } catch (err) {
      if (!onAuthError(err)) setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const hasInvoice = attachments.some((a) => a.category === 'nota_fiscal');

  const removeAttachment = async (attachment) => {
    if (!confirm(`Excluir o arquivo "${attachment.name}" do Google Drive?`)) return;
    try {
      await api.deleteAttachment(attachment.id);
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
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
          className={`text-xs font-bold rounded-xl border-2 px-2 py-2.5 transition-all ${
            selected === opt
              ? colorMap?.[opt] || 'bg-brand-600 text-white border-brand-600 shadow-md shadow-brand-600/20'
              : 'bg-white text-slate-500 border-slate-200 hover:border-brand-300'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );

  const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2';
  const input =
    'w-full border-2 border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white';

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
            <img src="/logo.png" alt="" className="w-9 h-9 object-contain" />
            <h2 className="font-extrabold tracking-tight text-brand-950">
              {isNew ? 'Novo Pedido' : `Pedido ${order.order_number}`}
              {!isNew && (
                <span className="ml-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {COLUMNS.find((c) => c.id === order.status)?.title}
                  {order.archived ? ' · arquivado' : ''}
                </span>
              )}
            </h2>
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
            <label className={label}>Pagamento</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_STATUSES.map(({ id, label: lbl }) => {
                const selected = (form.payment_status || 'pendente') === id;
                const activeStyle = {
                  pendente: 'bg-slate-600 text-white border-slate-600 shadow-md',
                  sinal: 'bg-sun-100 text-yellow-800 border-sun-400',
                  pago: 'bg-brand-600 text-white border-brand-600 shadow-md shadow-brand-600/20'
                }[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, payment_status: id }))}
                    className={`text-xs font-bold rounded-xl border-2 px-2 py-2.5 transition-all ${
                      selected ? activeStyle : 'bg-white text-slate-500 border-slate-200 hover:border-brand-300'
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Tipo</label>
            {choice(PRODUCT_TYPES, form.product_type, (v) => setForm((f) => ({ ...f, product_type: v })))}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label}>Estojo</label>
            {choice(CASE_COLORS, form.case_color, (v) => setForm((f) => ({ ...f, case_color: v })), {
              Preto: 'bg-brand-950 text-white border-brand-950 shadow-md',
              Azul: 'bg-sky-100 text-sky-700 border-sky-400',
              Vermelho: 'bg-flame-100 text-flame-700 border-flame-500'
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
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <label className={`${label} mb-0 mr-auto`}>Arquivos do pedido (Google Drive)</label>
                <button
                  onClick={() => pickFile('arquivo')}
                  disabled={uploading}
                  className="flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:text-brand-900 transition-colors disabled:opacity-60"
                >
                  {uploading && uploadCategoryRef.current === 'arquivo' ? (
                    <LoaderCircle size={13} className="animate-spin" />
                  ) : (
                    <Paperclip size={13} />
                  )}
                  Anexar arquivo
                </button>
                <button
                  onClick={() => pickFile('nota_fiscal')}
                  disabled={uploading}
                  className="flex items-center gap-1.5 text-xs font-extrabold text-yellow-700 hover:text-yellow-900 transition-colors disabled:opacity-60"
                >
                  {uploading && uploadCategoryRef.current === 'nota_fiscal' ? (
                    <LoaderCircle size={13} className="animate-spin" />
                  ) : (
                    <Receipt size={13} />
                  )}
                  Anexar NF
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} />
              </div>

              {order.status === 'entregue' && !hasInvoice && (
                <div className="flex items-start gap-2.5 bg-sun-100 border border-sun-300/60 rounded-xl px-3.5 py-3 mb-2.5">
                  <FileWarning size={16} className="text-yellow-700 shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-yellow-800 leading-relaxed">
                    Pedido entregue sem nota fiscal anexada. Use o botão{' '}
                    <span className="whitespace-nowrap">"Anexar NF"</span> acima para regularizar.
                  </p>
                </div>
              )}

              {attachments.length === 0 ? (
                <p className="text-xs font-medium text-slate-400">
                  Nenhum arquivo ainda. Os anexos ficam numa pasta do pedido no seu Google Drive.
                </p>
              ) : (
                <ul className="space-y-2">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="bg-white border border-black/5 rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-3 shadow-sm"
                    >
                      {a.category === 'nota_fiscal' ? (
                        <Receipt size={15} className="text-yellow-600 shrink-0" />
                      ) : (
                        <FileText size={15} className="text-brand-600 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{a.name}</span>
                      {a.category === 'nota_fiscal' && (
                        <span className="text-[9px] font-extrabold uppercase bg-sun-100 text-yellow-700 px-2 py-0.5 rounded-full shrink-0">
                          NF
                        </span>
                      )}
                      {a.size && <span className="text-slate-400 font-medium shrink-0">{formatBytes(a.size)}</span>}
                      {a.web_view_link && (
                        <a
                          href={a.web_view_link}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir no Google Drive"
                          className="p-1.5 rounded-full text-brand-600 hover:bg-brand-50 transition-colors shrink-0"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <button
                        onClick={() => removeAttachment(a)}
                        title="Excluir arquivo"
                        className="p-1.5 rounded-full text-flame-500 hover:bg-flame-50 transition-colors shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!isNew && (
            <div className="col-span-2">
              <label className={label}>Mensagens WhatsApp enviadas</label>
              {messages.length === 0 ? (
                <p className="text-xs font-medium text-slate-400">Nenhuma mensagem enviada ainda.</p>
              ) : (
                <ul className="space-y-2">
                  {messages.map((m) => (
                    <li key={m.id} className="bg-white border border-black/5 rounded-xl p-3.5 text-xs shadow-sm">
                      <div className="flex items-center gap-2 mb-1.5">
                        {m.success ? (
                          <CheckCircle2 size={14} className="text-brand-600" />
                        ) : (
                          <XCircle size={14} className="text-flame-600" />
                        )}
                        <span className="font-extrabold uppercase tracking-wide text-brand-900">
                          {m.status_trigger}
                        </span>
                        <span className="text-slate-400 font-medium ml-auto">{formatDateTime(m.created_at)}</span>
                      </div>
                      {m.success ? (
                        <p className="text-slate-500 line-clamp-2 whitespace-pre-line leading-relaxed">{m.body}</p>
                      ) : (
                        <p className="text-flame-600 font-medium">{m.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {(order.status === 'pronto' || order.status === 'entregue') && (
                <button
                  onClick={resend}
                  className="mt-3 flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:text-brand-900 transition-colors"
                >
                  <Send size={13} /> Reenviar mensagem da etapa atual
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-black/5 flex items-center gap-2 bg-white">
          {!isNew && (
            <>
              <button
                onClick={remove}
                title="Excluir pedido"
                className="p-2.5 rounded-full text-flame-600 hover:bg-flame-50 transition-colors"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={toggleArchive}
                title={order.archived ? 'Restaurar para o quadro' : 'Arquivar pedido'}
                className={`p-2.5 rounded-full transition-colors ${
                  order.archived
                    ? 'text-brand-600 hover:bg-brand-50'
                    : 'text-slate-400 hover:bg-black/5 hover:text-brand-950'
                }`}
              >
                {order.archived ? <RotateCcw size={16} /> : <Archive size={16} />}
              </button>
            </>
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
              {isNew ? 'Criar Pedido' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
