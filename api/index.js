import express from 'express';
import cors from 'cors';
import { q, STATUSES, getSettings, setSettings, ensureSchema } from '../lib/db.js';
import {
  notifyStatus,
  sendText,
  fetchInstances,
  normalizePhone,
  formatOrderNumber
} from '../lib/whatsapp.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'classul' }));

app.use('/api', async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!process.env.API_TOKEN) {
    return res.status(500).json({ error: 'API_TOKEN não configurado nas variáveis de ambiente do projeto.' });
  }
  if (token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido ou ausente.' });
  }
  try {
    await ensureSchema();
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const ORDER_FIELDS = ['customer_name', 'phone', 'description', 'product_type', 'case_color', 'value', 'due_date'];

function serializeOrder(order) {
  return { ...order, order_number: formatOrderNumber(order.id) };
}

async function getOrder(id) {
  const { rows } = await q('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] || null;
}

// Handler async com tratamento de erro centralizado.
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

// ---------- Pedidos ----------

app.get('/api/orders', h(async (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  const { rows } = await q('SELECT * FROM orders WHERE archived = $1 ORDER BY created_at ASC, id ASC', [archived]);
  res.json(rows.map(serializeOrder));
}));

app.get('/api/orders/:id', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const { rows: messages } = await q(
    'SELECT * FROM message_log WHERE order_id = $1 ORDER BY created_at DESC, id DESC',
    [order.id]
  );
  res.json({ ...serializeOrder(order), messages });
}));

app.post('/api/orders', h(async (req, res) => {
  const data = req.body || {};
  if (!data.customer_name || !String(data.customer_name).trim()) {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }
  const status = STATUSES.includes(data.status) ? data.status : 'novo';
  const { rows } = await q(
    `INSERT INTO orders (customer_name, phone, description, product_type, case_color, value, due_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      String(data.customer_name).trim(),
      normalizePhone(data.phone) || (data.phone ? String(data.phone) : null),
      data.description || null,
      data.product_type || null,
      data.case_color || null,
      data.value || null,
      data.due_date || null,
      status
    ]
  );
  res.status(201).json(serializeOrder(rows[0]));
}));

app.put('/api/orders/:id', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const data = req.body || {};
  const updates = {};
  for (const field of ORDER_FIELDS) {
    if (field in data) updates[field] = data[field] === '' ? null : data[field];
  }
  if ('phone' in updates && updates.phone) {
    updates.phone = normalizePhone(updates.phone) || String(updates.phone);
  }
  const fields = Object.keys(updates);
  if (fields.length) {
    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await q(`UPDATE orders SET ${sets}, updated_at = now() WHERE id = $${fields.length + 1}`, [
      ...Object.values(updates),
      order.id
    ]);
  }
  res.json(serializeOrder(await getOrder(order.id)));
}));

// Mover no Kanban — dispara mensagem automática nas etapas configuradas.
app.patch('/api/orders/:id/status', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Etapa inválida. Use: ${STATUSES.join(', ')}` });
  }
  await q('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [status, order.id]);
  const updated = await getOrder(order.id);
  const notification = await notifyStatus(updated, status);
  res.json({ order: serializeOrder(updated), notification });
}));

// Reenviar manualmente a mensagem de uma etapa.
app.post('/api/orders/:id/notify', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const status = req.body?.status || order.status;
  const notification = await notifyStatus(order, status, { force: true });
  res.json({ order: serializeOrder(order), notification });
}));

app.patch('/api/orders/:id/archive', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const archived = req.body?.archived ? 1 : 0;
  await q('UPDATE orders SET archived = $1, updated_at = now() WHERE id = $2', [archived, order.id]);
  res.json(serializeOrder(await getOrder(order.id)));
}));

app.delete('/api/orders/:id', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  await q('DELETE FROM message_log WHERE order_id = $1', [order.id]);
  await q('DELETE FROM orders WHERE id = $1', [order.id]);
  res.json({ ok: true });
}));

// ---------- Configurações ----------

app.get('/api/settings', h(async (req, res) => res.json(await getSettings())));

app.put('/api/settings', h(async (req, res) => res.json(await setSettings(req.body || {}))));

// ---------- Evolution API (utilitários) ----------

app.get('/api/evolution/instances', h(async (req, res) => {
  try {
    res.json(await fetchInstances());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

app.post('/api/evolution/test', h(async (req, res) => {
  const phone = normalizePhone(req.body?.number);
  if (!phone) return res.status(400).json({ error: 'Informe um número de telefone válido.' });
  try {
    await sendText(phone, req.body?.text || '✅ Teste de conexão do sistema Classul. Tudo funcionando!');
    res.json({ ok: true, phone });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

export default app;
