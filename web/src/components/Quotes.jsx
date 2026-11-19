import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, FileDown, Plus, Trash2, Package, Sparkles, ChevronDown, ChevronUp, LoaderCircle, RotateCcw, MessageSquareText, Users
} from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';
import { buscarProdutos, useNavegacao, Realce } from '../productSearch';

// Orçamento em PDF, o mesmo da extensão do WhatsApp, feito direto no sistema:
// itens escolhidos do catálogo de produtos da aba Notas (com o preço cadastrado),
// prazo em botões e, se quiser, o Hermes lê uma conversa colada e preenche tudo.

const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5';
const input =
  'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white';
const btn = 'inline-flex items-center justify-center gap-2 rounded-xl font-bold text-sm px-4 py-2.5 transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-brand-600 hover:bg-brand-700 text-white`;
const btnGhost = `${btn} bg-white border-2 border-slate-200 text-slate-600 hover:border-brand-500 hover:text-brand-700`;
const card = 'bg-white rounded-3xl border border-black/5 shadow-sm';
const chip = (on) =>
  `px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors ${
    on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-brand-500 hover:text-brand-700'
  }`;

const PRAZOS = ['3 dias úteis', '4 dias úteis', '5 dias úteis', '3 a 5 dias úteis', '10 a 15 dias úteis'];
const APOS = ', após confirmar pedido de compra';
const ENTREGAS = ['RETIRADA POR CONTA DO CLIENTE'];
const VALIDADES = ['15 DIAS', '30 DIAS'];
const DRAFT_KEY = 'classul_quote_draft';
const POLL_MS = 4000;
const POLL_MAX = 45; // ~3 minutos

const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const toMoneyText = (n) => (n ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const parseMoney = (v) => {
  let s = String(v || '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

let seq = 0;
const key = () => `i${Date.now()}${seq++}`;
const emptyItem = () => ({ _k: key(), descricao: '', quantidade: 1, valor: '' });

const emptyForm = () => ({
  destinatario: '',
  aos_cuidados: '',
  itens: [],
  prazo: '10 a 15 dias úteis',
  prazo_apos: true,
  entrega: 'RETIRADA POR CONTA DO CLIENTE',
  validade: '30 DIAS',
  observacoes: ''
});

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && Array.isArray(d.itens)) return { ...emptyForm(), ...d, itens: d.itens.map((it) => ({ ...emptyItem(), ...it, _k: key() })) };
  } catch {
    /* rascunho é só conveniência */
  }
  return emptyForm();
}

const prazoTexto = (f) => {
  const base = f.prazo.trim();
  if (!base) return '';
  return f.prazo_apos && !/após|apos/i.test(base) ? base + APOS : base;
};

function toServer(f) {
  return {
    destinatario: f.destinatario,
    aos_cuidados: f.aos_cuidados,
    itens: f.itens
      .filter((it) => it.descricao.trim() || it.valor)
      .map((it) => ({ descricao: it.descricao, quantidade: Number(it.quantidade) || 1, valor_unitario: parseMoney(it.valor) })),
    prazo_producao: prazoTexto(f),
    entrega: f.entrega,
    validade: f.validade,
    observacoes: f.observacoes
  };
}

function missingOf(f) {
  const out = [];
  if (!f.destinatario.trim()) out.push({ key: 'destinatario', text: 'Para quem é o orçamento?' });
  const itens = f.itens.filter((it) => it.descricao.trim() || it.valor);
  if (!itens.length) out.push({ key: 'produto', text: 'Inclua pelo menos um item.' });
  f.itens.forEach((it, i) => {
    if (!it.descricao.trim() && !it.valor) return;
    if (!it.descricao.trim()) out.push({ key: `item-${it._k}-descricao`, text: `Descreva o item ${i + 1}.` });
    if (!parseMoney(it.valor)) out.push({ key: `item-${it._k}-valor`, text: `Qual o valor do item ${i + 1}${it.descricao ? ` (${it.descricao.slice(0, 40)})` : ''}?` });
  });
  return out;
}

// Texto copiado do WhatsApp → mensagens. Entende "[19:32, 18/11/2026] Nome: texto"
// (copiar mensagens) e "18/11/2026 19:32 - Nome: texto" (exportar conversa).
const COPY_RE = /^\[(\d{1,2}:\d{2})[^\]]*\]\s*([^:]{1,60}):\s?(.*)$/;
const EXPORT_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+(\d{1,2}:\d{2})\s*-\s*([^:]{1,60}):\s?(.*)$/;
const IS_US = /classul|brindid|^voc[eê]$/i;
export function parseConversation(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(COPY_RE) || line.match(EXPORT_RE);
    if (m) out.push({ time: m[1], from_me: IS_US.test(m[2].trim()), text: m[3] });
    else if (out.length) out[out.length - 1].text += '\n' + line;
    else out.push({ time: '', from_me: false, text: line });
  }
  return out.filter((m) => m.text.trim());
}

