import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, Check, Copy, LoaderCircle, MessageSquareText, Paperclip, Send, Archive, ArchiveRestore,
    FileText, ClipboardPaste, BellRing
} from 'lucide-react';
import { api } from '../../services/classul';
import { insertIntoComposer } from '../../utils/dom';
import { toast } from '../../utils/toast';
import {
    STATUSES, statusMeta, PAYMENTS, CASE_DOT, colorFor, initials, relTime, formatBRL, orderSummary
} from './format';

const FIELDS = [
    'customer_name', 'phone', 'product', 'size', 'case_color', 'product_type', 'value',
    'payment_status', 'due_date', 'pickup_time', 'description'
];

const blank = (contact) => ({
    customer_name: contact?.name || '',
    phone: contact?.phone || '',
    product: '',
    size: '',
    case_color: '',
    product_type: 'Maquina',
    value: '',
    payment_status: 'pendente',
    due_date: '',
    pickup_time: '',
    description: ''
});

const fromOrder = (o) => Object.fromEntries(FIELDS.map((f) => [f, o[f] ?? '']));

function Chips({ options, value, onChange, dots, allowEmpty = true, disabled }) {
    return (
        <div className="clp-chips">
            {options.map((opt) => (
                <button
                    key={opt}
                    type="button"
                    disabled={disabled}
                    className={'clp-chip' + (value === opt ? ' on' : '')}
                    onClick={() => onChange(value === opt && allowEmpty ? '' : opt)}
                >
                    {dots?.[opt] && <i style={{ background: dots[opt] }} />}
                    {opt}
                </button>
            ))}
        </div>
    );
}

function Field({ label, hint, span, children }) {
    return (
        // div, não <label>: um label com botões dentro "clica" o primeiro chip.
        <div className={'clp-field' + (span ? ' span' : '')}>
            <span className="clp-label">
                {label} {hint && <small>{hint}</small>}
            </span>
            {children}
        </div>
    );
}

