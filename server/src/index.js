import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, STATUSES, getSettings, setSettings } from './db.js';
import { notifyStatus, sendText, fetchInstances, normalizePhone, formatOrderNumber } from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) {
  console.error('ERRO: defina API_TOKEN no arquivo .env (é a senha de acesso ao sistema).');
  process.exit(1);
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'classul' }));

app.use('/api', (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido ou ausente.' });
  }
  next();
});

const getOrderStmt = db.prepare('SELECT * FROM orders WHERE id = ?');
const ORDER_FIELDS = ['customer_name', 'phone', 'description', 'product_type', 'case_color', 'value', 'due_date'];

function serializeOrder(order) {
  return { ...order, order_number: formatOrderNumber(order.id) };
}

// ---------- Pedidos ----------

app.get('/api/orders', (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  const rows = db
    .prepare('SELECT * FROM orders WHERE archived = ? ORDER BY created_at ASC, id ASC')
    .all(archived);
  res.json(rows.map(serializeOrder));
});

app.get('/api/orders/:id', (req, res) => {
  const order = getOrderStmt.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const messages = db
    .prepare('SELECT * FROM message_log WHERE order_id = ? ORDER BY created_at DESC')
    .all(order.id);
  res.json({ ...serializeOrder(order), messages });
});

app.post('/api/orders', (req, res) => {
  const data = req.body || {};
  if (!data.customer_name || !String(data.customer_name).trim()) {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }
  const status = STATUSES.includes(data.status) ? data.status : 'novo';
  const info = db
    .prepare(
      `INSERT INTO orders (customer_name, phone, description, product_type, case_color, value, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(data.customer_name).trim(),
      normalizePhone(data.phone) || (data.phone ? String(data.phone) : null),
      data.description || null,
      data.product_type || null,
      data.case_color || null,
      data.value || null,
      data.due_date || null,
      status
    );
  const order = getOrderStmt.get(info.lastInsertRowid);
  res.status(201).json(serializeOrder(order));
});

app.put('/api/orders/:id', (req, res) => {
  const order = getOrderStmt.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const data = req.body || {};
  const updates = {};
  for (const field of ORDER_FIELDS) {
    if (field in data) updates[field] = data[field] === '' ? null : data[field];
  }
  if ('phone' in updates && updates.phone) {
    updates.phone = normalizePhone(updates.phone) || String(updates.phone);
  }
  if (Object.keys(updates).length) {
    const sets = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
    db.prepare(`UPDATE orders SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
      ...Object.values(updates),
      order.id
    );
  }
  res.json(serializeOrder(getOrderStmt.get(order.id)));
});

// Mover no Kanban — dispara mensagem automática nas etapas configuradas.
app.patch('/api/orders/:id/status', async (req, res) => {
  const order = getOrderStmt.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Etapa inválida. Use: ${STATUSES.join(', ')}` });
  }
  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, order.id);
  const updated = getOrderStmt.get(order.id);
  const notification = await notifyStatus(updated, status);
  res.json({ order: serializeOrder(updated), notification });
});

// Reenviar manualmente a mensagem de uma etapa.
app.post('/api/orders/:id/notify', async (req, res) => {
  const order = getOrderStmt.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const status = req.body?.status || order.status;
  const notification = await notifyStatus(order, status, { force: true });
  res.json({ order: serializeOrder(order), notification });
});

app.patch('/api/orders/:id/archive', (req, res) => {
  const order = getOrderStmt.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const archived = req.body?.archived ? 1 : 0;
  db.prepare("UPDATE orders SET archived = ?, updated_at = datetime('now') WHERE id = ?").run(archived, order.id);
  res.json(serializeOrder(getOrderStmt.get(order.id)));
});

app.delete('/api/orders/:id', (req, res) => {
  const order = getOrderStmt.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  db.prepare('DELETE FROM message_log WHERE order_id = ?').run(order.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  res.json({ ok: true });
});

// ---------- Configurações ----------

app.get('/api/settings', (req, res) => res.json(getSettings()));

app.put('/api/settings', (req, res) => {
  res.json(setSettings(req.body || {}));
});

// ---------- Evolution API (utilitários) ----------

app.get('/api/evolution/instances', async (req, res) => {
  try {
    res.json(await fetchInstances());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/evolution/test', async (req, res) => {
  const phone = normalizePhone(req.body?.number);
  if (!phone) return res.status(400).json({ error: 'Informe um número de telefone válido.' });
  try {
    await sendText(phone, req.body?.text || '✅ Teste de conexão do sistema Classul. Tudo funcionando!');
    res.json({ ok: true, phone });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- Frontend (build do web/) ----------

const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Classul rodando na porta ${PORT}`);
});
