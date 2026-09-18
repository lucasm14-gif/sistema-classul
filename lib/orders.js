// Regras de pedido em um lugar só: o sistema (web), a extensão e o Hermes
// criam e movem pedidos exatamente do mesmo jeito.
import { q, STATUSES } from './db.js';
import { normalizePhone, formatOrderNumber, notifyStatus } from './whatsapp.js';
import { notifyHermes } from './hermes-events.js';

export const ORDER_FIELDS = [
  'customer_name',
  'phone',
  'description',
  'product_type',
  'case_color',
  'case_only',
  'case_size',
  'size',
  'product',
  'value',
  'due_date',
  'pickup_time',
  'payment_status'
];

export const PAYMENT_STATUSES = ['pendente', 'sinal', 'pago'];

export function serializeOrder(order) {
  return { ...order, order_number: formatOrderNumber(order.id) };
}

export async function getOrder(id) {
  const { rows } = await q('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getClient(id) {
  const { rows } = await q('SELECT * FROM clients WHERE id = $1', [id]);
  return rows[0] || null;
}

// Código de retirada: 4 dígitos aleatórios, único entre os pedidos ativos.
export async function generatePickupCode() {
  for (let i = 0; i < 25; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const { rows } = await q('SELECT 1 FROM orders WHERE pickup_code = $1 AND archived = 0 LIMIT 1', [code]);
    if (!rows.length) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Vincula o pedido a um cliente existente (por telefone, depois por nome)
// ou cria o cliente automaticamente.
export async function findOrCreateClient(name, phone) {
  const cleanName = String(name || '').trim();
  const normPhone = normalizePhone(phone);

  if (normPhone) {
    const { rows } = await q('SELECT * FROM clients WHERE phone = $1 ORDER BY id ASC LIMIT 1', [normPhone]);
    if (rows.length) return rows[0];
  }
  if (cleanName) {
    const { rows } = await q('SELECT * FROM clients WHERE LOWER(name) = LOWER($1) ORDER BY id ASC LIMIT 1', [cleanName]);
    if (rows.length) {
      // aproveita o pedido para completar o telefone do cliente
      if (normPhone && !rows[0].phone) {
        await q('UPDATE clients SET phone = $1, updated_at = now() WHERE id = $2', [normPhone, rows[0].id]);
        rows[0].phone = normPhone;
      }
      return rows[0];
    }
  }
  if (!cleanName) return null;
  const { rows } = await q('INSERT INTO clients (name, phone) VALUES ($1, $2) RETURNING *', [cleanName, normPhone]);
  return rows[0];
}

// Erro com status HTTP, para o chamador responder 400 em vez de 500.
export class OrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function createOrder(data = {}, user = null) {
  if (!data.customer_name || !String(data.customer_name).trim()) {
    throw new OrderError('O nome do cliente é obrigatório.');
  }
  const status = STATUSES.includes(data.status) ? data.status : 'novo';
  const paymentStatus = PAYMENT_STATUSES.includes(data.payment_status) ? data.payment_status : 'pendente';

  // Vincula/cria o cliente automaticamente (ou usa o client_id informado)
  let clientId = null;
  if (data.client_id) {
    const client = await getClient(data.client_id);
    if (client) clientId = client.id;
  }
  if (!clientId) {
    const client = await findOrCreateClient(data.customer_name, data.phone);
    if (client) clientId = client.id;
  }

  const pickupCode = await generatePickupCode();
  const { rows } = await q(
    `INSERT INTO orders (customer_name, phone, description, product_type, case_color, case_only, size, product, value, due_date, pickup_time, status, client_id, payment_status, pickup_code, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) RETURNING *`,
    [
      String(data.customer_name).trim(),
      normalizePhone(data.phone) || (data.phone ? String(data.phone) : null),
      data.description || null,
      data.product_type || null,
      data.case_color || null,
      data.case_only ? 1 : 0,
      data.size || data.case_size || null,
      data.product || null,
      data.value || null,
      data.due_date || null,
      data.pickup_time || null,
      status,
      clientId,
      paymentStatus,
      pickupCode,
      user
    ]
  );
  const order = serializeOrder(rows[0]);
  await notifyHermes('pedido.criado', { pedido: order, por: user || 'sistema' });
  return order;
}

export async function updateOrderFields(order, data = {}, user = null) {
  const updates = {};
  for (const field of ORDER_FIELDS) {
    if (field in data) updates[field] = data[field] === '' ? null : data[field];
  }
  if ('phone' in updates && updates.phone) {
    updates.phone = normalizePhone(updates.phone) || String(updates.phone);
  }
  if ('payment_status' in updates && !PAYMENT_STATUSES.includes(updates.payment_status)) {
    throw new OrderError(`Status de pagamento inválido. Use: ${PAYMENT_STATUSES.join(', ')}`);
  }
  // A coluna é INTEGER; o front manda booleano.
  if ('case_only' in updates) updates.case_only = updates.case_only ? 1 : 0;
  updates.updated_by = user;
  const fields = Object.keys(updates);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  await q(`UPDATE orders SET ${sets}, updated_at = now() WHERE id = $${fields.length + 1}`, [
    ...Object.values(updates),
    order.id
  ]);
  const updated = serializeOrder(await getOrder(order.id));
  await notifyHermes('pedido.atualizado', { pedido: updated, por: user || 'sistema' });
  return updated;
}

// Mover no Kanban — dispara a mensagem automática das etapas configuradas.
export async function moveOrderStatus(order, status, user = null) {
  if (!STATUSES.includes(status)) {
    throw new OrderError(`Etapa inválida. Use: ${STATUSES.join(', ')}`);
  }
  // registra a data de entrega (base do faturamento)
  if (status === 'entregue') {
    await q(
      'UPDATE orders SET status = $1, delivered_at = COALESCE(delivered_at, now()), updated_at = now(), updated_by = $3 WHERE id = $2',
      [status, order.id, user]
    );
  } else {
    await q('UPDATE orders SET status = $1, delivered_at = NULL, updated_at = now(), updated_by = $3 WHERE id = $2', [
      status,
      order.id,
      user
    ]);
  }
  const updated = await getOrder(order.id);
  const notification = await notifyStatus(updated, status);
  const { rows: invoiceRows } = await q(
    "SELECT 1 FROM attachments WHERE order_id = $1 AND category = 'nota_fiscal' LIMIT 1",
    [order.id]
  );
  const result = {
    order: { ...serializeOrder(updated), has_invoice: invoiceRows.length > 0 },
    notification
  };
  await notifyHermes('pedido.status', {
    pedido: result.order,
    de: order.status,
    para: status,
    por: user || 'sistema',
    aviso_enviado: Boolean(notification?.sent)
  });
  return result;
}

// ---------- Valores e datas (usados pelo faturamento) ----------

export function parseValueBRL(v) {
  const n = parseFloat(
    String(v ?? '')
      .replace(/[^\d.,]/g, '')
      .replace(/\.(?=\d{3})/g, '')
      .replace(',', '.')
  );
  return Number.isFinite(n) ? n : 0;
}

// Mês local de São Paulo no formato YYYY-MM.
export function monthKeySP(date) {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

export function dayKeySP(date) {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}
