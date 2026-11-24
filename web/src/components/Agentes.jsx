import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, FileText, LoaderCircle, PenLine, RefreshCw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { agentesApi, nfeApi, setNfeToken, NfeLockError } from '../api';
import { usePolling } from '../usePolling';
import { useToast } from './Toast';

const hora = (v) => {
  const d = new Date(v);
  if (isNaN(d)) return '';
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ESTADO = {
  pendente: { txt: 'Esperando você', cls: 'bg-amber-100 text-amber-800' },
  aprovado: { txt: 'Aprovado', cls: 'bg-brand-100 text-brand-800' },
  corrigir: { txt: 'Pediu correção', cls: 'bg-orange-100 text-orange-800' },
  respondido: { txt: 'Respondido', cls: 'bg-brand-100 text-brand-800' },
  recusado: { txt: 'Recusado', cls: 'bg-slate-200 text-slate-700' },
  emitindo: { txt: 'Emitindo…', cls: 'bg-sky-100 text-sky-800' },
  emitida: { txt: 'Nota emitida', cls: 'bg-brand-100 text-brand-800' },
  erro: { txt: 'Deu erro', cls: 'bg-red-100 text-red-800' }
};

function Avatar({ agente, size = 44 }) {
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-extrabold shrink-0"
      style={{ width: size, height: size, background: agente.cor || '#64748b', fontSize: size * 0.4 }}
    >
      {agente.nome.charAt(0).toUpperCase()}
    </div>
  );
}