function fromHermes(q, prev) {
  const prazo = (q?.prazo_producao || '').trim();
  return {
    ...prev,
    destinatario: q?.destinatario || prev.destinatario,
    aos_cuidados: q?.aos_cuidados || prev.aos_cuidados,
    itens: q?.itens?.length
      ? q.itens.map((it) => ({ _k: key(), descricao: it.descricao || '', quantidade: it.quantidade || 1, valor: toMoneyText(it.valor_unitario) }))
      : prev.itens,
    ...(prazo ? { prazo, prazo_apos: false } : {}),
    entrega: q?.entrega || prev.entrega,
    validade: q?.validade || prev.validade,
    observacoes: q?.observacoes || prev.observacoes
  };
}

function downloadBase64(base64, fileName) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ------------------------------------------------------------------ escolha do produto */

function ProdutoBusca({ produtos, onEscolher, onLivre, inputRef }) {
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const sugestoes = useMemo(() => buscarProdutos(produtos, texto, 300), [produtos, texto]);
  const escolher = (p) => {
    onEscolher(p);
    setTexto('');
  };
  const nav = useNavegacao(aberto ? sugestoes : [], escolher);

  return (
    <div className="relative">
      <div className="relative">
        <Package size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          data-field="produto"
          className={`${input} pl-9 pr-24`}
          placeholder='Digite o produto: "12x17", "estojo 20x16", "medalha"…'
          value={texto}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAberto(false);
            if (e.key === 'Enter' && !sugestoes.length && texto.trim()) {
              e.preventDefault();
              onLivre(texto.trim());
              setTexto('');
              return;
            }
            nav.onKeyDown(e);
          }}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-300 hidden sm:block">↑ ↓ Enter</span>
      </div>
      {aberto && (
        <div className="absolute z-20 mt-1 w-full max-h-96 overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xl">
          {!texto && sugestoes.length > 0 && (
            <div className="px-4 pt-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Produtos de A a Z</div>
          )}
          {sugestoes.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => nav.setAtivo(i)}
              onClick={() => escolher(p)}
              className={`w-full text-left px-4 py-2.5 border-b border-black/5 last:border-0 flex items-center justify-between gap-3 ${i === nav.ativo ? 'bg-brand-50' : ''}`}
            >
              <div className="min-w-0">
                <div className="font-bold text-sm text-brand-950 truncate">
                  <Realce texto={p.descricao} termos={texto} />
                </div>
                <div className="text-[11px] text-slate-500">
                  {p.codigo ? `cód. ${p.codigo}` : 'sem código'}
                  {p.uso ? ` · saiu ${p.uso}×` : ''}
                </div>
              </div>
              <span className="text-sm font-extrabold text-brand-700 shrink-0">{p.valor ? brl(p.valor) : 'sem preço'}</span>
            </button>
          ))}
          {!produtos.length && (
            <div className="px-4 py-3 text-xs text-slate-400">Nenhum produto cadastrado. Cadastre na aba Notas fiscais → Produtos.</div>
          )}
          {texto.trim() && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onLivre(texto.trim());
                setTexto('');
              }}
              className="w-full text-left px-4 py-2.5 text-sm font-bold text-brand-700 hover:bg-brand-50"
            >
              + Usar "{texto.trim()}" como item livre
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ conversa → Hermes */

