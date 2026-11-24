import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, FileText, FlaskConical, LoaderCircle, Paperclip, Plus, Send, Trash2, X } from 'lucide-react';
import { testesApi } from '../api';
import { usePolling } from '../usePolling';
import { useToast } from './Toast';

const hora = (v) => {
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const NOMES = ['Maria (escola)', 'João (empresa)', 'Ana (formatura)', 'Carlos (prefeitura)', 'Paula (igreja)', 'Rafael (clube)'];

function lerArquivo(file) {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => erro(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(file);
  });
}

function Arquivo({ arquivo, onAuthError }) {
  const [url, setUrl] = useState(arquivo.url || null);
  const imagem = /^image\//.test(arquivo.mime || '') || /\.(jpe?g|png|webp)$/i.test(arquivo.nome || arquivo.url || '');
  const id = arquivo.ref ? arquivo.ref.split(':')[1] : null;

  useEffect(() => {
    if (!id || !imagem) return undefined;
    let vivo = true;
    let criado = null;
    testesApi
      .arquivo(id)
      .then((b) => {
        criado = URL.createObjectURL(b);
        if (vivo) setUrl(criado);
      })
      .catch((err) => onAuthError(err));
    return () => {
      vivo = false;
      if (criado) URL.revokeObjectURL(criado);
    };
  }, [id, imagem, onAuthError]);

  const abrir = async () => {
    if (arquivo.url) return window.open(arquivo.url, '_blank', 'noopener');
    try {
      const b = await testesApi.arquivo(id);
      window.open(URL.createObjectURL(b), '_blank', 'noopener');
    } catch (err) {
      onAuthError(err);
    }
  };

  if (imagem) {
    return (
      <button onClick={abrir} className="block rounded-xl overflow-hidden bg-black/5 mb-1 max-w-[260px]">
        {url ? <img src={url} alt={arquivo.nome || 'foto'} className="block w-full h-auto" /> : <div className="w-[220px] h-[150px] flex items-center justify-center"><LoaderCircle size={16} className="animate-spin text-slate-400" /></div>}
      </button>
    );
  }
  return (
    <button onClick={abrir} className="flex items-center gap-2 rounded-xl bg-black/[0.05] px-3 py-2 mb-1 max-w-[260px]">
      <FileText size={18} className="shrink-0 opacity-70" />
      <span className="text-xs font-bold truncate">{arquivo.nome || 'arquivo'}</span>
    </button>
  );
}