// Imagem/arquivo de um anexo: busca com login e mostra (o <img> não manda o token sozinho).
function Anexo({ anexo, onAuthError }) {
  const [url, setUrl] = useState(null);
  const [erro, setErro] = useState(false);
  const toast = useToast();
  const ehNota = anexo.ref.startsWith('nfe:');
  const ehImagem = !ehNota && (/^image\//.test(anexo.tipo || '') || /\.(jpe?g|png|webp)$/i.test(anexo.nome || ''));

  useEffect(() => {
    if (!ehImagem) return undefined;
    let vivo = true;
    let criado = null;
    agentesApi
      .arquivo(anexo.ref)
      .then((b) => {
        criado = URL.createObjectURL(b);
        if (vivo) setUrl(criado);
      })
      .catch((err) => {
        if (!onAuthError(err) && vivo) setErro(true);
      });
    return () => {
      vivo = false;
      if (criado) URL.revokeObjectURL(criado);
    };
  }, [anexo.ref, ehImagem, onAuthError]);

  const abrir = async () => {
    try {
      const blob = ehNota ? await agentesApi.danfe(anexo.ref.split(':')[1]) : await agentesApi.arquivo(anexo.ref);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      if (err instanceof NfeLockError) toast('Desbloqueie a aba Notas fiscais para abrir a nota.', 'error');
      else if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  if (ehImagem) {
    return (
      <button onClick={abrir} className="block rounded-xl overflow-hidden bg-black/5 mt-2 max-w-[280px]" title="Abrir em tamanho real">
        {url ? (
          <img src={url} alt={anexo.nome || 'imagem'} className="block w-full h-auto" />
        ) : (
          <div className="w-[240px] h-[160px] flex items-center justify-center text-xs text-slate-400">
            {erro ? 'Não abriu' : <LoaderCircle size={18} className="animate-spin" />}
          </div>
        )}
      </button>
    );
  }
  return (
    <button
      onClick={abrir}
      className="mt-2 flex items-center gap-2 rounded-xl bg-black/[0.04] hover:bg-black/[0.08] px-3 py-2 text-left max-w-[280px]"
    >
      <FileText size={18} className="text-slate-500 shrink-0" />
      <span className="text-xs font-bold text-slate-700 truncate">{anexo.nome || anexo.ref}</span>
    </button>
  );
}

function PinModal({ onClose, onOk }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const enviar = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErro('');
    try {
      const r = await nfeApi.unlock(pin);
      setNfeToken(r.token);
      onOk();
    } catch (err) {
      setErro(err.message || 'PIN errado');
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0 bg-brand-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl shadow-xl p-6 w-full max-w-xs">
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-brand-600" /> PIN das Notas
        </h3>
        <p className="text-xs text-slate-500 mb-4">Emitir nota exige o mesmo PIN da aba Notas fiscais.</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="w-full rounded-xl border border-black/10 px-4 py-2.5 text-center text-lg tracking-[0.4em] font-bold"
        />
        {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
        <button disabled={busy || !pin} className="mt-4 w-full rounded-full bg-brand-600 text-white font-extrabold py-2.5 disabled:opacity-50">
          {busy ? 'Conferindo…' : 'Desbloquear e emitir'}
        </button>
      </form>
    </div>,
    document.body
  );
}

// Botões de uma mensagem que espera o Lucas.
function Acoes({ m, onFeito, onAuthError }) {
  const [modo, setModo] = useState(null); // 'corrigir' | 'responder'
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [pedirPin, setPedirPin] = useState(false);
  const toast = useToast();

  const rodar = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, 'success');
      setModo(null);
      setTexto('');
      onFeito();
    } catch (err) {
      if (err instanceof NfeLockError) setPedirPin(true);
      else if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const emitir = () => rodar(() => agentesApi.aprovarNf(m.id), 'Nota enviada para a SEFAZ.');

  if (m.estado !== 'pendente') return null;
  const ehNf = m.tipo === 'nf';
  const ehPergunta = m.tipo === 'pergunta';

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      {modo ? (
        <div>
          <textarea
            autoFocus
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={modo === 'responder' ? 'Sua resposta (o atendente passa ao cliente)' : 'O que precisa mudar?'}
            className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm resize-none"
          />
          <div className="flex gap-2 mt-2">
            <button
              disabled={busy || !texto.trim()}
              onClick={() =>
                rodar(
                  () => (modo === 'responder' ? agentesApi.decidir(m.id, 'respondido', texto) : agentesApi.decidir(m.id, 'corrigir', texto)),
                  modo === 'responder' ? 'Resposta enviada ao atendente.' : 'Correção enviada.'
                )
              }
              className="flex-1 rounded-full bg-brand-600 text-white text-xs font-extrabold py-2 disabled:opacity-50"
            >
              Enviar
            </button>
            <button onClick={() => setModo(null)} className="rounded-full px-4 text-xs font-bold text-slate-500 hover:bg-black/5">
              Cancelar
            </button>
          </div>
        </div>
      ) : ehPergunta ? (
        <button onClick={() => setModo('responder')} className="w-full rounded-full bg-brand-600 text-white text-xs font-extrabold py-2 flex items-center justify-center gap-1.5">
          <PenLine size={14} /> Responder
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={ehNf ? emitir : () => rodar(() => agentesApi.decidir(m.id, 'aprovado'), 'Aprovado.')}
            className="flex-1 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-xs font-extrabold py-2 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
            {ehNf ? 'Aprovar e emitir' : 'Aprovar'}
          </button>
          <button
            disabled={busy}
            onClick={() => setModo('corrigir')}
            className="flex-1 rounded-full bg-white border border-black/10 text-slate-700 text-xs font-extrabold py-2 flex items-center justify-center gap-1.5"
          >
            <PenLine size={14} /> Corrigir
          </button>
        </div>
      )}
      {pedirPin && (
        <PinModal
          onClose={() => setPedirPin(false)}
          onOk={() => {
            setPedirPin(false);
            emitir();
          }}
        />
      )}
    </div>
  );
}

function Mensagem({ m, onFeito, onAuthError }) {
  if (m.autor === 'sistema') {
    return (
      <div className="flex justify-center my-2">
        <div className="max-w-[85%] bg-sky-50 text-sky-900 text-xs font-medium rounded-2xl px-4 py-2 text-center">
          <p className="whitespace-pre-wrap">{m.texto}</p>
          {m.anexos.map((a) => (
            <div key={a.ref} className="flex justify-center">
              <Anexo anexo={a} onAuthError={onAuthError} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  const meu = m.autor === 'lucas';
  const est = m.estado && ESTADO[m.estado];
  return (
    <div className={`flex my-1.5 ${meu ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm ${
          meu ? 'bg-brand-600 text-white rounded-br-md' : 'bg-white text-slate-800 rounded-bl-md border border-black/5'
        }`}
      >
        {(m.codigo || est) && (
          <div className="flex items-center gap-2 mb-1">
            {m.codigo && <span className="text-[10px] font-extrabold tracking-wide text-slate-400">{m.codigo}</span>}
            {est && <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${est.cls}`}>{est.txt}</span>}
          </div>
        )}
        {m.texto && <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.texto}</p>}
        {m.anexos.map((a) => (
          <Anexo key={a.ref} anexo={a} onAuthError={onAuthError} />
        ))}
        {m.resposta && m.estado !== 'pendente' && (
          <p className="mt-2 text-xs bg-black/[0.04] rounded-xl px-3 py-2">
            <span className="font-extrabold">{m.respondido_por || 'Você'}:</span> {m.resposta}
          </p>
        )}
        <Acoes m={m} onFeito={onFeito} onAuthError={onAuthError} />
        <p className={`text-[10px] mt-1 text-right ${meu ? 'text-white/70' : 'text-slate-400'}`}>{hora(m.created_at)}</p>
      </div>
    </div>
  );
}

function Chat({ agente, onVoltar, onMudou, onAuthError }) {
  const [msgs, setMsgs] = useState(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fim = useRef(null);
  const ultimoId = useRef(0);
  const toast = useToast();

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        const r = await agentesApi.mensagens(agente.slug);
        setMsgs(r.mensagens);
        onMudou();
      } catch (err) {
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      }
    },
    [agente.slug, onAuthError, onMudou, toast]
  );
  usePolling(load, 15000);

  useEffect(() => {
    const ult = msgs?.at(-1)?.id || 0;
    if (ult !== ultimoId.current) {
      ultimoId.current = ult;
      fim.current?.scrollIntoView({ block: 'end' });
    }
  }, [msgs]);

  const enviar = async (e) => {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await agentesApi.escrever(agente.slug, texto);
      setTexto('');
      await load();
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-black/5">
        <button onClick={onVoltar} className="md:hidden p-1.5 -ml-1 rounded-full hover:bg-black/5" aria-label="Voltar">
          <ArrowLeft size={18} />
        </button>
        <Avatar agente={agente} size={38} />
        <div className="min-w-0">
          <p className="font-extrabold text-sm text-brand-950 truncate">{agente.nome}</p>
          <p className="text-[11px] text-slate-400 truncate">{agente.descricao}</p>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 bg-[#efeae2] dark:bg-black/20">
        {msgs === null ? (
          <p className="text-center text-xs text-slate-500 mt-10">Carregando…</p>
        ) : msgs.length === 0 ? (
          <p className="text-center text-xs text-slate-500 mt-10">Nada por aqui ainda. Quando o atendente precisar de você, aparece aqui.</p>
        ) : (
          msgs.map((m) => <Mensagem key={m.id} m={m} onFeito={load} onAuthError={onAuthError} />)
        )}
        <div ref={fim} />
      </div>
      <form onSubmit={enviar} className="flex items-end gap-2 px-3 py-3 bg-white border-t border-black/5">
        <textarea
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) enviar(e);
          }}
          placeholder={`Escrever para ${agente.nome}…`}
          className="flex-1 resize-none rounded-2xl border border-black/10 px-4 py-2.5 text-sm max-h-32"
        />
        <button
          disabled={enviando || !texto.trim()}
          className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center disabled:opacity-40 shrink-0"
          aria-label="Enviar"
        >
          {enviando ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}

export default function Agentes({ onAuthError }) {
  const [dados, setDados] = useState(null);
  const [aberto, setAberto] = useState(null);
  const [mudandoFase, setMudandoFase] = useState(false);
  const toast = useToast();

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        setDados(await agentesApi.listar());
      } catch (err) {
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      }
    },
    [onAuthError, toast]
  );
  usePolling(load, 15000);
  const recarregarLista = useCallback(() => load({ silent: true }), [load]);

  const agentes = dados?.agentes || [];
  const atual = agentes.find((a) => a.slug === aberto) || null;

  useEffect(() => {
    if (!aberto && agentes.length && window.matchMedia('(min-width: 768px)').matches) {
      setAberto((agentes.find((a) => a.esperando_lucas) || agentes[0]).slug);
    }
  }, [aberto, agentes]);

  const trocarFase = async () => {
    const novo = !dados.arte_automatica;
    if (novo && !window.confirm('A partir de agora a arte vai DIRETO ao cliente, sem passar por você. A nota fiscal continua passando. Liberar?')) return;
    setMudandoFase(true);
    try {
      await agentesApi.arteAutomatica(novo);
      await load();
      toast(novo ? 'Arte liberada: vai direto ao cliente.' : 'Arte volta a passar por você.', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setMudandoFase(false);
    }
  };

  return (
    <div className="h-full flex bg-white rounded-[1.5rem] border border-black/5 overflow-hidden animate-fade-up">
      <aside className={`${atual ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0 flex-col border-r border-black/5`}>
        <div className="px-4 pt-4 pb-3 border-b border-black/5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-extrabold tracking-tight text-brand-950 flex items-center gap-2 mr-auto">
              <Sparkles size={18} className="text-brand-600" /> Agentes
            </h2>
            <button onClick={() => load()} title="Atualizar" className="p-2 rounded-full text-slate-400 hover:text-brand-700 hover:bg-black/5">
              <RefreshCw size={15} />
            </button>
          </div>
          {dados && (
            <button
              onClick={trocarFase}
              disabled={mudandoFase}
              className="mt-2 w-full flex items-center gap-3 rounded-2xl bg-black/[0.03] hover:bg-black/[0.06] px-3 py-2 text-left"
            >
              <span className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${dados.arte_automatica ? 'bg-brand-600' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${dados.arte_automatica ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
              <span className="text-xs leading-tight">
                <span className="font-extrabold text-slate-700 block">Arte direto ao cliente</span>
                <span className="text-slate-400">{dados.arte_automatica ? 'Ligado: não passa por você' : 'Desligado: você aprova antes'}</span>
              </span>
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {!dados ? (
            <p className="text-xs text-slate-400 p-4">Carregando…</p>
          ) : (
            agentes.map((a) => (
              <button
                key={a.slug}
                onClick={() => setAberto(a.slug)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-black/[0.04] transition-colors ${
                  aberto === a.slug ? 'bg-brand-50' : 'hover:bg-black/[0.02]'
                }`}
              >
                <Avatar agente={a} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="font-bold text-sm text-brand-950 truncate mr-auto">{a.nome}</p>
                    {a.ultima && <span className="text-[10px] text-slate-400 shrink-0">{hora(a.ultima.em)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-400 truncate mr-auto">
                      {a.ultima ? `${a.ultima.autor === 'lucas' ? 'Você: ' : ''}${a.ultima.texto}` : a.descricao}
                    </p>
                    {a.esperando_lucas > 0 ? (
                      <span className="text-[10px] font-extrabold bg-amber-500 text-white rounded-full px-1.5 min-w-[20px] h-5 flex items-center justify-center shrink-0" title="Esperando você">
                        {a.esperando_lucas}
                      </span>
                    ) : a.nao_lidas > 0 ? (
                      <span className="text-[10px] font-extrabold bg-brand-600 text-white rounded-full px-1.5 min-w-[20px] h-5 flex items-center justify-center shrink-0">
                        {a.nao_lidas}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>
      <section className={`${atual ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`}>
        {atual ? (
          <Chat key={atual.slug} agente={atual} onVoltar={() => setAberto(null)} onMudou={recarregarLista} onAuthError={onAuthError} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-6 text-center">
            Escolha um agente.
          </div>
        )}
      </section>
    </div>
  );
}
