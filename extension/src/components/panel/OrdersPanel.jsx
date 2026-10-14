import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, RefreshCw, PanelRightClose, PanelRightOpen, PackageOpen, Search, UserRound, Users } from 'lucide-react';
import { contactOrders, getExtensionConfig } from '../../services/classul';
import { eventBus } from '../../utils/events';
import { isWhatsAppDark, readActiveContact, scrapeContactFromProfile } from '../../utils/dom';
import OrderEditor from './OrderEditor';
import {
    statusMeta, paymentMeta, dueInfo, formatBRL, formatPhone, initials, isActive, CASE_DOT
} from './format';

const WIDTH = 400;
const DOCK_KEY = 'classulPanelDocked';

// Reserva enquanto o catálogo do sistema não chega (primeira abertura offline).
const FALLBACK_CATALOG = {
    products: [
        'Placa de Homenagem', 'Plaqueta Militar (EB)', 'Placa de Inauguração', 'Placa Quadro Parede',
        'Placa para Jazigo', 'Placa Inox Escovado', 'Troféu', 'Medalhas', 'Pins e Botons', 'Estojo avulso', 'Outro'
    ].map((name) => ({
        name,
        is_case: name === 'Estojo avulso',
        has_size: /^Placa (de H|de I|Q|para|Inox)|Estojo/.test(name)
    })),
    case_colors: ['Preto', 'Azul', 'Vermelho'],
    plate_sizes: ['9x14', '12x17', '14x20', '16x25', '20x30'],
    product_types: ['Maquina', 'Jota', 'Sublimação']
};

const canDock = () => window.innerWidth >= 1100;
const readDock = () => {
    try {
        return localStorage.getItem(DOCK_KEY) !== '0';
    } catch {
        return true;
    }
};

function OrderRow({ order, onOpen }) {
    const st = statusMeta(order.status);
    const due = dueInfo(order.due_date, order.status);
    const pay = paymentMeta(order.payment_status);
    const item = [order.product, order.size && `${order.size}`].filter(Boolean).join(' · ');
    return (
        <button className={'clp-order' + (isActive(order) ? '' : ' dim')} onClick={() => onOpen(order)}>
            <div className="clp-row between">
                <div className="clp-row">
                    <span className="clp-num">{order.order_number}</span>
                    <span className="clp-pill" style={{ color: st.color, background: st.color + '1f' }}>
                        <i style={{ background: st.color }} />
                        {order.archived ? 'Arquivado' : st.long}
                    </span>
                </div>
                {order.value && <span className="clp-value">{formatBRL(order.value)}</span>}
            </div>
            <div className="clp-title">{item || order.customer_name}</div>
            {order.description && <div className="clp-desc">{order.description}</div>}
            <div className="clp-meta">
                {due && <span className={'clp-pill' + (due.tone ? ' tone-' + due.tone : '')}>{due.text}</span>}
                <span className={'clp-pill tone-' + pay.tone}>{pay.label}</span>
                {order.case_color && (
                    <span className="clp-pill">
                        <i style={{ background: CASE_DOT[order.case_color] || '#999' }} />
                        Estojo {order.case_color.toLowerCase()}
                    </span>
                )}
                {order.attachments_count > 0 && <span className="clp-pill">📎 {order.attachments_count}</span>}
                {order.matched_by === 'name' && (
                    <span className="clp-pill" title="Achado pelo nome da conversa, não pelo telefone">pelo nome</span>
                )}
            </div>
        </button>
    );
}

