import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ExternalLink,
  FileText,
  Film,
  History,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Mic,
  Play,
  RotateCcw,
  Search,
  Sticker,
  X
} from 'lucide-react';
import { api } from '../api';
import { usePolling } from '../usePolling';
import { useToast } from './Toast';
import { openWhatsApp } from '../whatsapp';

function formatPhoneBR(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone || '';
}

const dayKey = (value) => new Date(value).toLocaleDateString('pt-BR');
const timeOf = (value) => new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function dayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (dayKey(d) === dayKey(today)) return 'Hoje';
  if (dayKey(d) === dayKey(yesterday)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

// Na lista: hora se for de hoje, senão a data.
function listStamp(value) {
  if (!value) return '';
  return dayKey(value) === dayKey(new Date()) ? timeOf(value) : new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const MEDIA_LABEL = { imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', figurinha: 'Figurinha' };
const MEDIA_ICON = { imagem: ImageIcon, video: Film, audio: Mic, documento: FileText, figurinha: Sticker };

function preview(body, mediaType) {
  if (body) return body;
  return mediaType ? MEDIA_LABEL[mediaType] || 'Arquivo' : '';
}

// Arquivos já baixados nesta sessão: voltar a uma conversa não baixa a foto de novo.
const blobCache = new Map();
async function mediaUrl(id) {
  if (!blobCache.has(id)) blobCache.set(id, URL.createObjectURL(await api.conversationMedia(id)));
  return blobCache.get(id);
}

const INLINE_LIMIT = 4 * 1024 * 1024;

function Media({ msg, mine, onRetried, onAuthError }) {
  const [url, setUrl] = useState(() => blobCache.get(msg.id) || null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const toast = useToast();
  const Icon = MEDIA_ICON[msg.media_type] || FileText;
  const label = MEDIA_LABEL[msg.media_type] || 'Arquivo';
  const soft = mine ? 'bg-white/15 text-white' : 'bg-black/[0.04] text-brand-950';
  const saved = msg.media_status === 'salva';
  const inline = saved && (!msg.size || msg.size <= INLINE_LIMIT);

  // Foto aparece sozinha; áudio só baixa quando alguém manda tocar.
  useEffect(() => {
    if (msg.media_type !== 'imagem' || !inline || url) return undefined;
    let alive = true;
    mediaUrl(msg.id)
      .then((u) => alive && setUrl(u))
      .catch((err) => {
        if (!onAuthError(err) && alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [msg.id, msg.media_type, inline, url, onAuthError]);

  const load = async () => {
    setBusy(true);
    try {
      setUrl(await mediaUrl(msg.id));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      const { message } = await api.retryConversationMedia(msg.id);
      onRetried(message);
      toast(message.media_status === 'salva' ? 'Arquivo guardado no Drive.' : 'O WhatsApp não tem mais este arquivo.', message.media_status === 'salva' ? 'success' : 'error');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (msg.media_type === 'figurinha') {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-2.5 py-1.5 ${soft}`}>
        <Sticker size={14} /> Figurinha
      </span>
    );
  }

  if (!saved) {
    return (
      <div className={`flex items-center gap-2 text-xs font-semibold rounded-xl px-2.5 py-2 ${soft}`}>
        <Icon size={15} className="shrink-0" />
        <span className="flex-1 min-w-0">
          {msg.media_status === 'expirada'
            ? `${label} antigo — o WhatsApp não guarda mais`
            : `${label} ${msg.media_status === 'pendente' ? 'ainda não guardado' : 'não foi guardado'}`}
        </span>
        <button onClick={retry} disabled={busy} className="flex items-center gap-1 underline underline-offset-2 disabled:opacity-60">
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />} Tentar de novo
        </button>
      </div>
    );
  }

  if (msg.media_type === 'imagem' && inline && !failed) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" title="Abrir a foto">
        <img src={url} alt={msg.file_name || 'Foto'} className="rounded-xl max-h-72 max-w-full object-contain" />
      </a>
    ) : (
      <div className={`w-56 h-40 rounded-xl flex items-center justify-center ${soft}`}>
        <LoaderCircle size={18} className="animate-spin opacity-60" />
      </div>
    );
  }

  if (msg.media_type === 'audio' && inline) {
    return url ? (
      <audio src={url} controls autoPlay className="max-w-full w-64 h-10" />
    ) : (
      <button onClick={load} disabled={busy} className={`flex items-center gap-2 text-xs font-bold rounded-xl px-3 py-2 ${soft}`}>
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={15} />} Ouvir áudio
        {msg.size ? <span className="font-medium opacity-70">{formatSize(msg.size)}</span> : null}
      </button>
    );
  }

  // Documento, vídeo e o que for grande demais: abre no Drive.
  return (
    <a
      href={msg.web_view_link || '#'}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${soft}`}
      title="Abrir no Google Drive"
    >
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold truncate">{msg.file_name || label}</span>
        <span className="block text-[10px] font-medium opacity-70">
          {[label, formatSize(msg.size)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <ExternalLink size={14} className="shrink-0 opacity-70" />
    </a>
  );
}

function Chat({ phone, focusId, onBack, onAuthError }) {
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef(null);
  // O que fazer com a rolagem depois de desenhar: ir ao fim, manter o ponto, ou ir a uma mensagem.
  const pending = useRef(null);
  const state = useRef({ messages: [], hasNewer: false, busy: false });
  state.current.messages = messages;
  state.current.hasNewer = hasNewer;
  const toast = useToast();

  const open = useCallback(
    async (around) => {
      setLoading(true);
      try {
        const data = await api.conversationMessages(phone, around ? { around } : {});
        setChat(data.chat);
        setMessages(data.messages);
        setHasOlder(data.has_older);
        setHasNewer(data.has_newer);
        pending.current = around ? { focus: around } : { bottom: true };
      } catch (err) {
        if (!onAuthError(err)) toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [phone, onAuthError, toast]
  );

  useEffect(() => {
    setMessages([]);
    setChat(null);
    open(focusId);
  }, [open, focusId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const p = pending.current;
    if (!el || !p) return;
    pending.current = null;
    if (p.bottom) el.scrollTop = el.scrollHeight;
    else if (p.keep != null) el.scrollTop = el.scrollHeight - p.keep;
    else if (p.focus) el.querySelector(`[data-mid="${p.focus}"]`)?.scrollIntoView({ block: 'center' });
  }, [messages]);

  const loadOlder = useCallback(async () => {
    const s = state.current;
    if (s.busy || !s.messages.length) return;
    s.busy = true;
    setLoadingMore(true);
    try {
      const data = await api.conversationMessages(phone, { before: s.messages[0].id });
      const el = scroller.current;
      pending.current = { keep: el ? el.scrollHeight - el.scrollTop : 0 };
      setMessages((cur) => [...data.messages, ...cur]);
      setHasOlder(data.has_older);
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      s.busy = false;
      setLoadingMore(false);
    }
  }, [phone, onAuthError, toast]);

  // Mensagens depois da última que está na tela: serve para a rolagem para baixo
  // (quando se abriu um resultado antigo) e para as que chegam enquanto a conversa está aberta.
  const loadNewer = useCallback(
    async ({ silent } = {}) => {
      const s = state.current;
      if (s.busy || !s.messages.length) return;
      s.busy = true;
      try {
        const data = await api.conversationMessages(phone, { after: s.messages[s.messages.length - 1].id });
        if (data.messages.length) {
          const el = scroller.current;
          const near = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 120 : true;
          if (near && !data.has_newer && !s.hasNewer) pending.current = { bottom: true };
          const known = new Set(s.messages.map((m) => m.id));
          setMessages((cur) => [...cur, ...data.messages.filter((m) => !known.has(m.id))]);
        }
        setHasNewer(data.has_newer);
      } catch (err) {
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      } finally {
        s.busy = false;
      }
    },
    [phone, onAuthError, toast]
  );

  // Conversa aberta e no fim: confere mensagens novas a cada 10 s.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden && !state.current.hasNewer) loadNewer({ silent: true });
    }, 10000);
    return () => clearInterval(id);
  }, [loadNewer]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(fromBottom < 120);
    if (el.scrollTop < 160 && hasOlder) loadOlder();
    if (fromBottom < 160 && hasNewer) loadNewer();
  };

  const goLatest = () => {
    if (hasNewer) open();
    else scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  };

  const replaceMessage = (m) => setMessages((cur) => cur.map((x) => (x.id === m.id ? m : x)));
  const title = chat?.name || formatPhoneBR(phone);

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="shrink-0 px-4 py-3 flex items-center gap-3 border-b border-black/5 bg-white">
        <button onClick={onBack} aria-label="Voltar para a lista" className="md:hidden p-2 -ml-2 rounded-full text-slate-400 hover:bg-black/5">
          <ArrowLeft size={18} />
        </button>
        <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
          {title.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold tracking-tight text-brand-950 leading-tight truncate">{title}</p>
          <p className="text-xs font-semibold text-slate-400 leading-tight">
            {formatPhoneBR(phone)}
            {chat?.client_id ? ' · cliente cadastrado' : ''}
          </p>
        </div>
        <button
          onClick={() => openWhatsApp(phone)}
          title="Abrir no WhatsApp"
          className="flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:bg-brand-50 px-3 py-2 rounded-full transition-colors shrink-0"
        >
          <MessageCircle size={15} /> <span className="hidden sm:inline">Abrir no WhatsApp</span>
        </button>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-3 sm:px-6 py-4 bg-[#F7F8F3]">
          {loading ? (
            <p className="text-sm font-medium text-slate-400 text-center py-10">Carregando…</p>
          ) : (
            <>
              <p className="text-center text-[11px] font-semibold text-slate-400 py-2">
                {hasOlder ? (loadingMore ? 'Carregando mensagens anteriores…' : 'Role para cima para ver mais') : 'Início do que está guardado desta conversa'}
              </p>
              {messages.map((m, i) => {
                const newDay = i === 0 || dayKey(messages[i - 1].sent_at) !== dayKey(m.sent_at);
                const mine = m.from_me;
                return (
                  <React.Fragment key={m.id}>
                    {newDay && (
                      <div className="flex justify-center my-3">
                        <span className="text-[10px] font-bold text-slate-500 bg-white border border-black/5 rounded-full px-3 py-1 first-letter:uppercase">
                          {dayLabel(m.sent_at)}
                        </span>
                      </div>
                    )}
                    <div data-mid={m.id} className={`flex mb-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[82%] sm:max-w-[68%] rounded-2xl px-3 py-2 text-sm break-words ${
                          mine ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-white border border-black/5 text-brand-950 rounded-tl-sm'
                        } ${m.id === focusId ? 'ring-2 ring-sun-400 ring-offset-2 ring-offset-[#F7F8F3]' : ''}`}
                      >
                        {m.media_type && (
                          <div className={m.body ? 'mb-1.5' : ''}>
                            <Media msg={m} mine={mine} onRetried={replaceMessage} onAuthError={onAuthError} />
                          </div>
                        )}
                        {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                        <span className={`block text-right text-[9px] mt-0.5 font-semibold ${mine ? 'text-white/60' : 'text-slate-400'}`}>
                          {timeOf(m.sent_at)}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              {messages.length === 0 && <p className="text-sm font-medium text-slate-400 text-center py-10">Sem mensagens guardadas.</p>}
            </>
          )}
        </div>
        {!loading && (hasNewer || !atBottom) && (
          <button
            onClick={goLatest}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 text-xs font-extrabold bg-white text-brand-700 border border-black/5 shadow-lg rounded-full px-3.5 py-2 hover:-translate-y-0.5 transition-transform"
          >
            <ArrowDown size={14} /> Mais recentes
          </button>
        )}
      </div>
    </div>
  );
}

const num = (n) => Number(n || 0).toLocaleString('pt-BR');

// A Evolution conta também grupos e reações, que não entram aqui; por isso não dá
// para saber pelo número se "já importou tudo". Este navegador lembra que terminou.
const IMPORT_DONE_KEY = 'classul_conversas_importado';
function importedBefore() {
  try {
    return localStorage.getItem(IMPORT_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

// Rodapé da lista: liga a captura das mensagens novas e traz o histórico antigo
// que a Evolution já tem guardado. A importação roda aqui na tela, página por página;
// se a aba for fechada no meio, é só clicar de novo (o que já entrou não repete).
function HistoryPanel({ onAuthError, onChanged }) {
  const [status, setStatus] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [job, setJob] = useState(null); // { phase: 'textos' | 'arquivos', text }
  const stop = useRef(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.conversationsStatus());
    } catch (err) {
      onAuthError(err);
    }
  }, [onAuthError]);

  useEffect(() => {
    refresh();
    return () => {
      stop.current = true;
    };
  }, [refresh]);

  const connect = async () => {
    setConnecting(true);
    try {
      await api.botSetupWebhook();
      toast('Captura ligada: as mensagens novas já ficam guardadas.', 'success');
      await refresh();
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setConnecting(false);
    }
  };

  const saveFiles = async () => {
    let saved = 0;
    for (;;) {
      if (stop.current) return saved;
      const r = await api.importConversationMedia();
      saved += r.saved;
      setJob({ phase: 'arquivos', text: `Guardando arquivos no Drive… faltam ${num(r.remaining)}` });
      if (!r.processed || !r.remaining) return saved;
    }
  };

  const run = async (onlyFiles) => {
    stop.current = false;
    try {
      let added = 0;
      if (!onlyFiles) {
        setJob({ phase: 'textos', text: 'Lendo o histórico…' });
        for (let page = 1; ; page++) {
          if (stop.current) break;
          const r = await api.importConversations(page);
          added += r.stored;
          setJob({ phase: 'textos', text: `Importando mensagens… ${num(Math.min(page * 200, r.total))} de ${num(r.total)}` });
          if (page % 5 === 0) onChanged();
          if (r.done) break;
        }
        onChanged();
      }
      const files = stop.current ? 0 : await saveFiles();
      if (!stop.current) {
        try {
          localStorage.setItem(IMPORT_DONE_KEY, '1');
        } catch {
          // sem armazenamento local: o botão só continua com o nome antigo
        }
        toast(
          onlyFiles
            ? `${num(files)} arquivos guardados no Drive.`
            : `Histórico importado: ${num(added)} mensagens novas e ${num(files)} arquivos.`,
          'success'
        );
      }
    } catch (err) {
      if (!onAuthError(err)) toast(`A importação parou: ${err.message}. Clique de novo para continuar.`, 'error');
    } finally {
      setJob(null);
      onChanged();
      refresh();
    }
  };

  if (!status) return null;
  const { stored, capture, evolution } = status;
  const missing = evolution.total != null ? Math.max(0, evolution.total - stored.messages) : null;

  return (
    <div className="shrink-0 border-t border-black/5 px-4 py-3 space-y-2 bg-black/[0.015]">
      {!capture.on && (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[11px] font-semibold text-flame-600 leading-snug">
            {capture.error || 'A captura está desligada: as mensagens novas não estão sendo guardadas.'}
          </p>
          {!capture.error && (
            <button
              onClick={connect}
              disabled={connecting}
              className="shrink-0 flex items-center gap-1.5 text-[11px] font-extrabold bg-brand-600 text-white rounded-full px-3 py-1.5 disabled:opacity-60"
            >
              {connecting && <LoaderCircle size={12} className="animate-spin" />} Ligar captura
            </button>
          )}
        </div>
      )}
      {job ? (
        <div className="flex items-center gap-2">
          <LoaderCircle size={13} className="animate-spin text-brand-600 shrink-0" />
          <p className="flex-1 text-[11px] font-semibold text-slate-500 leading-snug">
            {job.text}
            <span className="block font-medium text-slate-400">Deixe esta aba aberta até terminar.</span>
          </p>
          <button onClick={() => (stop.current = true)} className="shrink-0 text-[11px] font-bold text-slate-400 hover:text-flame-600 underline underline-offset-2">
            Parar
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[11px] font-medium text-slate-400 leading-snug">
            {num(stored.messages)} mensagens guardadas
            {capture.on ? ' · captura ligada' : ''}
            {stored.pending_media ? ` · ${num(stored.pending_media)} arquivos a guardar` : ''}
          </p>
          {missing > 0 || (evolution.total != null && !stored.messages) ? (
            <button
              onClick={() => run(false)}
              className="shrink-0 flex items-center gap-1.5 text-[11px] font-extrabold text-brand-700 border border-brand-600/30 hover:bg-brand-50 rounded-full px-3 py-1.5"
            >
              <History size={12} /> {importedBefore() && stored.messages ? 'Reimportar' : 'Importar histórico'}
            </button>
          ) : stored.pending_media ? (
            <button
              onClick={() => run(true)}
              className="shrink-0 flex items-center gap-1.5 text-[11px] font-extrabold text-brand-700 border border-brand-600/30 hover:bg-brand-50 rounded-full px-3 py-1.5"
            >
              <History size={12} /> Guardar arquivos
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function Conversas({ onAuthError }) {
  const [data, setData] = useState({ chats: [], total: 0, messages: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState(null); // { phone, focusId }
  const toast = useToast();

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        setData(await api.conversations(term));
      } catch (err) {
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [term, onAuthError, toast]
  );
  usePolling(load, 15000);

  const row = (key, { phone, name, body, mediaType, fromMe, stamp, focusId }) => {
    const active = selected?.phone === phone && (selected?.focusId || null) === (focusId || null);
    const title = name || formatPhoneBR(phone);
    return (
      <button
        key={key}
        onClick={() => setSelected({ phone, focusId: focusId || null })}
        className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-colors ${active ? 'bg-brand-50' : 'hover:bg-black/[0.03]'}`}
      >
        <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold shrink-0">
          {title.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="font-bold text-sm text-brand-950 truncate flex-1">{title}</p>
            <span className="text-[10px] font-semibold text-slate-400 shrink-0">{listStamp(stamp)}</span>
          </div>
          <p className="text-xs font-medium text-slate-400 truncate">
            {fromMe ? 'Você: ' : ''}
            {preview(body, mediaType) || 'Sem mensagens'}
          </p>
        </div>
      </button>
    );
  };

  return (
    <div className="h-full p-2 sm:p-4 animate-fade-up">
      <div className="h-full bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden flex">
        <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] shrink-0 flex-col md:border-r border-black/5 min-h-0`}>
          <div className="shrink-0 px-4 pt-4 pb-3">
            <h2 className="text-lg font-extrabold tracking-tight text-brand-950 flex items-center gap-2">
              <MessagesSquare size={19} className="text-brand-600" /> Conversas
            </h2>
            <p className="text-[11px] font-medium text-slate-400 mb-3">
              {term
                ? 'Resultado da busca'
                : data.total
                  ? `${data.total} ${data.total === 1 ? 'conversa guardada' : 'conversas guardadas'}`
                  : 'Tudo o que passa pelo WhatsApp fica guardado aqui.'}
            </p>
            <label className="flex items-center gap-2 bg-black/[0.04] rounded-full px-3.5 py-2">
              <Search size={15} className="text-slate-400 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nome, telefone ou mensagem"
                aria-label="Buscar nas conversas"
                className="flex-1 min-w-0 bg-transparent text-sm font-medium text-brand-950 placeholder:text-slate-400 outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Limpar busca" className="text-slate-400 hover:text-brand-950">
                  <X size={15} />
                </button>
              )}
            </label>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-black/5">
            {loading ? (
              <p className="text-sm font-medium text-slate-400 p-4">Carregando…</p>
            ) : data.chats.length === 0 && data.messages.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm font-bold text-slate-400 mb-1">{term ? 'Nada encontrado.' : 'Nenhuma conversa guardada ainda.'}</p>
                {!term && (
                  <p className="text-xs font-medium text-slate-400">
                    As conversas aparecem aqui a partir da próxima mensagem recebida ou enviada no WhatsApp.
                  </p>
                )}
              </div>
            ) : (
              <>
                {data.chats.map((c) =>
                  row(c.phone, {
                    phone: c.phone,
                    name: c.name,
                    body: c.last_body,
                    mediaType: c.last_media_type,
                    fromMe: c.last_from_me,
                    stamp: c.last_message_at
                  })
                )}
                {data.messages.length > 0 && (
                  <p className="px-4 py-2 text-[10px] font-extrabold uppercase text-slate-400 bg-black/[0.02]">Mensagens com “{term}”</p>
                )}
                {data.messages.map((m) =>
                  row(`m${m.id}`, {
                    phone: m.phone,
                    name: m.chat_name,
                    body: m.body,
                    mediaType: m.media_type,
                    fromMe: m.from_me,
                    stamp: m.sent_at,
                    focusId: m.id
                  })
                )}
              </>
            )}
          </div>
          <HistoryPanel onAuthError={onAuthError} onChanged={() => load({ silent: true })} />
        </div>

        <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`}>
          {selected ? (
            <Chat
              key={`${selected.phone}:${selected.focusId || ''}`}
              phone={selected.phone}
              focusId={selected.focusId}
              onBack={() => setSelected(null)}
              onAuthError={onAuthError}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-[#F7F8F3]">
              <MessagesSquare size={34} className="text-slate-300 mb-3" strokeWidth={1.4} />
              <p className="text-sm font-bold text-slate-400">Escolha uma conversa</p>
              <p className="text-xs font-medium text-slate-400 mt-1">O histórico inteiro abre aqui, sem depender do celular.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
