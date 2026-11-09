import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, FileDown, Paperclip, Plus, Trash2, Sparkles, MessageSquareText, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { api } from '../../services/classul';
import { isWhatsAppDark, readActiveContact, readRecentMessages } from '../../utils/dom';
import { pasteFilesIntoChat } from '../../utils/paste';
import { initials } from './format';

// Orçamento em PDF a partir da conversa: lê as últimas 20 mensagens, o Hermes
// (assinatura da OpenAI do Lucas) devolve itens e valores, o painel pede o que
// faltar e o sistema monta o PDF no papel timbrado da Classul.

const WIDTH = 400;
const LIMIT = 20;
const POLL_MS = 4000;
const POLL_MAX = 45; // ~3 minutos

const canDock = () => window.innerWidth >= 1100;
const readDock = () => {
    try {
        return localStorage.getItem('classulPanelDocked') !== '0';
    } catch {
        return true;
    }
};

const emptyItem = () => ({ descricao: '', quantidade: 1, valor: '' });
const toMoneyText = (n) => (n ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const parseMoney = (v) => {
    let s = String(v || '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
};

function fromServer(q, contact) {
    return {
        destinatario: q?.destinatario || (contact?.nameIsNumber ? '' : (contact?.name || '').toUpperCase()),
        aos_cuidados: q?.aos_cuidados || '',
        itens: q?.itens?.length
            ? q.itens.map((it) => ({ descricao: it.descricao || '', quantidade: it.quantidade || 1, valor: toMoneyText(it.valor_unitario) }))
            : [emptyItem()],
        prazo_producao: q?.prazo_producao || '',
        entrega: q?.entrega || '',
        validade: q?.validade || '',
        observacoes: q?.observacoes || ''
    };
}

function toServer(f) {
    return {
        ...f,
        itens: f.itens
            .filter((it) => it.descricao.trim() || it.valor)
            .map((it) => ({ descricao: it.descricao, quantidade: Number(it.quantidade) || 1, valor_unitario: parseMoney(it.valor) }))
    };
}

// O que ainda falta, conferido no próprio formulário (as perguntas do Hermes ficam à parte).
function missingOf(f) {
    const out = [];
    if (!f.destinatario.trim()) out.push({ key: 'destinatario', text: 'Para quem é o orçamento?' });
    const itens = f.itens.filter((it) => it.descricao.trim() || it.valor);
    if (!itens.length) out.push({ key: 'item-0-descricao', text: 'Inclua pelo menos um item.' });
    f.itens.forEach((it, i) => {
        if (!it.descricao.trim() && !it.valor) return;
        if (!it.descricao.trim()) out.push({ key: `item-${i}-descricao`, text: `Descreva o item ${i + 1}.` });
        if (!parseMoney(it.valor)) out.push({ key: `item-${i}-valor`, text: `Qual o valor do item ${i + 1}${it.descricao ? ` (${it.descricao.slice(0, 40)})` : ''}?` });
    });
    return out;
}

function downloadBase64(base64, fileName) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return new File([blob], fileName, { type: 'application/pdf' });
}

export default function QuotePanel({ start, onClose }) {
    const [contact] = useState(() => start?.contact || readActiveContact());
    const [stage, setStage] = useState('reading'); // reading | thinking | form
    const [messages, setMessages] = useState([]);
    const [showMessages, setShowMessages] = useState(false);
    const [error, setError] = useState('');
    const [questions, setQuestions] = useState([]);
    const [form, setForm] = useState(() => fromServer(null, start?.contact || readActiveContact()));
    const [showConditions, setShowConditions] = useState(false);
    const [busy, setBusy] = useState('');
    const [confirmMissing, setConfirmMissing] = useState(false);
    const [pdf, setPdf] = useState(null); // { file, fileName }
    const [notice, setNotice] = useState('');
    const [docked] = useState(() => readDock() && canDock());
    const [dark] = useState(isWhatsAppDark);
    const runRef = useRef(0);
    const rootRef = useRef(null);

    const analyze = useCallback(async () => {
        const run = ++runRef.current;
        const alive = () => run === runRef.current;
        setError('');
        setPdf(null);
        setConfirmMissing(false);
        setStage('reading');
        const msgs = readRecentMessages(LIMIT);
        setMessages(msgs);
        if (!msgs.length) {
            setError('Não encontrei mensagens de texto nesta conversa. Preencha o orçamento à mão.');
            setStage('form');
            return;
        }
        setStage('thinking');
        try {
            let r = await api('/api/quotes/analyze', {
                method: 'POST',
                body: { messages: msgs, contact: { name: contact?.nameIsNumber ? '' : contact?.name || '', phone: contact?.phone || '' } }
            });
            for (let i = 0; !r.done && i < POLL_MAX; i++) {
                await new Promise((res) => setTimeout(res, POLL_MS));
                if (!alive()) return;
                r = await api(`/api/quotes/task/${encodeURIComponent(r.task)}`);
            }
            if (!alive()) return;
            if (!r.done) throw new Error('O Hermes demorou demais. Tente de novo ou preencha à mão.');
            setForm(fromServer(r.quote, contact));
            setQuestions(r.perguntas || []);
            setShowConditions(Boolean(r.quote?.observacoes));
        } catch (e) {
            if (!alive()) return;
            setError(e.message + ' — você pode preencher à mão.');
        }
        if (alive()) setStage('form');
    }, [contact]);

    useEffect(() => {
        analyze();
        return () => {
            runRef.current++;
        };
    }, [analyze]);

    useEffect(() => {
        const apply = () => {
            const on = docked && canDock();
            document.body.style.setProperty('--clp-w', WIDTH + 'px');
            document.body.classList.toggle('classul-docked', on);
        };
        apply();
        window.addEventListener('resize', apply);
        return () => {
            window.removeEventListener('resize', apply);
            document.body.classList.remove('classul-docked');
        };
    }, [docked]);

    useEffect(() => {
        const onKey = (e) => {
            const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
            if (e.key === 'Escape' && !typing && e.target?.closest?.('.clp')) onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const set = (patch) => {
        setForm((f) => ({ ...f, ...patch }));
        setPdf(null);
        setConfirmMissing(false);
    };
    const setItem = (i, patch) => set({ itens: form.itens.map((it, n) => (n === i ? { ...it, ...patch } : it)) });

    const missing = missingOf(form);
    const blocking = missing.filter((m) => !/-valor$/.test(m.key));
    const focusField = (key) => {
        const el = rootRef.current?.querySelector(`[data-field="${key}"]`);
        if (el) {
            el.focus();
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    };

    const generate = async () => {
        if (blocking.length) {
            focusField(blocking[0].key);
            return;
        }
        if (missing.length && !confirmMissing) {
            setConfirmMissing(true);
            focusField(missing[0].key);
            return;
        }
        setBusy('pdf');
        setNotice('');
        try {
            const r = await api('/api/quotes/pdf', { method: 'POST', body: { quote: toServer(form) } });
            const file = downloadBase64(r.base64, r.file_name);
            setPdf({ file, fileName: r.file_name, base64: r.base64 });
            setNotice('PDF baixado.');
        } catch (e) {
            setNotice('Erro: ' + e.message);
        } finally {
            setBusy('');
            setConfirmMissing(false);
        }
    };

    const attach = async () => {
        if (!pdf) return;
        setBusy('attach');
        setNotice('');
        try {
            await pasteFilesIntoChat([pdf.file]);
            setNotice('PDF anexado na conversa. Confira e aperte Enviar.');
        } catch (e) {
            setNotice('Erro: ' + e.message);
        } finally {
            setBusy('');
        }
    };

    const title = contact?.name || 'Orçamento';
    const working = stage !== 'form';
    const vazios = missing.map((m) => m.key);

    let body;
    if (working) {
        body = (
            <>
                <div className="clp-card clq-working">
                    <Sparkles size={18} className="clp-spin-slow" />
                    <div>
                        <b>{stage === 'reading' ? 'Lendo a conversa…' : 'O Hermes está lendo as mensagens…'}</b>
                        <span>{stage === 'thinking' ? `${messages.length} mensagens · costuma levar uns 15 segundos` : ''}</span>
                    </div>
                </div>
                <div className="clp-skel" />
                <div className="clp-skel" style={{ opacity: 0.6 }} />
            </>
        );
    } else {
        body = (
            <>
                {error && <div className="clp-alert error">{error}</div>}

                {(questions.length > 0 || missing.length > 0) && (
                    <div className="clp-alert">
                        <div style={{ flex: 1 }}>
                            <b>Falta para fechar o orçamento:</b>
                            <ul className="clq-list">
                                {missing.map((m) => (
                                    <li key={m.key}>
                                        <button className="clp-link" onClick={() => focusField(m.key)}>{m.text}</button>
                                    </li>
                                ))}
                                {questions
                                    .filter((q) => !(/valor|preço|custa/i.test(q) && missing.some((m) => m.key.endsWith('-valor'))))
                                    .filter((q) => !(/para quem|destinat/i.test(q) && missing.some((m) => m.key === 'destinatario')))
                                    .map((q) => (
                                        <li key={q}>{q}</li>
                                    ))}
                            </ul>
                            {!missing.length && <span className="clp-muted">Os campos obrigatórios estão preenchidos; confira as perguntas acima.</span>}
                        </div>
                    </div>
                )}

                <div className="clp-section-title">Para quem</div>
                <div className="clp-card clp-grid">
                    <label className="clp-field span">
                        <span className="clp-label">Destinatário <small>sai como "À …"</small></span>
                        <input
                            data-field="destinatario"
                            className={'clp-input' + (vazios.includes('destinatario') ? ' clq-missing' : '')}
                            value={form.destinatario}
                            onChange={(e) => set({ destinatario: e.target.value })}
                            placeholder="BRIGADA MILITAR DE MONTENEGRO-RS"
                        />
                    </label>
                    <label className="clp-field span">
                        <span className="clp-label">A/C <small>opcional</small></span>
                        <input className="clp-input" value={form.aos_cuidados} onChange={(e) => set({ aos_cuidados: e.target.value })} placeholder="Compras" />
                    </label>
                </div>

                <div className="clp-section-title">
                    Itens
                    <button className="clp-link" onClick={() => set({ itens: [...form.itens, emptyItem()] })}>
                        <Plus size={13} /> Item
                    </button>
                </div>
                {form.itens.map((it, i) => (
                    <div className="clp-card clp-grid" key={i}>
                        <label className="clp-field span">
                            <span className="clp-label clq-item-head">
                                Item {i + 1}
                                {form.itens.length > 1 && (
                                    <button className="clp-icon sm" title="Tirar item" onClick={() => set({ itens: form.itens.filter((_, n) => n !== i) })}>
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </span>
                            <textarea
                                data-field={`item-${i}-descricao`}
                                className={'clp-input clq-desc' + (vazios.includes(`item-${i}-descricao`) ? ' clq-missing' : '')}
                                value={it.descricao}
                                onChange={(e) => setItem(i, { descricao: e.target.value })}
                                placeholder="Placa aço inox escovado gravado tam 60x80cm"
                                rows={2}
                            />
                        </label>
                        <label className="clp-field">
                            <span className="clp-label">Quantidade</span>
                            <input
                                className="clp-input"
                                type="number"
                                min="1"
                                value={it.quantidade}
                                onChange={(e) => setItem(i, { quantidade: e.target.value })}
                            />
                        </label>
                        <label className="clp-field">
                            <span className="clp-label">Valor unitário (R$)</span>
                            <input
                                data-field={`item-${i}-valor`}
                                className={'clp-input' + (vazios.includes(`item-${i}-valor`) ? ' clq-missing' : '')}
                                inputMode="decimal"
                                value={it.valor}
                                onChange={(e) => setItem(i, { valor: e.target.value })}
                                onBlur={() => parseMoney(it.valor) && setItem(i, { valor: toMoneyText(parseMoney(it.valor)) })}
                                placeholder="0,00"
                            />
                        </label>
                    </div>
                ))}

                <button className="clp-section-title clq-toggle" onClick={() => setShowConditions((v) => !v)}>
                    Condições e observação
                    {showConditions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showConditions && (
                    <div className="clp-card clp-grid">
                        <label className="clp-field span">
                            <span className="clp-label">Prazo de produção</span>
                            <input className="clp-input" value={form.prazo_producao} onChange={(e) => set({ prazo_producao: e.target.value })} placeholder="10 a 15 dias uteis, após confirmar pedido de compra" />
                        </label>
                        <label className="clp-field span">
                            <span className="clp-label">Entrega</span>
                            <input className="clp-input" value={form.entrega} onChange={(e) => set({ entrega: e.target.value })} placeholder="RETIRADA POR CONTA DO CLIENTE" />
                        </label>
                        <label className="clp-field">
                            <span className="clp-label">Validade</span>
                            <input className="clp-input" value={form.validade} onChange={(e) => set({ validade: e.target.value })} placeholder="30 DIAS" />
                        </label>
                        <label className="clp-field span">
                            <span className="clp-label">Observação <small>opcional</small></span>
                            <textarea className="clp-input" rows={2} value={form.observacoes} onChange={(e) => set({ observacoes: e.target.value })} />
                        </label>
                    </div>
                )}

                {messages.length > 0 && (
                    <>
                        <button className="clp-section-title clq-toggle" onClick={() => setShowMessages((v) => !v)}>
                            <span><MessageSquareText size={13} /> {messages.length} mensagens lidas</span>
                            {showMessages ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {showMessages && (
                            <div className="clp-card clq-msgs">
                                {messages.map((m, i) => (
                                    <div key={i} className={'clq-msg' + (m.from_me ? ' me' : '')}>
                                        <small>{m.from_me ? 'Classul' : 'Cliente'}{m.time ? ` · ${m.time}` : ''}</small>
                                        {m.text}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </>
        );
    }

    return createPortal(
        <div
            ref={rootRef}
            className={'clp' + (dark ? ' dark' : '') + (docked && canDock() ? ' docked' : '')}
            style={{ '--clp-w': WIDTH + 'px' }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="clp-head">
                {contact?.avatar ? <img className="clp-avatar" src={contact.avatar} alt="" /> : <div className="clp-avatar">{initials(title)}</div>}
                <div className="clp-who">
                    <b title={title}>Orçamento · {title}</b>
                    <span>Últimas {LIMIT} mensagens · Hermes</span>
                </div>
                <button className="clp-icon" title="Ler a conversa de novo" onClick={analyze} disabled={working}>
                    <RefreshCw size={16} className={working ? 'clp-spin' : ''} />
                </button>
                <button className="clp-icon" title="Fechar (Esc)" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>

            <div className="clp-body">{body}</div>

            {!working && (
                <div className="clp-foot clq-foot">
                    {notice && <div className={'clq-notice' + (notice.startsWith('Erro') ? ' error' : '')}>{notice}</div>}
                    {confirmMissing && (
                        <div className="clq-notice warn">
                            Item sem valor sai como "a combinar". Clique de novo para gerar assim, ou preencha o valor.
                        </div>
                    )}
                    {pdf ? (
                        <div className="clp-row">
                            <button className="clp-btn primary" style={{ flex: 1 }} onClick={attach} disabled={busy === 'attach'}>
                                <Paperclip size={16} /> {busy === 'attach' ? 'Anexando…' : 'Anexar na conversa'}
                            </button>
                            <button className="clp-btn ghost" title="Baixar de novo" onClick={() => downloadBase64(pdf.base64, pdf.fileName)}>
                                <FileDown size={16} />
                            </button>
                        </div>
                    ) : (
                        <button className="clp-btn primary block" onClick={generate} disabled={busy === 'pdf'}>
                            <FileText size={16} />
                            {busy === 'pdf' ? 'Gerando…' : confirmMissing ? 'Gerar mesmo assim' : 'Gerar PDF'}
                        </button>
                    )}
                </div>
            )}
        </div>,
        document.body
    );
}
