// Etiqueta na lista de conversas: "este cliente tem pedido" + a entrega, quando
// está perto. Uma busca leve a cada minuto (pedidos em aberto) e a pintura
// reaproveita o laço de 1s do ChatObserver, mexendo no DOM só quando muda.
import { api } from '../services/classul';
import { cachedPhone } from '../utils/dom';

const STATUS_LABEL = { novo: 'Novo', producao: 'Produção', pronto: 'Pronto' };

let byKey = new Map();
let byName = new Map();
let contacts = {};
let lastFetch = 0;
let fetching = false;

export function phoneKey(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length < 10) return null;
    return d.slice(0, 2) + d.slice(-8);
}

const push = (map, k, o) => {
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(o);
};

export async function refreshOrderFlags(force = false) {
    if (fetching || (!force && Date.now() - lastFetch < 60000) || document.hidden) return;
    fetching = true;
    try {
        const d = await api('/api/order-flags');
        const k = new Map();
        const n = new Map();
        for (const o of d.orders || []) {
            push(k, o.phone_key, o);
            for (const name of o.names || []) push(n, name, o);
        }
        byKey = k;
        byName = n;
        contacts = d.contacts || {};
        lastFetch = Date.now();
    } catch {
        lastFetch = Date.now(); // sem configuração/offline: tenta de novo daqui a 1 min
    } finally {
        fetching = false;
    }
}

export const hasOrderFlags = () => byKey.size > 0 || byName.size > 0;

const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const daysUntil = (iso) =>
    Math.round((new Date(iso + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 86400000);
const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function ordersForChat(title) {
    const name = String(title || '').trim().toLowerCase();
    if (!name) return [];
    const digits = /^[+\d][\d\s()\-]{7,}$/.test(name) ? name : null;
    const key = phoneKey(digits) || contacts[name] || phoneKey(cachedPhone(name));
    const found = new Map();
    for (const o of byKey.get(key) || []) found.set(o.id, o);
    // pelo nome só quando o pedido não tem telefone ou o telefone bate
    for (const o of byName.get(name) || []) if (!o.phone_key || !key || o.phone_key === key) found.set(o.id, o);
    return [...found.values()];
}

// Decide o texto e a cor da etiqueta a partir dos pedidos do contato.
export function flagFor(title) {
    const orders = ordersForChat(title);
    if (!orders.length) return null;
    const dated = orders.filter((o) => o.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const next = dated[0];
    const extra = orders.length > 1 ? ` · ${orders.length}` : '';
    let text = 'Pedido';
    let tone = 'base';
    if (next) {
        const d = daysUntil(next.due_date);
        if (d < 0) [text, tone] = ['Atrasado', 'late'];
        else if (d === 0) [text, tone] = [`Hoje${next.pickup_time ? ' ' + next.pickup_time : ''}`, 'soon'];
        else if (d === 1) [text, tone] = ['Amanhã', 'soon'];
        else if (d <= 6) [text, tone] = [`${WD[new Date(next.due_date + 'T12:00:00').getDay()]} ${dm(next.due_date)}`, 'week'];
    }
    if (tone === 'base' && orders.some((o) => o.status === 'pronto')) [text, tone] = ['Pronto', 'ready'];
    const tip = orders
        .map(
            (o) =>
                `${o.order_number}${o.product ? ' · ' + o.product : ''} — ${STATUS_LABEL[o.status] || o.status}` +
                (o.due_date ? `, entrega ${dm(o.due_date)}${o.pickup_time ? ' ' + o.pickup_time : ''}` : '')
        )
        .join('\n');
    return { text: text + extra, tone, tip };
}

const BOX_SVG =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>';

// Coloca/atualiza/remove a etiqueta numa linha da lista.
export function paintOrderFlag(row, title, titleEl) {
    const flag = flagFor(title);
    const el = row.querySelector('.classul-order-badge');
    if (!flag) {
        el?.remove();
        return;
    }
    const sig = flag.tone + '|' + flag.text + '|' + flag.tip;
    if (el && el.dataset.sig === sig) return;
    const badge = el || document.createElement('span');
    badge.className = 'classul-order-badge tone-' + flag.tone;
    badge.dataset.sig = sig;
    badge.title = flag.tip;
    badge.innerHTML = BOX_SVG + '<b></b>';
    badge.querySelector('b').textContent = flag.text;
    if (!el && titleEl?.parentElement) titleEl.parentElement.appendChild(badge);
}
