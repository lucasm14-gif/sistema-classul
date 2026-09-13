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
  MessageCircle
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
  const toast = useToast();

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        const [f, c, o] = await Promise.all([api.listInboxFiles(), api.listWatchedChats(), api.listOrders()]);
        setFiles(f);
        setChats(c);
        setOrders(o);
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
                    {c.messages_count} mensagem{c.messages_count !== 1 ? 's' : ''}
                    {c.last_message_at ? ` · última ${formatWhen(c.last_message_at)}` : ''}
                  </span>
                </span>
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
