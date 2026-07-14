export const COLUMNS = [
  { id: 'novo', title: 'Novo Pedido', color: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700' },
  { id: 'producao', title: 'Em Produção', color: 'bg-sun-400', badge: 'bg-sun-100 text-yellow-700' },
  { id: 'pronto', title: 'Pronto', color: 'bg-brand-500', badge: 'bg-brand-100 text-brand-700', whatsapp: true },
  { id: 'entregue', title: 'Enviado / Entregue', color: 'bg-slate-400', badge: 'bg-slate-200 text-slate-600', whatsapp: true }
];

export const PRODUCT_TYPES = ['Maquina', 'Jota', 'Sublimação'];
export const CASE_COLORS = ['Preto', 'Azul', 'Vermelho'];

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

export function isOverdue(iso) {
  if (!iso) return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  return iso < todayIso;
}
