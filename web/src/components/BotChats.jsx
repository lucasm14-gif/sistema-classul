import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, RefreshCw, RotateCcw, X, User, CheckCircle2, MessageCircle, Clock, Power, LoaderCircle } from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';

function formatPhoneBR(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone || '';
}

function formatDateTime(value) {
  const d = new Date(value);
  return isNaN(d) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const REASON_LABEL = {
  'bot concluiu': 'Bot entendeu o pedido',
  'humano assumiu': 'Você assumiu',
  'limite de mensagens': 'Limite de mensagens'
};

function ChatModal({ phone, onClose, onReactivate, onAuthError }) {
  const [convo, setConvo] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api
      .botConversation(phone)
      .then(setConvo)
      .catch((err) => onAuthError(err));
  }, [phone, onAuthError]);

  const reactivate = async () => {
    try {
      await api.botReactivate(phone);
      toast('Bot reativado para esta conversa.', 'success');
      onReactivate();
      onClose();
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-brand-950/60 backdrop-blur-sm z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-[1.75rem] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-fade-up"
      >
        <div className="px-6 py-4 flex items-center justify-between border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold">
              {(convo?.push_name || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="font-extrabold tracking-tight text-brand-950 leading-tight">
                {convo?.push_name || 'Cliente'}
              </h2>
              <p className="text-xs font-semibold text-slate-400 leading-tight">{formatPhoneBR(phone)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-brand-950 hover:bg-black/5 transition-colors"
          >
            <X size={19} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-[#F7F8F3] space-y-2">
          {!convo ? (
            <p className="text-sm font-medium text-slate-400 p-4">Carregando…</p>
          ) : convo.messages.length === 0 ? (
            <p className="text-sm font-medium text-slate-400 p-4">Sem mensagens.</p>
          ) : (
            convo.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line ${
                    m.role === 'user'
                      ? 'bg-white border border-black/5 text-brand-950 rounded-tl-sm'
                      : 'bg-brand-600 text-white rounded-tr-sm'
                  }`}
                >
                  {m.content}
                  <span
                    className={`block text-[9px] mt-1 font-semibold ${
                      m.role === 'user' ? 'text-slate-400' : 'text-white/60'
                    }`}
                  >
                    {m.role === 'user' ? 'Cliente' : 'Bot'} · {formatDateTime(m.created_at)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {convo?.status === 'handled' && (
          <div className="px-6 py-4 border-t border-black/5 bg-white flex items-center gap-3">
            <p className="text-xs font-semibold text-slate-500 flex-1">
              Encerrado ({REASON_LABEL[convo.handled_reason] || convo.handled_reason}). O bot não responde mais aqui.
            </p>
            <button
              onClick={reactivate}
              className="flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:text-brand-900 transition-colors"
            >
              <RotateCcw size={13} /> Reativar bot
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default function BotChats({ onAuthError }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [openPhone, setOpenPhone] = useState(null);
  const [toggling, setToggling] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [convos, st] = await Promise.all([api.botConversations(), api.botStatus()]);
      setConversations(convos);
      setStatus(st);
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleBot = async () => {
    const turningOn = !status?.enabled;
    setToggling(true);
    try {
      await api.saveSettings({ bot_enabled: turningOn ? '1' : '0' });
      setStatus(await api.botStatus());
      toast(turningOn ? 'Bot ATIVADO — vai responder no WhatsApp.' : 'Bot PAUSADO — não vai responder ninguém.', turningOn ? 'success' : 'info');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto h-full overflow-y-auto animate-fade-up">
      <div className="flex items-center gap-3 mb-4">
        <div className="mr-auto">
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950 flex items-center gap-2">
            <Bot size={20} className="text-brand-600" /> Atendimentos do bot
          </h2>
          <p className="text-xs font-medium text-slate-400">
            {status?.enabled ? (
              status.test_number ? (
                <>Ativo — respondendo só ao número de teste {formatPhoneBR(status.test_number)}.</>
              ) : (
                <>Ativo — respondendo a todos os clientes.</>
              )
            ) : (
              <>Desativado. Ative e conecte em Configurações → Bot de pré-atendimento.</>
            )}
          </p>
        </div>
        {status && (
          <button
            onClick={toggleBot}
            disabled={toggling}
            title={status.enabled ? 'Clique para pausar o bot' : 'Clique para ativar o bot'}
            className={`flex items-center gap-2 text-sm font-extrabold px-5 py-2.5 rounded-full shadow-lg transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0 ${
              status.enabled
                ? 'bg-brand-600 hover:bg-brand-700 text-white shadow-brand-600/25'
                : 'bg-slate-200 hover:bg-slate-300 text-slate-600 shadow-black/5'
            }`}
          >
            {toggling ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Power size={16} strokeWidth={2.5} />
            )}
            {status.enabled ? 'Bot ligado' : 'Bot desligado'}
          </button>
        )}
        <button
          onClick={load}
          title="Atualizar"
          className="p-2.5 rounded-full bg-white border border-black/5 text-slate-400 hover:text-brand-700 shadow-sm transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <p className="text-sm font-medium text-slate-400">Carregando…</p>
      ) : conversations.length === 0 ? (
        <div className="text-center py-20 bg-black/[0.02] border border-dashed border-black/10 rounded-3xl">
          <p className="text-sm font-bold text-slate-400 mb-1">Nenhum atendimento ainda.</p>
          <p className="text-xs font-medium text-slate-400">
            Quando um cliente mandar mensagem no WhatsApp, a conversa aparece aqui.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-black/5 divide-y divide-black/5 overflow-hidden">
          {conversations.map((c) => (
            <div
              key={c.phone}
              onClick={() => setOpenPhone(c.phone)}
              className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-brand-50/50 transition-colors group"
            >
              <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
                {(c.push_name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-brand-950 truncate">
                  {c.push_name || formatPhoneBR(c.phone)}
                </p>
                <p className="text-xs font-medium text-slate-400 truncate">
                  {c.last_role === 'assistant' ? 'Bot: ' : ''}
                  {c.last_message || 'Sem mensagens'}
                </p>
              </div>
              {c.status === 'handled' ? (
                <span className="flex items-center gap-1 text-[10px] font-extrabold text-slate-500 bg-black/[0.05] px-2.5 py-1 rounded-full shrink-0">
                  {c.handled_reason === 'humano assumiu' ? <User size={11} /> : <CheckCircle2 size={11} />}
                  {c.handled_reason === 'humano assumiu' ? 'Você assumiu' : 'Atendido'}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-extrabold text-brand-700 bg-brand-50 px-2.5 py-1 rounded-full shrink-0">
                  <Clock size={11} /> Em atendimento
                </span>
              )}
              <a
                href={`https://wa.me/${c.phone}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Abrir no WhatsApp"
                className="p-2 rounded-full text-brand-600 hover:bg-brand-100 transition-colors shrink-0"
              >
                <MessageCircle size={16} />
              </a>
            </div>
          ))}
        </div>
      )}

      {openPhone && (
        <ChatModal
          phone={openPhone}
          onClose={() => setOpenPhone(null)}
          onReactivate={load}
          onAuthError={onAuthError}
        />
      )}
    </div>
  );
}