export default function OrdersPanel({ start, onClose }) {
    const [contact, setContact] = useState(() => start?.contact || readActiveContact());
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [view, setView] = useState(start?.mode === 'new' ? { mode: 'new' } : { mode: 'list' });
    const [filter, setFilter] = useState('ativos');
    const [catalog, setCatalog] = useState(null);
    const [dark, setDark] = useState(isWhatsAppDark);
    const [docked, setDocked] = useState(() => readDock() && canDock());
    const [query, setQuery] = useState('');
    const reqId = useRef(0);
    const viewRef = useRef(view);
    const contactRef = useRef(contact);
    useEffect(() => {
        contactRef.current = contact;
    }, [contact]);
    useEffect(() => {
        viewRef.current = view;
    }, [view]);

    const load = useCallback(async (c = contact, { quiet } = {}) => {
        if (!c || c.group || (!c.phone && !c.name)) {
            setData({ client: null, orders: [] });
            return;
        }
        const id = ++reqId.current;
        if (!quiet) setLoading(true);
        setError('');
        try {
            const d = await contactOrders({ phone: c.phone, name: c.name });
            if (id === reqId.current) setData(d);
        } catch (err) {
            if (id === reqId.current) setError(err.message);
        } finally {
            if (id === reqId.current) setLoading(false);
        }
    }, [contact]);

    // Catálogo: cópia local na hora, versão fresca logo em seguida.
    useEffect(() => {
        let alive = true;
        getExtensionConfig()
            .then((cfg) => alive && cfg?.catalog?.products?.length && setCatalog(cfg.catalog))
            .catch(() => {})
            .finally(() =>
                getExtensionConfig({ refresh: true })
                    .then((cfg) => alive && cfg?.catalog?.products?.length && setCatalog(cfg.catalog))
                    .catch(() => {})
            );
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        load(contact);
    }, [contact?.name, contact?.phone]); // eslint-disable-line

    // Segue a conversa aberta. No meio de uma edição, o formulário fica onde está.
    useEffect(() => {
        const onChat = (c) => {
            setDark(isWhatsAppDark());
            if (viewRef.current.mode !== 'list') return;
            const cur = contactRef.current;
            // mesma conversa (ex.: o telefone acabou de ser descoberto): nada a recarregar
            if (cur && c && cur.name === c.name && (cur.phone || null) === (c.phone || null)) return;
            setContact(c);
            setData(null);
            setQuery('');
        };
        const onOpen = (s) => {
            if (s?.contact) setContact(s.contact);
            setView(s?.mode === 'new' ? { mode: 'new' } : { mode: 'list' });
        };
        eventBus.on('CHAT_CHANGED', onChat);
        eventBus.on('SHOW_ORDERS_PANEL', onOpen);
        return () => {
            eventBus.off('CHAT_CHANGED', onChat);
            eventBus.off('SHOW_ORDERS_PANEL', onOpen);
        };
    }, []);

    // Sem telefone (contato salvo/id oculto): abre o perfil do contato por um
    // instante, lê o número e fecha — igual ao botão antigo, mas automático.
    // Contato não salvo também ganha o nome do perfil para o pedido.
    const [resolving, setResolving] = useState(false);
    useEffect(() => {
        if (!contact || contact.group || contact.profileChecked || (contact.phone && !contact.nameIsNumber)) return;
        let alive = true;
        const chatName = contact.name;
        setResolving(true);
        scrapeContactFromProfile()
            .then((info) => {
                if (!alive || readActiveContact()?.name !== chatName) return;
                setContact((c) => ({
                    ...c,
                    name: c.nameIsNumber && info.name ? info.name : c.name,
                    phone: c.phone || info.phone,
                    nameIsNumber: c.nameIsNumber && !info.name,
                    profileChecked: true
                }));
                if (info.phone) eventBus.emit('ORDERS_CHANGED');
            })
            .catch(() => {})
            .finally(() => alive && setResolving(false));
        return () => {
            alive = false;
        };
    }, [contact?.name, contact?.group]); // eslint-disable-line

    // Outro computador já cadastrou o cliente: o sistema devolve o telefone dele.
    useEffect(() => {
        const p = data?.client?.phone;
        if (p && contact && !contact.phone && !contact.group) setContact((c) => ({ ...c, phone: p }));
    }, [data?.client?.phone]); // eslint-disable-line

    // Encaixe: encolhe o WhatsApp para o painel ficar ao lado, sem cobrir a conversa.
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
            if (e.key === 'Escape' && !e.defaultPrevented && !typing && e.target?.closest?.('.clp')) {
                if (viewRef.current.mode !== 'list') setView({ mode: 'list' });
                else onClose();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const toggleDock = () => {
        const next = !docked;
        setDocked(next);
        try {
            localStorage.setItem(DOCK_KEY, next ? '1' : '0');
        } catch {
            /* sem armazenamento: vale só nesta sessão */
        }
    };

    const ordersChanged = () => {
        eventBus.emit('ORDERS_CHANGED', contact);
        load(contact, { quiet: true });
    };

    const orders = data?.orders || [];
    const active = orders.filter(isActive);
    const shown = (filter === 'ativos' ? active : orders).filter((o) => {
        if (!query) return true;
        const hay = [o.order_number, o.product, o.description, o.customer_name, o.pickup_code].join(' ').toLowerCase();
        return hay.includes(query.toLowerCase());
    });
    const client = data?.client;
    const title = client?.name || contact?.name || 'Pedidos';
    const subtitle = contact?.group
        ? 'Conversa em grupo'
        : [resolving && !contact?.phone ? 'Buscando o telefone…' : formatPhone(contact?.phone || client?.phone), orders.length ? `${orders.length} pedido${orders.length > 1 ? 's' : ''}` : '']
              .filter(Boolean)
              .join(' · ') || 'Telefone não encontrado no perfil';
    const editing = view.mode === 'edit' ? orders.find((o) => o.id === view.id) || view.order : null;

    let body;
    if (!contact) {
        body = (
            <div className="clp-empty">
                <div className="clp-empty-ico"><UserRound size={26} /></div>
                <b>Abra uma conversa</b>
                <span>Os pedidos do contato aparecem aqui.</span>
            </div>
        );
    } else if (contact.group) {
        body = (
            <div className="clp-empty">
                <div className="clp-empty-ico"><Users size={26} /></div>
                <b>Conversa em grupo</b>
                <span>Abra a conversa individual do cliente para ver os pedidos.</span>
            </div>
        );
    } else if (error) {
        body = (
            <div className="clp-alert error">
                <span style={{ flex: 1 }}>{error}</span>
                <button className="clp-link" onClick={() => load()}>Tentar de novo</button>
            </div>
        );
    } else if (!data) {
        body = (
            <>
                <div className="clp-skel" />
                <div className="clp-skel" style={{ opacity: 0.6 }} />
            </>
        );
    } else if (!orders.length) {
        body = (
            <div className="clp-empty">
                <div className="clp-empty-ico"><PackageOpen size={26} /></div>
                <b>Nenhum pedido deste contato</b>
                <span>
                    {contact.phone
                        ? 'Crie o primeiro pedido sem sair do WhatsApp.'
                        : 'Não achei o telefone desta conversa — busquei pelo nome. Crie o pedido e ele passa a ser encontrado.'}
                </span>
                <button className="clp-btn primary" onClick={() => setView({ mode: 'new' })}>
                    <Plus size={16} /> Criar pedido
                </button>
            </div>
        );
    } else {
        body = (
            <>
                <div className="clp-tabs">
                    <button className={'clp-tab' + (filter === 'ativos' ? ' on' : '')} onClick={() => setFilter('ativos')}>
                        Em aberto · {active.length}
                    </button>
                    <button className={'clp-tab' + (filter === 'todos' ? ' on' : '')} onClick={() => setFilter('todos')}>
                        Todos · {orders.length}
                    </button>
                </div>
                {orders.length > 4 && (
                    <div className="clp-search">
                        <Search size={15} />
                        <input
                            className="clp-input"
                            placeholder="Buscar nº, produto, código…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                )}
                {shown.map((o) => (
                    <OrderRow key={o.id} order={o} onOpen={(ord) => setView({ mode: 'edit', id: ord.id, order: ord })} />
                ))}
                {!shown.length && (
                    <div className="clp-empty" style={{ padding: 18 }}>
                        <span>
                            {query ? 'Nada encontrado.' : 'Nenhum pedido em aberto.'}{' '}
                            {filter === 'ativos' && !query && (
                                <button className="clp-link" onClick={() => setFilter('todos')}>Ver todos</button>
                            )}
                        </span>
                    </div>
                )}
            </>
        );
    }

    return createPortal(
        <div
            className={'clp' + (dark ? ' dark' : '') + (docked && canDock() ? ' docked' : '')}
            style={{ '--clp-w': WIDTH + 'px' }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="clp-head">
                {contact?.avatar ? (
                    <img className="clp-avatar" src={contact.avatar} alt="" />
                ) : (
                    <div className="clp-avatar">{initials(title)}</div>
                )}
                <div className="clp-who">
                    <b title={title}>{title}</b>
                    <span>{subtitle}</span>
                </div>
                {view.mode === 'list' && (
                    <button className="clp-icon" title="Atualizar" onClick={() => load()} disabled={loading}>
                        <RefreshCw size={16} className={loading ? 'clp-spin' : ''} />
                    </button>
                )}
                {canDock() && (
                    <button
                        className="clp-icon"
                        title={docked ? 'Soltar (flutuar sobre a conversa)' : 'Encaixar ao lado da conversa'}
                        onClick={toggleDock}
                    >
                        {docked ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
                    </button>
                )}
                <button className="clp-icon" title="Fechar (Esc)" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>

            {view.mode === 'list' ? (
                <>
                    <div className="clp-body">{body}</div>
                    {contact && !contact.group && orders.length > 0 && (
                        <div className="clp-foot">
                            <button className="clp-btn primary block" onClick={() => setView({ mode: 'new' })}>
                                <Plus size={16} /> Novo pedido
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <OrderEditor
                    key={view.mode === 'new' ? 'new' : view.id}
                    order={view.mode === 'new' ? null : editing}
                    contact={{ ...contact, name: contact?.nameIsNumber ? '' : contact?.name || '' }}
                    catalog={catalog || FALLBACK_CATALOG}
                    onBack={() => setView({ mode: 'list' })}
                    onSaved={(o, created) => {
                        ordersChanged();
                        setView(created ? { mode: 'list' } : { mode: 'edit', id: o.id, order: o });
                        if (!created) setData((d) => d && { ...d, orders: d.orders.map((x) => (x.id === o.id ? { ...x, ...o } : x)) });
                    }}
                    onChanged={(o) => {
                        setData((d) => d && { ...d, orders: d.orders.map((x) => (x.id === o.id ? { ...x, ...o } : x)) });
                        ordersChanged();
                    }}
                />
            )}
        </div>,
        document.body
    );
}