// Barra de etapas: clicar move o pedido. Etapas que avisam o cliente pedem confirmação.
function StatusSteps({ order, onMoved }) {
    const [pending, setPending] = useState(null);
    const [busy, setBusy] = useState(false);
    const idx = STATUSES.findIndex((s) => s.id === order.status);

    const move = async (status) => {
        setBusy(true);
        try {
            const r = await api(`/api/orders/${order.id}/status`, { method: 'PATCH', body: { status } });
            const n = r.notification;
            if (n?.sent) toast(`✓ ${statusMeta(status).long} — cliente avisado no WhatsApp`, 'ok');
            else if (n?.error) toast(`Etapa alterada, mas o aviso falhou: ${n.error}`, 'error');
            else toast(`✓ Movido para ${statusMeta(status).long}`, 'ok');
            onMoved(r.order);
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            setBusy(false);
            setPending(null);
        }
    };

    const pick = (s) => {
        if (s.id === order.status || busy) return;
        if (s.notify) setPending(s);
        else move(s.id);
    };

    return (
        <div>
            <div className="clp-steps">
                {STATUSES.map((s, i) => (
                    <button
                        key={s.id}
                        type="button"
                        disabled={busy}
                        title={`Mover para ${s.long}`}
                        className={'clp-step' + (i < idx ? ' done' : '') + (i === idx ? ' current' : '')}
                        onClick={() => pick(s)}
                    >
                        <div className="clp-step-bar" style={i <= idx ? { background: statusMeta(order.status).color } : null} />
                        <span>{s.label}</span>
                    </button>
                ))}
            </div>
            {pending && (
                <div className="clp-confirm">
                    <div style={{ display: 'flex', gap: 8 }}>
                        <BellRing size={16} style={{ flex: 'none', color: 'var(--brand)' }} />
                        <span>
                            Mover para <b>{pending.long}</b>? O cliente recebe a mensagem automática desta etapa no
                            WhatsApp.
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="clp-btn ghost sm" onClick={() => setPending(null)} disabled={busy}>
                            Cancelar
                        </button>
                        <button className="clp-btn primary sm" onClick={() => move(pending.id)} disabled={busy}>
                            {busy ? <LoaderCircle size={14} className="clp-spin" /> : <Check size={14} />} Mover
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function Comments({ order, detail, onAdded }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const comments = detail?.comments || [];

    const send = async () => {
        const body = text.trim();
        if (!body) return;
        setBusy(true);
        try {
            const c = await api(`/api/orders/${order.id}/comments`, { method: 'POST', body: { body } });
            setText('');
            onAdded(c);
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="clp-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="clp-section-title">
                <span>Comentários {comments.length > 0 && `· ${comments.length}`}</span>
            </div>
            {!detail && <div className="clp-muted">Carregando…</div>}
            {detail && !comments.length && <div className="clp-muted">Nenhum comentário ainda.</div>}
            {comments.map((c) => (
                <div className="clp-comment" key={c.id}>
                    <div className="clp-avatar" style={{ background: colorFor(c.author || '?') }}>
                        {initials(c.author || '?')}
                    </div>
                    <div className="clp-bubble">
                        <header>
                            <b>{c.author || 'Sem nome'}</b>
                            <span>{relTime(c.created_at)}</span>
                        </header>
                        <p>{c.body}</p>
                    </div>
                </div>
            ))}
            <div className="clp-compose">
                <textarea
                    className="clp-input"
                    placeholder="Escreva um comentário…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        }
                    }}
                />
                <button className="clp-btn primary" style={{ height: 38 }} onClick={send} disabled={busy || !text.trim()}>
                    {busy ? <LoaderCircle size={16} className="clp-spin" /> : <Send size={16} />}
                </button>
            </div>
        </div>
    );
}

function Files({ detail }) {
    const files = detail?.attachments || [];
    const sent = (detail?.messages || []).filter((m) => m.success);
    if (!detail || (!files.length && !sent.length)) return null;
    return (
        <div className="clp-card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {files.length > 0 && <div className="clp-section-title">Arquivos · {files.length}</div>}
            {files.map((f) => (
                <a key={f.id} className="clp-file" href={f.web_view_link} target="_blank" rel="noreferrer">
                    {f.category === 'nota_fiscal' ? <FileText size={16} color="var(--brand)" /> : <Paperclip size={16} />}
                    <span>{f.name}</span>
                    <small className="clp-muted">{relTime(f.created_at)}</small>
                </a>
            ))}
            {sent.length > 0 && (
                <>
                    <div className="clp-section-title" style={{ marginTop: files.length ? 8 : 0 }}>
                        Avisos enviados
                    </div>
                    {sent.map((m) => (
                        <div key={m.id} className="clp-file" title={m.body}>
                            <BellRing size={15} />
                            <span>{statusMeta(m.status_trigger).long}</span>
                            <small className="clp-muted">{relTime(m.created_at)}</small>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}

export default function OrderEditor({ order, contact, catalog, onBack, onSaved, onChanged }) {
    const isNew = !order;
    const initial = useMemo(() => (order ? fromOrder(order) : blank(contact)), [order?.id, order?.updated_at]); // eslint-disable-line
    const [form, setForm] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [detail, setDetail] = useState(null);
    const [current, setCurrent] = useState(order);
    const [copied, setCopied] = useState(false);
    const firstInput = useRef(null);
    const prevInitial = useRef(initial);
    const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

    // O pedido mudou lá fora (salvou, mudou de etapa): atualiza o formulário,
    // mas sem jogar fora o que a pessoa está digitando.
    useEffect(() => {
        const was = prevInitial.current;
        prevInitial.current = initial;
        setForm((f) => (FIELDS.every((k) => String(f[k] ?? '') === String(was[k] ?? '')) ? initial : f));
        if (order) setCurrent((c) => ({ ...c, ...order }));
    }, [initial]); // eslint-disable-line

    // nome/telefone do perfil chegam depois de abrir o formulário (contato não salvo)
    useEffect(() => {
        if (isNew && contact?.name && !form.customer_name) set('customer_name', contact.name);
    }, [contact?.name]); // eslint-disable-line
    useEffect(() => {
        if (isNew && contact?.phone && !form.phone) set('phone', contact.phone);
    }, [contact?.phone]); // eslint-disable-line

    useEffect(() => {
        if (isNew) {
            setTimeout(() => firstInput.current?.focus(), 50);
            return;
        }
        let alive = true;
        setDetail(null);
        api(`/api/orders/${order.id}`)
            .then((d) => alive && setDetail(d))
            .catch(() => alive && setDetail({ comments: [], attachments: [], messages: [] }));
        return () => {
            alive = false;
        };
    }, [order?.id]); // eslint-disable-line

    const changed = FIELDS.filter((f) => String(form[f] ?? '') !== String(initial[f] ?? ''));
    const dirty = isNew || changed.length > 0;

    const products = catalog?.products?.map((p) => p.name) || [];
    const caseProduct = catalog?.products?.find((p) => p.is_case)?.name;
    const sized = catalog?.products?.filter((p) => p.has_size).map((p) => p.name) || [];
    const caseOnly = Boolean(caseProduct) && form.product === caseProduct;
    const showSize = !form.product || sized.includes(form.product) || !catalog;

    const save = async () => {
        if (!form.customer_name.trim()) {
            toast('Preencha o nome do cliente.', 'error');
            firstInput.current?.focus();
            return;
        }
        setSaving(true);
        try {
            const payload = {};
            for (const f of isNew ? FIELDS : changed) payload[f] = form[f] === '' ? null : form[f];
            payload.case_only = caseOnly ? 1 : 0;
            if (caseOnly) payload.product_type = null; // estojo avulso não tem produção de placa
            if (!showSize) payload.size = null;
            const saved = isNew
                ? await api('/api/orders', { method: 'POST', body: payload })
                : await api(`/api/orders/${order.id}`, { method: 'PUT', body: payload });
            toast(isNew ? `✓ Pedido ${saved.order_number} criado` : '✓ Alterações salvas', 'ok');
            onSaved(saved, isNew);
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    // Ctrl/⌘ + Enter salva de qualquer campo.
    const onKeyDown = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && dirty && !saving) {
            e.preventDefault();
            save();
        }
    };

    const archive = async () => {
        try {
            const o = await api(`/api/orders/${current.id}/archive`, {
                method: 'PATCH',
                body: { archived: !current.archived }
            });
            setCurrent(o);
            toast(o.archived ? 'Pedido arquivado' : 'Pedido restaurado', 'ok');
            onChanged(o);
        } catch (err) {
            toast(err.message, 'error');
        }
    };

    const pasteSummary = async () => {
        const r = await insertIntoComposer(orderSummary({ ...current, ...form }));
        toast(r === 'inserted' ? 'Resumo no campo de mensagem — revise e aperte Enter' : 'Resumo copiado — cole na conversa');
    };

    const copyCode = () => {
        navigator.clipboard?.writeText(current.pickup_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <>
            <div className="clp-body" onKeyDown={onKeyDown}>
                <div className="clp-row between">
                    <button className="clp-link" onClick={onBack}>
                        <ArrowLeft size={14} /> {isNew ? 'Voltar' : 'Todos os pedidos'}
                    </button>
                    {!isNew && (
                        <div className="clp-row" style={{ gap: 2 }}>
                            <button className="clp-icon" title="Colar resumo do pedido na conversa" onClick={pasteSummary}>
                                <ClipboardPaste size={16} />
                            </button>
                            <button
                                className="clp-icon"
                                title={current.archived ? 'Restaurar pedido' : 'Arquivar pedido'}
                                onClick={archive}
                            >
                                {current.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                            </button>
                        </div>
                    )}
                </div>

                {!isNew && (
                    <div className="clp-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className="clp-row between">
                            <div className="clp-row">
                                <span style={{ fontSize: 17, fontWeight: 750 }}>Pedido {current.order_number}</span>
                                {current.archived ? <span className="clp-pill">Arquivado</span> : null}
                            </div>
                            {current.pickup_code && (
                                <button className="clp-code" onClick={copyCode} title="Código de retirada — clique para copiar">
                                    {current.pickup_code}
                                    {copied ? <Check size={13} /> : <Copy size={13} />}
                                </button>
                            )}
                        </div>
                        <StatusSteps
                            order={current}
                            onMoved={(o) => {
                                setCurrent(o);
                                onChanged(o);
                                api(`/api/orders/${o.id}`).then(setDetail).catch(() => {});
                            }}
                        />
                        <div className="clp-muted">
                            Criado {relTime(current.created_at)}
                            {current.created_by ? ` por ${current.created_by}` : ''}
                            {current.updated_by && current.updated_at !== current.created_at
                                ? ` · alterado ${relTime(current.updated_at)} por ${current.updated_by}`
                                : ''}
                        </div>
                    </div>
                )}

                <div className="clp-card">
                    {isNew && (
                        <div style={{ fontSize: 16, fontWeight: 750, marginBottom: 12 }}>Novo pedido</div>
                    )}
                    <div className="clp-grid">
                        <Field label="Cliente">
                            <input
                                ref={firstInput}
                                className="clp-input"
                                value={form.customer_name}
                                onChange={(e) => set('customer_name', e.target.value)}
                                placeholder="Nome do cliente"
                            />
                        </Field>
                        <Field label="WhatsApp">
                            <input
                                className="clp-input"
                                value={form.phone}
                                onChange={(e) => set('phone', e.target.value)}
                                placeholder="51999999999"
                                inputMode="tel"
                            />
                        </Field>

                        <Field label="Produto" span>
                            <Chips options={products} value={form.product} onChange={(v) => set('product', v)} />
                            {!catalog && <span className="clp-muted">Carregando catálogo…</span>}
                        </Field>

                        {showSize && (
                            <Field label="Tamanho" hint={caseOnly ? '(placa que cabe)' : 'da placa, em cm'} span>
                                <Chips
                                    options={catalog?.plate_sizes || []}
                                    value={form.size}
                                    onChange={(v) => set('size', v)}
                                />
                            </Field>
                        )}

                        <Field label={caseOnly ? 'Cor do estojo' : 'Estojo'} span={caseOnly}>
                            <Chips
                                options={catalog?.case_colors || []}
                                value={form.case_color}
                                onChange={(v) => set('case_color', v)}
                                dots={CASE_DOT}
                            />
                        </Field>
                        {!caseOnly && (
                            <Field label="Produção">
                                <Chips
                                    options={catalog?.product_types || []}
                                    value={form.product_type}
                                    onChange={(v) => set('product_type', v)}
                                />
                            </Field>
                        )}

                        <Field label="Valor" hint={form.value && formatBRL(form.value) !== form.value ? formatBRL(form.value) : ''}>
                            <input
                                className="clp-input"
                                value={form.value}
                                onChange={(e) => set('value', e.target.value)}
                                placeholder="R$ 0,00"
                                inputMode="decimal"
                            />
                        </Field>
                        <Field label="Pagamento">
                            <div className="clp-chips">
                                {PAYMENTS.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        className={'clp-chip' + (form.payment_status === p.id ? ' on' : '')}
                                        onClick={() => set('payment_status', p.id)}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </Field>

                        <Field label="Entrega">
                            <input
                                type="date"
                                className="clp-input"
                                value={form.due_date || ''}
                                onChange={(e) => set('due_date', e.target.value)}
                            />
                        </Field>
                        <Field label="Retirada" hint="a partir das">
                            <input
                                type="time"
                                className="clp-input"
                                value={form.pickup_time || ''}
                                onChange={(e) => set('pickup_time', e.target.value)}
                            />
                        </Field>

                        <Field label="Descrição" span>
                            <textarea
                                className="clp-input"
                                rows={4}
                                value={form.description || ''}
                                onChange={(e) => set('description', e.target.value)}
                                placeholder="Texto da placa, detalhes, observações…"
                            />
                        </Field>
                    </div>
                </div>

                {!isNew && <Files detail={detail} />}
                {!isNew && (
                    <Comments
                        order={current}
                        detail={detail}
                        onAdded={(c) => setDetail((d) => ({ ...d, comments: [...(d?.comments || []), c] }))}
                    />
                )}
            </div>

            {(isNew || dirty) && (
                <div className="clp-foot">
                    {!isNew && (
                        <button className="clp-btn ghost" onClick={() => setForm(initial)} disabled={saving}>
                            Desfazer
                        </button>
                    )}
                    <button className="clp-btn primary block" onClick={save} disabled={saving}>
                        {saving ? <LoaderCircle size={16} className="clp-spin" /> : isNew ? <Send size={16} /> : <Check size={16} />}
                        {saving ? 'Salvando…' : isNew ? 'Criar pedido' : `Salvar alterações`}
                    </button>
                </div>
            )}
            {!isNew && !dirty && (
                <div className="clp-foot" style={{ justifyContent: 'center' }}>
                    <span className="clp-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <MessageSquareText size={14} /> Edite qualquer campo — o botão de salvar aparece aqui
                    </span>
                </div>
            )}
        </>
    );
}
