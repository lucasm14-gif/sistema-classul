import React, { useCallback, useEffect, useState } from 'react';
import {
  Inbox as InboxIcon,
  Eye,
  EyeOff,
  Paperclip,
  Trash2,
  ExternalLink,
  FileText,
  RefreshCw,
  MessageCircle,
  Sparkles,
  Check,
  X,
  CheckCheck,
  Quote,
  LoaderCircle
} from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';
import { openWhatsApp } from '../whatsapp';

const card = 'bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden';

function formatPhoneBR(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone || '';
}

function formatWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const field =
  'w-full bg-black/[0.03] border border-black/5 rounded-xl px-3 py-2 text-sm font-medium text-brand-950 outline-none focus:border-brand-400 focus:bg-white transition-colors';
const fieldLabel = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5';

// Sugestão de pedido novo: os campos vêm preenchidos pela IA e são editáveis,
// porque conversa de WhatsApp é bagunçada e a extração erra.
function NewOrderSuggestion({ suggestion, onAccept, onDismiss }) {
  const d = suggestion.data || {};
  const [form, setForm] = useState({
    customer_name: d.cliente || suggestion.chat_name || '',
    product: d.produto || '',
    size: d.tamanho || '',
    value: d.valor || '',
    due_date: d.prazo || '',
    description: d.descricao || ''
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const accept = async () => {
    setBusy(true);
    await onAccept(suggestion, form);
    setBusy(false);
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
          <Sparkles size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-brand-950 text-sm">
            {suggestion.chat_name || formatPhoneBR(suggestion.phone)}
          </p>
          <p className="text-xs font-medium text-slate-500">{suggestion.summary}</p>
          {suggestion.stage_label && (
            <span className="inline-block mt-1.5 text-[10px] font-extrabold uppercase tracking-wide bg-black/[0.05] text-slate-500 px-2 py-0.5 rounded-full">
              {suggestion.stage_label}
            </span>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={fieldLabel}>Cliente</label>
          <input className={field} value={form.customer_name} onChange={set('customer_name')} />
        </div>
        <div>
          <label className={fieldLabel}>Produto</label>
          <input className={field} value={form.product} onChange={set('product')} placeholder="não identificado" />
        </div>
        <div>
          <label className={fieldLabel}>Tamanho</label>
          <input className={field} value={form.size} onChange={set('size')} placeholder="—" />
        </div>
        <div>
          <label className={fieldLabel}>Valor</label>
          <input className={field} value={form.value} onChange={set('value')} placeholder="—" />
        </div>
        <div>
          <label className={fieldLabel}>Entrega</label>
          <input type="date" className={field} value={form.due_date || ''} onChange={set('due_date')} />
        </div>
        <div className="sm:col-span-2">
          <label className={fieldLabel}>Descrição</label>
          <textarea className={`${field} h-20 resize-none`} value={form.description} onChange={set('description')} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onDismiss(suggestion)}
          className="flex items-center gap-1.5 text-xs font-extrabold text-slate-500 hover:text-flame-600 px-4 py-2.5 rounded-full transition-colors"
        >
          <X size={14} /> Descartar
        </button>
        <button
          onClick={accept}
          disabled={busy || !form.customer_name.trim()}
          className="ml-auto flex items-center gap-1.5 text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-full transition-colors disabled:opacity-40"
        >
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
          Criar pedido
        </button>
      </div>
    </div>
  );
}

// Aprovação da arte: o que libera a produção. Mostra a frase do cliente.
function ApprovalSuggestion({ suggestion, onAccept, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    await onAccept(suggestion, {});
    setBusy(false);
  };

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-xl bg-sun-100 text-yellow-700 flex items-center justify-center shrink-0">
          <CheckCheck size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-brand-950 text-sm">
            Arte aprovada
            {suggestion.order && (
              <span className="ml-2 text-brand-600">{suggestion.order.order_number}</span>
            )}
          </p>
          <p className="text-xs font-medium text-slate-500">
            {suggestion.chat_name || formatPhoneBR(suggestion.phone)} · {suggestion.summary}
          </p>
        </div>
      </div>

      {suggestion.data?.evidencia && (
        <blockquote className="flex gap-2 bg-black/[0.03] rounded-2xl px-4 py-3">
          <Quote size={13} className="text-slate-400 shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-slate-600 italic">"{suggestion.data.evidencia}"</p>
        </blockquote>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => onDismiss(suggestion)}
          className="flex items-center gap-1.5 text-xs font-extrabold text-slate-500 hover:text-flame-600 px-4 py-2.5 rounded-full transition-colors"
        >
          <X size={14} /> Não é aprovação
        </button>
        <button
          onClick={accept}
          disabled={busy || !suggestion.order}
          className="ml-auto flex items-center gap-1.5 text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-full transition-colors disabled:opacity-40"
        >
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
          Mover para produção
        </button>
      </div>
    </div>
  );
}

function FileRow({ file, orders, onAttach, onDelete }) {
  const [orderId, setOrderId] = useState('');
  const [busy, setBusy] = useState(false);

  const attach = async () => {
    if (!orderId) return;
    setBusy(true);
    await onAttach(file, Number(orderId));
    setBusy(false);
  };

  return (
    <div className="px-5 py-3.5 flex flex-wrap items-center gap-3 text-sm">
      <FileText size={16} className="text-brand-600 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-brand-950 truncate">{file.name}</p>
        <p className="text-[11px] font-medium text-slate-400">
          {file.chat_name || formatPhoneBR(file.phone)} · {formatWhen(file.created_at)}
          {file.size ? ` · ${formatBytes(file.size)}` : ''}
        </p>
      </div>

      {file.web_view_link && (
        <a
          href={file.web_view_link}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir no Drive"
          className="p-2 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-black/5 transition-colors shrink-0"
        >
          <ExternalLink size={15} />
        </a>
      )}

      <select
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        className="bg-black/[0.03] border border-black/5 rounded-xl px-3 py-2 text-xs font-bold text-brand-950 outline-none focus:border-brand-400 max-w-[15rem]"
      >
        <option value="">Anexar ao pedido…</option>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.order_number} · {o.customer_name}
          </option>
        ))}
      </select>

      <button
        onClick={attach}
        disabled={!orderId || busy}
        className="flex items-center gap-1.5 text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-full transition-colors disabled:opacity-40 shrink-0"
      >
        <Paperclip size={13} /> Anexar
      </button>

      <button
        onClick={() => onDelete(file)}
        title="Excluir arquivo"
        className="p-2 rounded-lg text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors shrink-0"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export default function Inbox({ onAuthError }) {
  const [files, setFiles] = useState(null);
  const [chats, setChats] = useState([]);
  const [orders, setOrders] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [analyzing, setAnalyzing] = useState(null);
  const toast = useToast();

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        const [f, c, o, sg] = await Promise.all([
          api.listInboxFiles(),
          api.listWatchedChats(),
          api.listOrders(),
          api.listSuggestions()
        ]);
        setFiles(f);
        setChats(c);
        setOrders(o);
        setSuggestions(sg);
      } catch (err) {
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      }
    },
    [onAuthError, toast]
  );

  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), 30000);
    return () => clearInterval(id);
  }, [load]);

  const attach = async (file, orderId) => {
    try {
      await api.attachInboxFile(file.id, orderId);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      const order = orders.find((o) => o.id === orderId);
      toast(`Arquivo anexado ao pedido ${order?.order_number || ''}.`, 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const acceptSuggestion = async (suggestion, form) => {
    try {
      const result = await api.acceptSuggestion(suggestion.id, form);
      setSuggestions((prev) => prev.filter((x) => x.id !== suggestion.id));
      toast(
        suggestion.kind === 'arte_aprovada'
          ? `${result.order.order_number} foi para Produção.`
          : `Pedido ${result.order.order_number} criado${result.attached_files ? ` com ${result.attached_files} arquivo(s)` : ''}.`,
        'success'
      );
      load({ silent: true });
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const dismissSuggestion = async (suggestion) => {
    try {
      await api.dismissSuggestion(suggestion.id);
      setSuggestions((prev) => prev.filter((x) => x.id !== suggestion.id));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const analyze = async (chat) => {
    setAnalyzing(chat.phone);
    try {
      const result = await api.analyzeChat(chat.phone);
      await load({ silent: true });
      if (result.suggestion) toast('Sugestão atualizada.', 'success');
      else if (result.error) toast(result.error, 'error');
      else toast('Nada novo para sugerir nessa conversa.', 'info');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setAnalyzing(null);
    }
  };

  const remove = async (file) => {
    if (!confirm(`Excluir "${file.name}"? Ele sai também do Google Drive.`)) return;
    try {
      await api.deleteInboxFile(file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  const unwatch = async (chat) => {
    if (!confirm(`Parar de acompanhar ${chat.chat_name || formatPhoneBR(chat.phone)}?`)) return;
    try {
      await api.unwatchChat(chat.phone);
      setChats((prev) => prev.filter((c) => c.phone !== chat.phone));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  if (!files) return <p className="p-6 text-sm font-medium text-slate-400">Carregando…</p>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      <div className="flex items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Recebidos do WhatsApp</h2>
          <p className="text-xs font-medium text-slate-400">
            Arquivos que os clientes mandaram nas conversas que você marcou para acompanhar.
          </p>
        </div>
        <button
          onClick={() => load()}
          title="Atualizar"
          className="p-2.5 rounded-full bg-white border border-black/5 text-slate-400 hover:text-brand-700 shadow-sm transition-colors"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {suggestions.length > 0 && (
        <section className={card}>
          <div className="px-5 py-4 border-b border-black/5 flex items-center gap-2">
            <Sparkles size={15} className="text-brand-600" />
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm mr-auto">
              Sugestões da conversa
            </h3>
            <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700">
              {suggestions.length}
            </span>
          </div>
          <p className="px-5 pt-3 text-[11px] font-medium text-slate-400">
            Lido da conversa pela IA. Confira antes de confirmar — nada entra no quadro sozinho.
          </p>
          <div className="divide-y divide-black/5">
            {suggestions.map((sg) =>
              sg.kind === 'arte_aprovada' ? (
                <ApprovalSuggestion
                  key={sg.id}
                  suggestion={sg}
                  onAccept={acceptSuggestion}
                  onDismiss={dismissSuggestion}
                />
              ) : (
                <NewOrderSuggestion
                  key={sg.id}
                  suggestion={sg}
                  onAccept={acceptSuggestion}
                  onDismiss={dismissSuggestion}
                />
              )
            )}
          </div>
        </section>
      )}

      <section className={card}>
        <div className="px-5 py-4 border-b border-black/5 flex items-center gap-2">
          <InboxIcon size={15} className="text-brand-600" />
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm mr-auto">Sem pedido ainda</h3>
          <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700">
            {files.length}
          </span>
        </div>
        {files.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-bold text-slate-400 mb-1">Nada esperando aqui.</p>
            <p className="text-xs font-medium text-slate-400">
              Quando o cliente tinha um pedido aberto, o arquivo já foi direto para a pasta dele no Drive.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-black/5">
            {files.map((f) => (
              <FileRow key={f.id} file={f} orders={orders} onAttach={attach} onDelete={remove} />
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <div className="px-5 py-4 border-b border-black/5 flex items-center gap-2">
          <Eye size={15} className="text-brand-600" />
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm mr-auto">Conversas acompanhadas</h3>
          <span className="text-[11px] font-bold text-slate-400">{chats.length}</span>
        </div>
        {chats.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-bold text-slate-400 mb-1">Nenhuma conversa sendo acompanhada.</p>
            <p className="text-xs font-medium text-slate-400">
              No WhatsApp Web, abra a conversa e clique no ícone de olho da extensão para começar.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-black/5">
            {chats.map((c) => (
              <div key={c.phone} className="px-5 py-3 flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-brand-950 truncate">
                    {c.chat_name || formatPhoneBR(c.phone)}
                  </span>
                  <span className="block text-[11px] font-medium text-slate-400">
                    {c.messages_count} {c.messages_count === 1 ? 'mensagem' : 'mensagens'}
                    {c.last_message_at ? ` · última ${formatWhen(c.last_message_at)}` : ''}
                  </span>
                </span>
                <button
                  onClick={() => analyze(c)}
                  disabled={analyzing === c.phone}
                  title="Analisar a conversa agora"
                  className="p-2 rounded-full text-brand-600 hover:bg-brand-100 transition-colors shrink-0 disabled:opacity-40"
                >
                  {analyzing === c.phone ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                </button>
                <button
                  onClick={() => openWhatsApp(c.phone)}
                  title="Abrir no WhatsApp"
                  className="p-2 rounded-full text-brand-600 hover:bg-brand-100 transition-colors shrink-0"
                >
                  <MessageCircle size={16} />
                </button>
                <button
                  onClick={() => unwatch(c)}
                  title="Parar de acompanhar"
                  className="p-2 rounded-lg text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors shrink-0"
                >
                  <EyeOff size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