function Conversa({ conversa, onVoltar, onApagar, onAuthError }) {
  const [msgs, setMsgs] = useState(null);
  const [texto, setTexto] = useState('');
  const [anexo, setAnexo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const fim = useRef(null);
  const inputArquivo = useRef(null);
  const ultimo = useRef(0);
  const toast = useToast();

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        const r = await testesApi.mensagens(conversa.telefone);
        setMsgs(r.mensagens);
      } catch (err) {
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      }
    },
    [conversa.telefone, onAuthError, toast]
  );
  usePolling(load, 3000);

  useEffect(() => {
    const id = msgs?.at(-1)?.id || 0;
    if (id !== ultimo.current) {
      ultimo.current = id;
      fim.current?.scrollIntoView({ block: 'end' });
    }
  }, [msgs]);

  const escolher = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return toast('Arquivo acima de 3 MB.', 'error');
    try {
      setAnexo({ nome: f.name, mime: f.type || 'application/octet-stream', base64: await lerArquivo(f) });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const enviar = async (e) => {
    e?.preventDefault();
    if (!texto.trim() && !anexo) return;
    setEnviando(true);
    try {
      const r = await testesApi.escrever(conversa.telefone, {
        texto,
        ...(anexo ? { imagem_base64: anexo.base64, arquivo_nome: anexo.nome, arquivo_mime: anexo.mime } : {})
      });
      setTexto('');
      setAnexo(null);
      setAviso(r.entregue_ao_hermes ? '' : `A mensagem ficou aqui, mas não chegou ao Hermes: ${r.erro}.`);
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
        <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-extrabold shrink-0">
          {conversa.nome.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 mr-auto">
          <p className="font-extrabold text-sm text-brand-950 truncate">{conversa.nome}</p>
          <p className="text-[11px] text-slate-400 truncate">Cliente de teste · {conversa.telefone}</p>
        </div>
        <button onClick={onApagar} title="Apagar esta conversa" className="flex items-center gap-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-full px-3 py-2">
          <Trash2 size={14} /> Apagar
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 bg-[#efeae2] dark:bg-black/20">
        <div className="mx-auto max-w-md text-center text-[11px] text-slate-600 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          Você é o cliente. Nada sai pelo WhatsApp: o que o atendente mandar aparece aqui, e o que ele precisar de você aparece em Agentes. Nota aprovada num teste não é emitida.
        </div>
        {msgs === null ? (
          <p className="text-center text-xs text-slate-500 mt-6">Carregando…</p>
        ) : msgs.length === 0 ? (
          <p className="text-center text-xs text-slate-500 mt-6">Mande a primeira mensagem como se fosse um cliente. Ex.: "Boa tarde, quero uma placa de homenagem".</p>
        ) : (
          msgs.map((m) => {
            const meu = m.de === 'cliente';
            return (
              <div key={m.id} className={`flex my-1.5 ${meu ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm ${meu ? 'bg-[#d9fdd3] text-slate-800 rounded-br-md' : 'bg-white text-slate-800 rounded-bl-md'}`}>
                  {m.arquivo && <Arquivo arquivo={m.arquivo} onAuthError={onAuthError} />}
                  {m.texto && <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.texto}</p>}
                  <p className="text-[10px] text-slate-400 text-right mt-0.5">{hora(m.created_at)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={fim} />
      </div>

      {aviso && (
        <div className="flex items-start gap-2 bg-red-50 text-red-800 text-xs px-4 py-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="mr-auto">{aviso}</span>
          <button onClick={() => setAviso('')} aria-label="Fechar"><X size={14} /></button>
        </div>
      )}
      {anexo && (
        <div className="flex items-center gap-2 bg-white border-t border-black/5 px-4 py-2 text-xs">
          <Paperclip size={14} className="text-slate-400" />
          <span className="font-bold truncate mr-auto">{anexo.nome}</span>
          <button onClick={() => setAnexo(null)} className="text-slate-400 hover:text-red-600" aria-label="Tirar anexo"><X size={14} /></button>
        </div>
      )}
      <form onSubmit={enviar} className="flex items-end gap-2 px-3 py-3 bg-white border-t border-black/5">
        <input ref={inputArquivo} type="file" accept="image/*,application/pdf,.cdr,.svg,.eps" className="hidden" onChange={escolher} />
        <button type="button" onClick={() => inputArquivo.current?.click()} className="w-10 h-10 rounded-full text-slate-500 hover:bg-black/5 flex items-center justify-center shrink-0" aria-label="Anexar logo ou arquivo" title="Anexar logo ou arquivo">
          <Paperclip size={18} />
        </button>
        <textarea
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) enviar(e);
          }}
          placeholder="Escreva como cliente…"
          className="flex-1 resize-none rounded-2xl border border-black/10 px-4 py-2.5 text-sm max-h-32"
        />
        <button disabled={enviando || (!texto.trim() && !anexo)} className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center disabled:opacity-40 shrink-0" aria-label="Enviar">
          {enviando ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}

export default function TestarAtendente({ onAuthError }) {
  const [lista, setLista] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [criando, setCriando] = useState(false);
  const toast = useToast();

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        setLista(await testesApi.listar());
      } catch (err) {
        if (!onAuthError(err) && !silent) toast(err.message, 'error');
      }
    },
    [onAuthError, toast]
  );
  usePolling(load, 10000);

  const atual = lista?.find((c) => c.telefone === aberta) || null;

  const novo = async () => {
    const sugestao = NOMES[(lista?.length || 0) % NOMES.length];
    const nome = window.prompt('Nome do cliente de teste:', sugestao);
    if (nome === null) return;
    setCriando(true);
    try {
      const c = await testesApi.criar(nome);
      await load();
      setAberta(c.telefone);
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setCriando(false);
    }
  };

  const apagar = async (c) => {
    if (!window.confirm(`Apagar a conversa de teste com ${c.nome}? Some daqui, do histórico do atendente e dos avisos em Agentes. Pedido criado no teste vai para Arquivados.`)) return;
    try {
      const r = await testesApi.apagar(c.telefone);
      if (aberta === c.telefone) setAberta(null);
      await load();
      toast(r.pedidos_arquivados ? `Conversa apagada. ${r.pedidos_arquivados} pedido(s) de teste arquivado(s).` : 'Conversa apagada.', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  };

  return (
    <div className="h-full flex bg-white rounded-[1.5rem] border border-black/5 overflow-hidden animate-fade-up">
      <aside className={`${atual ? 'hidden md:flex' : 'flex'} w-full md:w-80 shrink-0 flex-col border-r border-black/5`}>
        <div className="px-4 pt-4 pb-3 border-b border-black/5">
          <h2 className="text-lg font-extrabold tracking-tight text-brand-950 flex items-center gap-2">
            <FlaskConical size={18} className="text-brand-600" /> Testar atendente
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">Converse com o atendente novo fingindo ser clientes diferentes.</p>
          <button
            onClick={novo}
            disabled={criando}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-extrabold py-2.5 disabled:opacity-50"
          >
            {criando ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} strokeWidth={3} />} Novo cliente de teste
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!lista ? (
            <p className="text-xs text-slate-400 p-4">Carregando…</p>
          ) : lista.length === 0 ? (
            <p className="text-xs text-slate-400 p-4">Nenhuma conversa de teste. Crie uma para começar.</p>
          ) : (
            lista.map((c) => (
              <div
                key={c.telefone}
                onClick={() => setAberta(c.telefone)}
                className={`group flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-black/[0.04] ${aberta === c.telefone ? 'bg-brand-50' : 'hover:bg-black/[0.02]'}`}
              >
                <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-extrabold shrink-0">
                  {c.nome.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-brand-950 truncate">{c.nome}</p>
                  <p className="text-xs text-slate-400 truncate">{c.ultima ? `${c.ultima.de === 'cliente' ? 'Você: ' : ''}${c.ultima.texto || ''}` : 'Sem mensagens'}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    apagar(c);
                  }}
                  title="Apagar"
                  className="p-2 rounded-full text-slate-300 hover:text-red-600 hover:bg-red-50 shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
      <section className={`${atual ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`}>
        {atual ? (
          <Conversa key={atual.telefone} conversa={atual} onVoltar={() => setAberta(null)} onApagar={() => apagar(atual)} onAuthError={onAuthError} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-6 text-center">Crie ou escolha um cliente de teste.</div>
        )}
      </section>
    </div>
  );
}