function LerConversa({ onResult, onError }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [nome, setNome] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  useEffect(() => () => void run.current++, []);

  const msgs = useMemo(() => parseConversation(texto), [texto]);

  const ler = async () => {
    if (!msgs.length) return onError('Cole a conversa do WhatsApp primeiro.');
    const meu = ++run.current;
    setBusy(true);
    try {
      let r = await api.quoteAnalyze(msgs.slice(-20), { name: nome.trim(), phone: '' });
      for (let i = 0; !r.done && i < POLL_MAX; i++) {
        await new Promise((res) => setTimeout(res, POLL_MS));
        if (meu !== run.current) return;
        r = await api.quoteTask(r.task);
      }
      if (meu !== run.current) return;
      if (!r.done) throw new Error('O Hermes demorou demais. Tente de novo ou preencha à mão.');
      onResult(r.quote, r.perguntas || []);
      setAberto(false);
    } catch (e) {
      if (meu === run.current) onError(e.message, e);
    } finally {
      if (meu === run.current) setBusy(false);
    }
  };

  return (
    <div className={`${card} p-5`}>
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setAberto((v) => !v)}>
        <span className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-sun-100 text-yellow-700">
            <Sparkles size={15} />
          </span>
          <span>
            <span className="block text-sm font-extrabold text-brand-950">Preencher pela conversa</span>
            <span className="block text-xs font-semibold text-slate-400">Cole as mensagens do WhatsApp e o Hermes monta os itens</span>
          </span>
        </span>
        {aberto ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {aberto && (
        <div className="mt-4 space-y-3">
          <div>
            <label className={label}>Nome do cliente (opcional)</label>
            <input className={input} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como aparece no WhatsApp" />
          </div>
          <div>
            <label className={label}>Conversa</label>
            <textarea
              className={`${input} font-mono text-xs`}
              rows={8}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={'[14:02, 19/11/2026] Cliente: Boa tarde, quanto fica uma placa 20x30 com estojo?\n[14:05, 19/11/2026] Classul: Fica R$ 290,00 cada…'}
            />
            <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
              {msgs.length
                ? `${msgs.length} mensagens${msgs.length > 20 ? ' (o Hermes lê as últimas 20)' : ''} · ${msgs.filter((m) => m.from_me).length} da Classul`
                : 'No WhatsApp Web: selecione as mensagens, copie e cole aqui. Valores só entram se foram ditos na conversa.'}
            </p>
          </div>
          <button className={btnPrimary} onClick={ler} disabled={busy || !msgs.length}>
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <MessageSquareText size={15} />}
            {busy ? 'O Hermes está lendo… (uns 15 s)' : 'Ler com o Hermes'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ página */

export default function Quotes({ onAuthError }) {
  const toast = useToast();
  const [form, setForm] = useState(readDraft);
  const [produtos, setProdutos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [perguntas, setPerguntas] = useState([]);
  const [confirmMissing, setConfirmMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState(null);
  const produtoRef = useRef(null);
  const rootRef = useRef(null);

  const onError = useCallback(
    (msg, err) => {
      if (err && onAuthError?.(err)) return;
      toast(msg, 'error');
    },
    [onAuthError, toast]
  );

  useEffect(() => {
    api.quoteProdutos().then(setProdutos).catch((e) => onError(e.message, e));
    api.listClients().then((l) => setClientes(Array.isArray(l) ? l : [])).catch(() => {});
  }, [onError]);

  useEffect(() => {
    try {
      const { itens, ...rest } = form;
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...rest, itens: itens.map(({ _k, ...it }) => it) }));
    } catch {
      /* sem armazenamento: segue sem rascunho */
    }
  }, [form]);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setPdf(null);
    setConfirmMissing(false);
  };
  const setItem = (k, patch) => set({ itens: form.itens.map((it) => (it._k === k ? { ...it, ...patch } : it)) });
  const focusField = (k) => {
    const el = rootRef.current?.querySelector(`[data-field="${k}"]`);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const addProduto = (p) => {
    const it = { _k: key(), descricao: p.descricao, quantidade: 1, valor: toMoneyText(p.valor) };
    set({ itens: [...form.itens, it] });
    setTimeout(() => focusField(`item-${it._k}-qtd`), 0);
  };
  const addLivre = (descricao = '') => {
    const it = { ...emptyItem(), descricao };
    set({ itens: [...form.itens, it] });
    setTimeout(() => focusField(`item-${it._k}-${descricao ? 'valor' : 'descricao'}`), 0);
  };

  const missing = missingOf(form);
  const blocking = missing.filter((m) => !/-valor$/.test(m.key));
  const vazios = new Set(missing.map((m) => m.key));
  const total = form.itens.reduce((s, it) => s + (parseMoney(it.valor) || 0) * (Number(it.quantidade) || 1), 0);
  const semValor = form.itens.some((it) => it.descricao.trim() && !parseMoney(it.valor));

  const generate = async () => {
    if (blocking.length) return focusField(blocking[0].key);
    if (missing.length && !confirmMissing) {
      setConfirmMissing(true);
      return focusField(missing[0].key);
    }
    setBusy(true);
    try {
      const r = await api.quotePdf(toServer(form));
      downloadBase64(r.base64, r.file_name);
      setPdf(r);
      toast('PDF do orçamento baixado.', 'success');
    } catch (e) {
      onError(e.message, e);
    } finally {
      setBusy(false);
      setConfirmMissing(false);
    }
  };

  const limpar = () => {
    if (!window.confirm('Começar um orçamento novo? O atual será apagado da tela.')) return;
    setForm(emptyForm());
    setPerguntas([]);
    setPdf(null);
    setConfirmMissing(false);
  };

  const prazoCustom = !PRAZOS.includes(form.prazo);

  return (
    <div ref={rootRef} className="p-1 sm:p-2 space-y-4 max-w-5xl mx-auto pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-950">Orçamento</h1>
          <p className="text-sm font-medium text-slate-500">PDF no papel timbrado da Classul, igual ao da extensão do WhatsApp.</p>
        </div>
        <button className={btnGhost} onClick={limpar}>
          <RotateCcw size={15} /> Novo orçamento
        </button>
      </div>

      <LerConversa
        onError={onError}
        onResult={(q, p) => {
          setForm((f) => fromHermes(q, f));
          setPerguntas(p);
          setPdf(null);
          toast('Hermes preencheu o orçamento. Confira antes de gerar.', 'success');
        }}
      />

      {(perguntas.length > 0 || (confirmMissing && missing.length > 0)) && (
        <div className="rounded-3xl border-2 border-sun-300 bg-sun-100 px-5 py-4 text-sm">
          <b className="text-brand-950">Falta para fechar o orçamento:</b>
          <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-slate-700">
            {missing.map((m) => (
              <li key={m.key}>
                <button className="font-semibold text-brand-700 hover:underline" onClick={() => focusField(m.key)}>
                  {m.text}
                </button>
              </li>
            ))}
            {perguntas.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={`${card} p-5 sm:p-6 space-y-4`}>
        <h3 className={label}>1 · Para quem</h3>
        <div className="grid sm:grid-cols-[2fr_1fr] gap-3">
          <div>
            <label className={label}>Destinatário — sai como "À …"</label>
            <input
              data-field="destinatario"
              list="quote-clientes"
              className={`${input} ${confirmMissing && vazios.has('destinatario') ? 'border-flame-400' : ''}`}
              value={form.destinatario}
              onChange={(e) => set({ destinatario: e.target.value.toUpperCase() })}
              placeholder="BRIGADA MILITAR DE MONTENEGRO-RS"
            />
            <datalist id="quote-clientes">
              {clientes.slice(0, 500).map((c) => (
                <option key={c.id} value={String(c.name || '').toUpperCase()} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={label}>A/C (opcional)</label>
            <input className={input} value={form.aos_cuidados} onChange={(e) => set({ aos_cuidados: e.target.value })} placeholder="Compras" />
          </div>
        </div>
        {clientes.length > 0 && (
          <p className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
            <Users size={12} /> Os clientes cadastrados aparecem como sugestão ao digitar.
          </p>
        )}
      </div>

      <div className={`${card} p-5 sm:p-6 space-y-4`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={label + ' mb-0'}>2 · Itens</h3>
          <button className="text-xs font-bold text-brand-700 hover:underline inline-flex items-center gap-1" onClick={() => addLivre()}>
            <Plus size={13} /> Item livre
          </button>
        </div>
        <ProdutoBusca produtos={produtos} inputRef={produtoRef} onEscolher={addProduto} onLivre={addLivre} />
        <p className="text-[11px] font-semibold text-slate-400">
          Escolha do catálogo (o mesmo das Notas fiscais) e o preço cadastrado já vem preenchido. A descrição pode ser ajustada para o orçamento.
        </p>

        {form.itens.length > 0 && (
          <div className="space-y-3">
            {form.itens.map((it, i) => {
              const v = parseMoney(it.valor);
              return (
                <div key={it._k} className="rounded-2xl border-2 border-slate-100 p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">Item {i + 1}</span>
                    <button
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-flame-600 hover:bg-flame-50"
                      title="Tirar item"
                      onClick={() => set({ itens: form.itens.filter((x) => x._k !== it._k) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    data-field={`item-${it._k}-descricao`}
                    className={`${input} ${confirmMissing && vazios.has(`item-${it._k}-descricao`) ? 'border-flame-400' : ''}`}
                    rows={2}
                    value={it.descricao}
                    onChange={(e) => setItem(it._k, { descricao: e.target.value })}
                    placeholder="Placa aço inox escovado gravado tam 60x80cm"
                  />
                  <div className="mt-2 grid grid-cols-[90px_1fr_auto] gap-2 items-end">
                    <div>
                      <label className={label}>Qtd</label>
                      <input
                        data-field={`item-${it._k}-qtd`}
                        className={input}
                        type="number"
                        min="1"
                        value={it.quantidade}
                        onChange={(e) => setItem(it._k, { quantidade: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && focusField(`item-${it._k}-valor`)}
                      />
                    </div>
                    <div>
                      <label className={label}>Valor unitário (R$)</label>
                      <input
                        data-field={`item-${it._k}-valor`}
                        className={`${input} ${confirmMissing && vazios.has(`item-${it._k}-valor`) ? 'border-sun-400' : ''}`}
                        inputMode="decimal"
                        value={it.valor}
                        onChange={(e) => setItem(it._k, { valor: e.target.value })}
                        onBlur={() => v && setItem(it._k, { valor: toMoneyText(v) })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            produtoRef.current?.focus();
                          }
                        }}
                        placeholder="a combinar"
                      />
                    </div>
                    <div className="pb-2 text-right min-w-[90px]">
                      <div className={label + ' mb-0.5'}>Subtotal</div>
                      <div className="text-sm font-extrabold text-brand-950">{v ? brl(v * (Number(it.quantidade) || 1)) : '—'}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-end gap-3 pt-1">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total</span>
              <span className="text-xl font-extrabold text-brand-950">{brl(total)}</span>
              {semValor && <span className="text-[11px] font-semibold text-slate-400">+ itens a combinar</span>}
            </div>
          </div>
        )}
      </div>

      <div className={`${card} p-5 sm:p-6 space-y-5`}>
        <h3 className={label}>3 · Condições</h3>

        <div>
          <label className={label}>Prazo de produção</label>
          <div className="flex flex-wrap gap-2">
            {PRAZOS.map((p) => (
              <button key={p} className={chip(form.prazo === p)} onClick={() => set({ prazo: p })}>
                {p}
              </button>
            ))}
            <button className={chip(prazoCustom)} onClick={() => !prazoCustom && set({ prazo: '' })}>
              Outro
            </button>
          </div>
          {prazoCustom && (
            <input className={`${input} mt-2`} autoFocus value={form.prazo} onChange={(e) => set({ prazo: e.target.value })} placeholder="ex.: 7 dias úteis" />
          )}
          <label className="mt-2.5 flex items-center gap-2 text-xs font-semibold text-slate-600 select-none">
            <input type="checkbox" className="accent-brand-600 w-4 h-4" checked={form.prazo_apos} onChange={(e) => set({ prazo_apos: e.target.checked })} />
            Contar após confirmar o pedido de compra
          </label>
          <p className="mt-1.5 text-[11px] font-semibold text-slate-400">Sai no PDF: “{prazoTexto(form) || 'padrão da Classul'}”</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className={label}>Entrega</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {ENTREGAS.map((p) => (
                <button key={p} className={chip(form.entrega === p)} onClick={() => set({ entrega: p })}>
                  Retirada pelo cliente
                </button>
              ))}
            </div>
            <input className={input} value={form.entrega} onChange={(e) => set({ entrega: e.target.value.toUpperCase() })} placeholder="RETIRADA POR CONTA DO CLIENTE" />
          </div>
          <div>
            <label className={label}>Validade</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {VALIDADES.map((p) => (
                <button key={p} className={chip(form.validade === p)} onClick={() => set({ validade: p })}>
                  {p.toLowerCase()}
                </button>
              ))}
            </div>
            <input className={input} value={form.validade} onChange={(e) => set({ validade: e.target.value.toUpperCase() })} placeholder="30 DIAS" />
          </div>
        </div>

        <div>
          <label className={label}>Observação impressa (opcional)</label>
          <textarea className={input} rows={2} value={form.observacoes} onChange={(e) => set({ observacoes: e.target.value })} placeholder="Layout incluso no valor" />
        </div>
      </div>

      <div className={`${card} p-4 sm:p-5 flex flex-wrap items-center gap-3 sticky bottom-0`}>
        <div className="flex-1 min-w-[180px] text-sm">
          {confirmMissing ? (
            <span className="font-semibold text-yellow-700">Item sem valor sai como “a combinar”. Clique de novo para gerar assim.</span>
          ) : blocking.length ? (
            <span className="font-semibold text-slate-400">{blocking[0].text}</span>
          ) : (
            <span className="font-semibold text-slate-500">
              {form.itens.length} {form.itens.length === 1 ? 'item' : 'itens'} · <b className="text-brand-950">{brl(total)}</b>
            </span>
          )}
        </div>
        {pdf && (
          <button className={btnGhost} onClick={() => downloadBase64(pdf.base64, pdf.file_name)} title="Baixar de novo">
            <FileDown size={15} /> Baixar de novo
          </button>
        )}
        <button className={btnPrimary} onClick={generate} disabled={busy}>
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <FileText size={15} />}
          {busy ? 'Gerando…' : confirmMissing ? 'Gerar mesmo assim' : 'Gerar PDF'}
        </button>
      </div>
    </div>
  );
}
