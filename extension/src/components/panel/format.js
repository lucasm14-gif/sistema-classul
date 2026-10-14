// Rótulos, cores e formatações do painel de pedidos (espelham o sistema).

export const STATUSES = [
    { id: 'novo', label: 'Novo', long: 'Novo pedido', color: '#0ea5e9' },
    { id: 'producao', label: 'Produção', long: 'Em produção', color: '#e0a800' },
    { id: 'pronto', label: 'Pronto', long: 'Pronto', color: '#4fae32', notify: true },
    { id: 'entregue', label: 'Entregue', long: 'Enviado / Entregue', color: '#94a3b8', notify: true }
];

export const statusMeta = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];

export const PAYMENTS = [
    { id: 'pendente', label: 'Pendente', tone: 'danger' },
    { id: 'sinal', label: 'Sinal', tone: 'warn' },
    { id: 'pago', label: 'Pago', tone: 'ok' }
];

export const paymentMeta = (id) => PAYMENTS.find((p) => p.id === id) || PAYMENTS[0];

export const CASE_DOT = { Preto: '#111111', Azul: '#3b82f6', Vermelho: '#ef4444' };

export const ASSIGN_COLORS = ['#4a9c33', '#ee3b33', '#eabf00', '#2563eb', '#7c3aed', '#db2777', '#0891b2'];
export function colorFor(name) {
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % ASSIGN_COLORS.length;
    return ASSIGN_COLORS[h] || ASSIGN_COLORS[0];
}

export function parseBRL(value) {
    const n = parseFloat(
        String(value ?? '')
            .replace(/[^\d.,]/g, '')
            .replace(/\.(?=\d{3})/g, '')
            .replace(',', '.')
    );
    return Number.isFinite(n) ? n : null;
}

export function formatBRL(value) {
    const n = parseBRL(value);
    return n === null ? value || '' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function formatDateBR(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}${y !== String(new Date().getFullYear()) ? '/' + y.slice(2) : ''}`;
}

// Entrega relativa a hoje: "Atrasado", "Hoje", "Amanhã" ou "qua, 16/10".
export function dueInfo(iso, status) {
    if (!iso) return null;
    const days = Math.round((new Date(iso + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 86400000);
    const done = status === 'entregue';
    if (days < 0) return { text: `Entrega ${formatDateBR(iso)}`, tone: done ? '' : 'danger', late: !done };
    if (days === 0) return { text: 'Entrega hoje', tone: done ? '' : 'warn' };
    if (days === 1) return { text: 'Entrega amanhã', tone: done ? '' : 'warn' };
    const wd = WEEKDAYS[new Date(iso + 'T12:00:00').getDay()];
    return { text: `Entrega ${wd}, ${formatDateBR(iso)}`, tone: '' };
}

export function relTime(ts) {
    if (!ts) return '';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
    if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function formatPhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw || '';
}

export const isActive = (o) => !o.archived && o.status !== 'entregue';

// Texto curto do pedido para colar na conversa.
export function orderSummary(o) {
    const lines = [`*Pedido ${o.order_number}*`];
    const item = [o.product, o.size && `${o.size} cm`, o.case_color && `estojo ${o.case_color.toLowerCase()}`]
        .filter(Boolean)
        .join(' · ');
    if (item) lines.push(item);
    if (o.description) lines.push(o.description);
    if (o.value) lines.push(`Valor: ${formatBRL(o.value)}`);
    if (o.due_date) lines.push(`Entrega: ${formatDateBR(o.due_date)}${o.pickup_time ? ` a partir das ${o.pickup_time}` : ''}`);
    if (o.pickup_code) lines.push(`Código de retirada: *${o.pickup_code}*`);
    return lines.join('\n');
}
