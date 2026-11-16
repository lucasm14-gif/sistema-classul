import React, { useEffect, useRef, useState } from 'react';
import { MessagesSquare, Send, Eraser, LoaderCircle, EyeOff, UserRound, Hand } from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';

// Conversa de teste com o bot. Nada daqui vai para o WhatsApp nem para o banco:
// a memória do bot neste chat é esta lista, guardada só no navegador.
const STORAGE_KEY = 'classul_bot_teste';

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { items: Array.isArray(saved.items) ? saved.items : [], roteiro: saved.roteiro === 'padrao' ? 'padrao' : 'salvo' };
  } catch {
    return { items: [], roteiro: 'salvo' };
  }
}

const hora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const EXEMPLOS = [
  'Bom dia',
  'Olá! Gostaria de solicitar um orçamento para placas de homenagem personalizadas.',
  'Qual o endereço para retirar?',
  'Vocês fazem troféu?',
  'Oi pai, vai almoçar em casa hoje?'
];

export default function BotTest({ onAuthError }) {
  const [{ items, roteiro }, setState] = useState(loadSaved);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const endRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, roteiro }));
    } catch {
      /* sem armazenamento: o chat só não sobrevive ao recarregar */
    }
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items, roteiro]);

  // O bot para quando passa a conversa adiante ou quando um humano responde.
  const parado = items.findLast((i) => i.kind === 'parou');
  const add = (...novos) => setState((s) => ({ ...s, items: [...s.items, ...novos] }));

  const enviar = async (raw) => {
    const content = String(raw ?? text).trim();
    if (!content || sending) return;
    setText('');
    const cliente = { kind: 'cliente', content, at: Date.now() };
    add(cliente);
    if (parado) {
      add({ kind: 'aviso', content: 'O bot não leu esta mensagem: ele já parou nesta conversa.', at: Date.now() });
      return;
    }
    setSending(true);
    try {
      // O que o bot "lembra": as mensagens do cliente e as respostas que ele mesmo deu.
      const messages = [...items, cliente]
        .filter((i) => i.kind === 'cliente' || i.kind === 'bot')
        .map((i) => ({ role: i.kind === 'cliente' ? 'user' : 'assistant', content: i.content }));
      const r = await api.botTestChat(messages, roteiro);
      const novos = [];
      if (r.silencio) {
        novos.push({ kind: 'aviso', icon: 'silencio', content: 'O bot leu e decidiu não responder.', at: Date.now() });
      } else {
        novos.push({ kind: 'bot', content: r.texto, fotos: r.fotos || [], at: Date.now() });
      }
      if (r.done) {
        novos.push({ kind: 'parou', content: 'O bot passou a conversa para o atendente e não responde mais.', at: Date.now() });
      }
      add(...novos);
    } catch (err) {
      if (!onAuthError?.(err)) toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const responderComoHumano = () => {
    const content = text.trim();
    if (!content) {
      toast('Escreva a resposta do atendente no campo e clique de novo.', 'info');
      return;
    }
    setText('');
    add(
      { kind: 'humano', content, at: Date.now() },
      ...(parado ? [] : [{ kind: 'parou', content: 'Um humano respondeu: o bot parou nesta conversa.', at: Date.now() }])
    );
  };

  const limpar = () => setState((s) => ({ ...s, items: [] }));

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto h-full flex flex-col animate-fade-up">
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="mr-auto">
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950 flex items-center gap-2">
            <MessagesSquare size={20} className="text-brand-600" /> Testar bot
          </h2>
          <p className="text-xs font-medium text-slate-400">
            Converse como se fosse um cliente. Nada é enviado ao WhatsApp nem guardado no sistema.
          </p>
        </div>
        <select
          value={roteiro}
          onChange={(e) => setState((s) => ({ ...s, roteiro: e.target.value }))}
          title="Qual roteiro o bot usa neste teste"
          className="text-xs font-bold text-brand-950 bg-white border border-black/10 rounded-full px-3 py-2"
        >
          <option value="salvo">Roteiro salvo em Configurações</option>
          <option value="padrao">Roteiro padrão (novo)</option>
        </select>
        <button
          onClick={limpar}
          disabled={!items.length}
          className="flex items-center gap-1.5 text-xs font-extrabold px-4 py-2 rounded-full bg-white border border-black/10 text-brand-950 hover:bg-black/5 disabled:opacity-40 transition-colors"
        >
          <Eraser size={14} /> Limpar memória
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-white rounded-3xl border border-black/5 shadow-sm flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 bg-[#F7F8F3] space-y-2">
          {items.length === 0 && (
            <div className="p-4">
              <p className="text-sm font-semibold text-slate-500 mb-3">
                Memória vazia. Mande uma mensagem ou comece por um exemplo:
              </p>
              <div className="flex flex-wrap gap-2">
                {EXEMPLOS.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => enviar(ex)}
                    className="text-xs font-semibold text-left px-3 py-2 rounded-2xl bg-white border border-black/10 text-brand-950 hover:border-brand-500 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((m, i) =>
            m.kind === 'aviso' || m.kind === 'parou' ? (
              <div key={i} className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 bg-black/5 rounded-full px-3 py-1.5">
                  {m.kind === 'parou' ? <Hand size={12} /> : <EyeOff size={12} />} {m.content}
                </span>
              </div>
            ) : (
              <div key={i} className={`flex ${m.kind === 'cliente' ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line ${
                    m.kind === 'cliente'
                      ? 'bg-white border border-black/5 text-brand-950 rounded-tl-sm'
                      : m.kind === 'humano'
                        ? 'bg-slate-700 text-white rounded-tr-sm'
                        : 'bg-brand-600 text-white rounded-tr-sm'
                  }`}
                >
                  {m.content}
                  {m.fotos?.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {m.fotos.map((f) => (
                        <a key={f.url} href={f.url} target="_blank" rel="noreferrer" title={f.label}>
                          <img src={f.url} alt={f.label} className="rounded-lg w-full h-24 object-cover bg-white/20" />
                        </a>
                      ))}
                    </div>
                  )}
                  <span
                    className={`block text-[9px] mt-1 font-semibold ${
                      m.kind === 'cliente' ? 'text-slate-400' : 'text-white/60'
                    }`}
                  >
                    {m.kind === 'cliente' ? 'Cliente' : m.kind === 'humano' ? 'Atendente' : 'Bot'} · {hora(m.at)}
                  </span>
                </div>
              </div>
            )
          )}

          {sending && (
            <div className="flex justify-end">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 px-3 py-2">
                <LoaderCircle size={13} className="animate-spin" /> bot lendo…
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
          className="p-3 border-t border-black/5 flex items-center gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={parado ? 'O bot parou. Limpe a memória para recomeçar.' : 'Escreva como se fosse o cliente…'}
            className="flex-1 min-w-0 text-sm font-medium bg-[#F7F8F3] rounded-full px-4 py-2.5 outline-none focus:ring-2 focus:ring-brand-500/40 text-brand-950"
          />
          <button
            type="button"
            onClick={responderComoHumano}
            title="Simula um atendente respondendo no WhatsApp: o bot para"
            className="flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2.5 rounded-full bg-white border border-black/10 text-brand-950 hover:bg-black/5 transition-colors shrink-0"
          >
            <UserRound size={14} /> <span className="hidden sm:inline">Como atendente</span>
          </button>
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="flex items-center gap-1.5 text-sm font-extrabold px-4 py-2.5 rounded-full bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 transition-colors shrink-0"
          >
            <Send size={15} /> Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
