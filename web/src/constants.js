export const COLUMNS = [
  { id: 'novo', title: 'Novo Pedido', color: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700' },
  { id: 'producao', title: 'Em Produção', color: 'bg-sun-400', badge: 'bg-sun-100 text-yellow-700' },
  { id: 'pronto', title: 'Pronto', color: 'bg-brand-500', badge: 'bg-brand-100 text-brand-700', whatsapp: true },
  { id: 'entregue', title: 'Enviado / Entregue', color: 'bg-slate-400', badge: 'bg-slate-200 text-slate-600', whatsapp: true }
];

export const PRODUCT_TYPES = ['Maquina', 'Jota', 'Sublimação'];
export const CASE_COLORS = ['Preto', 'Azul', 'Vermelho'];

export const PAYMENT_STATUSES = [
  { id: 'pendente', label: 'Pendente' },
  { id: 'sinal', label: 'Sinal' },
  { id: 'pago', label: 'Pago' }
];

export const CASE_COLOR_DOT = {
  Preto: 'bg-slate-900',
  Azul: 'bg-blue-500',
  Vermelho: 'bg-red-500'
};

export function parseBRL(value) {
  const n = parseFloat(String(value ?? '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function formatBRL(value) {
  const n = parseFloat(String(value ?? '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : value || '';
}

export function formatDateBR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOverdue(iso) {
  if (!iso) return false;
  return iso < todayISO();
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// "2026-08-05" -> { weekday: 'Terça', dayMonth: '05/08', rel: 'Hoje' | 'Amanhã' | null }
export function describeDay(iso) {
  if (!iso) return { weekday: '', dayMonth: '', rel: null };
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = todayISO();
  const [ty, tm, td] = today.split('-').map(Number);
  const diff = Math.round((date - new Date(ty, tm - 1, td)) / 86400000);
  const rel = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : diff === -1 ? 'Ontem' : null;
  return { weekday: WEEKDAYS[date.getDay()], dayMonth: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`, rel };
}

// Soma dias a uma data ISO local.
export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// "14:00" -> "14h" ; "14:30" -> "14h30"
export function formatPickupTime(t) {
  if (!t) return '';
  const [h, mm] = String(t).split(':');
  if (!h) return t;
  return mm && mm !== '00' ? `${Number(h)}h${mm}` : `${Number(h)}h`;
}
