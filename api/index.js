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
import {
  oauthState,
  buildAuthUrl,
  exchangeCode,
  createUploadSession,
  getFileMeta,
  deleteFile
} from '../lib/google.js';
import { handleIncoming } from '../lib/bot.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'classul' }));

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Callback do OAuth do Google — o navegador chega aqui redirecionado pelo Google,
// sem Bearer token; a validação é feita pelo parâmetro state.
app.get('/api/google/callback', async (req, res) => {
  const page = (title, body, ok) =>
    res.send(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head>` +
        `<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;background:#12290e;color:#fff;text-align:center">` +
        `<div><h1 style="color:${ok ? '#82c953' : '#ee3b33'}">${title}</h1><p>${body}</p></div>` +
        (ok ? `<script>setTimeout(()=>{location.href='/'} ,2500)</script>` : '') +
        `</body></html>`
    );
  try {
    await ensureSchema();
    const { code, state, error } = req.query;
    if (error) return page('Conexão cancelada', String(error), false);
    if (state !== oauthState()) return page('Estado inválido', 'Tente conectar novamente pelo sistema.', false);
    const tokens = await exchangeCode(String(code), `${baseUrl(req)}/api/google/callback`);
    if (tokens.refresh_token) {
      await setSettings({ google_refresh_token: tokens.refresh_token });
    } else {
      const current = await getSettings();
      if (!current.google_refresh_token) {
        return page(
          'Quase lá',
          'O Google não devolveu o token de acesso permanente. Remova o acesso do app em myaccount.google.com/permissions e clique em Conectar de novo.',
          false
        );
      }
    }
    page('Google Drive conectado! ✅', 'Voltando para o sistema…', true);
  } catch (err) {
    page('Erro na conexão', err.message, false);
  }
});

// Webhook do bot — chamado pela Evolution API (sem Bearer). Protegido por secret na query.
// Sempre responde 200 rápido para a Evolution não re-tentar; o processamento é aguardado
// mas erros internos não viram erro HTTP.
app.all('/api/bot/webhook', async (req, res) => {
  try {
    await ensureSchema();
    const settings = await getSettings();
    if (!settings.bot_webhook_secret || req.query.secret !== settings.bot_webhook_secret) {
      return res.status(200).json({ ignored: 'secret inválido' });
    }
    const event = (req.body?.event || '').toLowerCase().replace(/_/g, '.');
    if (req.method !== 'POST' || !event.includes('messages.upsert')) {
      return res.status(200).json({ ignored: 'evento ignorado', event });
    }
    const result = await handleIncoming(req.body);
    res.status(200).json(result);
  } catch (err) {
    console.error('bot webhook:', err);
    res.status(200).json({ error: err.message });
  }
});

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

const ORDER_FIELDS = [
  'customer_name',
  'phone',
  'description',
  'product_type',
  'case_color',
  'value',
  'due_date',
  'payment_status'
];
const PAYMENT_STATUSES = ['pendente', 'sinal', 'pago'];

function serializeOrder(order) {
  return { ...order, order_number: formatOrderNumber(order.id) };
}

async function getOrder(id) {
  const { rows } = await q('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getClient(id) {
  const { rows } = await q('SELECT * FROM clients WHERE id = $1', [id]);
  return rows[0] || null;
}

// Código de retirada: 4 dígitos aleatórios, único entre os pedidos ativos.
async function generatePickupCode() {
  for (let i = 0; i < 25; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const { rows } = await q('SELECT 1 FROM orders WHERE pickup_code = $1 AND archived = 0 LIMIT 1', [code]);
    if (!rows.length) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Vincula o pedido a um cliente existente (por telefone, depois por nome)
// ou cria o cliente automaticamente.
async function findOrCreateClient(name, phone) {
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
  const { rows: counts } = await q('SELECT order_id, category, COUNT(*) AS n FROM attachments GROUP BY order_id, category');
  const countMap = new Map();
  const invoiceSet = new Set();
  for (const r of counts) {
    countMap.set(r.order_id, (countMap.get(r.order_id) || 0) + Number(r.n));
    if (r.category === 'nota_fiscal') invoiceSet.add(r.order_id);
  }
  res.json(
    rows.map((r) => ({
      ...serializeOrder(r),
      attachments_count: countMap.get(r.id) || 0,
      has_invoice: invoiceSet.has(r.id)
    }))
  );
}));

app.get('/api/orders/:id', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const { rows: messages } = await q(
    'SELECT * FROM message_log WHERE order_id = $1 ORDER BY created_at DESC, id DESC',
    [order.id]
  );
  const { rows: attachments } = await q(
    'SELECT * FROM attachments WHERE order_id = $1 ORDER BY created_at DESC, id DESC',
    [order.id]
  );
  res.json({ ...serializeOrder(order), messages, attachments });
}));

app.post('/api/orders', h(async (req, res) => {
  const data = req.body || {};
  if (!data.customer_name || !String(data.customer_name).trim()) {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
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
    `INSERT INTO orders (customer_name, phone, description, product_type, case_color, value, due_date, status, client_id, payment_status, pickup_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      String(data.customer_name).trim(),
      normalizePhone(data.phone) || (data.phone ? String(data.phone) : null),
      data.description || null,
      data.product_type || null,
      data.case_color || null,
      data.value || null,
      data.due_date || null,
      status,
      clientId,
      paymentStatus,
      pickupCode
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
  if ('payment_status' in updates && !PAYMENT_STATUSES.includes(updates.payment_status)) {
    return res.status(400).json({ error: `Status de pagamento inválido. Use: ${PAYMENT_STATUSES.join(', ')}` });
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
  // registra a data de entrega (base do faturamento)
  if (status === 'entregue') {
    await q(
      'UPDATE orders SET status = $1, delivered_at = COALESCE(delivered_at, now()), updated_at = now() WHERE id = $2',
      [status, order.id]
    );
  } else {
    await q('UPDATE orders SET status = $1, delivered_at = NULL, updated_at = now() WHERE id = $2', [
      status,
      order.id
    ]);
  }
  const updated = await getOrder(order.id);
  const notification = await notifyStatus(updated, status);
  const { rows: invoiceRows } = await q(
    "SELECT 1 FROM attachments WHERE order_id = $1 AND category = 'nota_fiscal' LIMIT 1",
    [order.id]
  );
  res.json({ order: { ...serializeOrder(updated), has_invoice: invoiceRows.length > 0 }, notification });
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
  await q('DELETE FROM attachments WHERE order_id = $1', [order.id]);
  await q('DELETE FROM orders WHERE id = $1', [order.id]);
  res.json({ ok: true });
}));

// ---------- Google Drive / Anexos ----------

app.get('/api/google/status', h(async (req, res) => {
  const s = await getSettings();
  res.json({
    configured: Boolean(s.google_client_id && s.google_client_secret),
    connected: Boolean(s.google_refresh_token),
    folder_id: s.google_folder_id || null
  });
}));

app.get('/api/google/auth-url', h(async (req, res) => {
  const s = await getSettings();
  if (!s.google_client_id || !s.google_client_secret) {
    return res.status(400).json({ error: 'Preencha o Client ID e o Client Secret do Google e salve antes de conectar.' });
  }
  res.json({ url: buildAuthUrl(s.google_client_id, `${baseUrl(req)}/api/google/callback`) });
}));

// Inicia o upload: cria a pasta do pedido (se preciso) e devolve a URL
// para o navegador mandar o arquivo direto ao Google Drive.
app.post('/api/orders/:id/attachments/session', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const { name, mimeType, size, category } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Informe o nome do arquivo.' });
  // notas fiscais ganham prefixo no Drive para facilitar a organização
  const driveName = category === 'nota_fiscal' && !/^\[NF\]/i.test(name) ? `[NF] ${name}` : name;
  try {
    const uploadUrl = await createUploadSession(order, { name: driveName, mimeType, size }, req.headers.origin);
    res.json({ uploadUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// Registra o arquivo depois que o navegador terminou o upload.
app.post('/api/orders/:id/attachments', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const fileId = req.body?.file_id;
  if (!fileId) return res.status(400).json({ error: 'Informe o file_id do Drive.' });
  const category = req.body?.category === 'nota_fiscal' ? 'nota_fiscal' : 'arquivo';
  const meta = await getFileMeta(fileId);
  const { rows } = await q(
    `INSERT INTO attachments (order_id, drive_file_id, name, mime_type, size, web_view_link, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      order.id,
      meta.id,
      meta.name,
      meta.mimeType || null,
      meta.size ? Number(meta.size) : null,
      meta.webViewLink || null,
      category
    ]
  );
  res.status(201).json(rows[0]);
}));

app.delete('/api/attachments/:id', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM attachments WHERE id = $1', [req.params.id]);
  const attachment = rows[0];
  if (!attachment) return res.status(404).json({ error: 'Anexo não encontrado.' });
  try {
    await deleteFile(attachment.drive_file_id);
  } catch (err) {
    console.error('Falha ao excluir do Drive (removendo só o registro):', err.message);
  }
  await q('DELETE FROM attachments WHERE id = $1', [attachment.id]);
  res.json({ ok: true });
}));

// ---------- Clientes ----------

const CLIENT_FIELDS = ['name', 'phone', 'email', 'company', 'notes'];

app.get('/api/clients', h(async (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE LOWER(c.name) LIKE $1 OR c.phone LIKE $1 OR LOWER(COALESCE(c.company, '')) LIKE $1`;
  }
  const { rows } = await q(`SELECT c.* FROM clients c ${where} ORDER BY LOWER(c.name) ASC`, params);
  const { rows: counts } = await q(
    'SELECT client_id, COUNT(*) AS n FROM orders WHERE client_id IS NOT NULL GROUP BY client_id'
  );
  const countMap = new Map(counts.map((r) => [r.client_id, Number(r.n)]));
  res.json(rows.map((r) => ({ ...r, orders_count: countMap.get(r.id) || 0 })));
}));

app.get('/api/clients/:id', h(async (req, res) => {
  const client = await getClient(req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const { rows: orders } = await q(
    'SELECT * FROM orders WHERE client_id = $1 ORDER BY created_at DESC, id DESC',
    [client.id]
  );
  res.json({ ...client, orders: orders.map(serializeOrder) });
}));

app.post('/api/clients', h(async (req, res) => {
  const data = req.body || {};
  if (!data.name || !String(data.name).trim()) {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }
  const { rows } = await q(
    'INSERT INTO clients (name, phone, email, company, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [
      String(data.name).trim(),
      normalizePhone(data.phone) || (data.phone ? String(data.phone) : null),
      data.email || null,
      data.company || null,
      data.notes || null
    ]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/clients/:id', h(async (req, res) => {
  const client = await getClient(req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const data = req.body || {};
  const updates = {};
  for (const field of CLIENT_FIELDS) {
    if (field in data) updates[field] = data[field] === '' ? null : data[field];
  }
  if ('name' in updates && !updates.name) {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }
  if ('phone' in updates && updates.phone) {
    updates.phone = normalizePhone(updates.phone) || String(updates.phone);
  }
  const fields = Object.keys(updates);
  if (fields.length) {
    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    await q(`UPDATE clients SET ${sets}, updated_at = now() WHERE id = $${fields.length + 1}`, [
      ...Object.values(updates),
      client.id
    ]);
  }
  res.json(await getClient(client.id));
}));

app.delete('/api/clients/:id', h(async (req, res) => {
  const client = await getClient(req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  await q('UPDATE orders SET client_id = NULL WHERE client_id = $1', [client.id]);
  await q('DELETE FROM clients WHERE id = $1', [client.id]);
  res.json({ ok: true });
}));

// ---------- Faturamento ----------

// Valores são texto livre ("150,00") — a soma é feita aqui, igual ao frontend.
function parseValueBRL(v) {
  const n = parseFloat(
    String(v ?? '')
      .replace(/[^\d.,]/g, '')
      .replace(/\.(?=\d{3})/g, '')
      .replace(',', '.')
  );
  return Number.isFinite(n) ? n : 0;
}

// Mês local de São Paulo no formato YYYY-MM.
function monthKeySP(date) {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

app.get('/api/stats', h(async (req, res) => {
  const selected = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : monthKeySP(new Date());

  const { rows: delivered } = await q(
    "SELECT * FROM orders WHERE status = 'entregue' AND delivered_at IS NOT NULL ORDER BY delivered_at DESC, id DESC"
  );
  const { rows: open } = await q("SELECT * FROM orders WHERE archived = 0 AND status != 'entregue'");
  const { rows: invoiceRows } = await q(
    "SELECT DISTINCT order_id FROM attachments WHERE category = 'nota_fiscal'"
  );
  const invoiceSet = new Set(invoiceRows.map((r) => r.order_id));

  // últimos 6 meses (incluindo o atual)
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    months.push({ key: monthKeySP(d), total: 0, count: 0 });
  }
  const monthMap = new Map(months.map((m) => [m.key, m]));

  const monthOrders = [];
  let monthTotal = 0;
  let monthPaid = 0;
  for (const o of delivered) {
    const key = monthKeySP(o.delivered_at);
    const bucket = monthMap.get(key);
    if (bucket) {
      bucket.total += parseValueBRL(o.value);
      bucket.count += 1;
    }
    if (key === selected) {
      monthOrders.push({ ...serializeOrder(o), has_invoice: invoiceSet.has(o.id) });
      monthTotal += parseValueBRL(o.value);
      if (o.payment_status === 'pago') monthPaid += parseValueBRL(o.value);
    }
  }

  const pendingInvoices = delivered
    .filter((o) => !invoiceSet.has(o.id))
    .map((o) => serializeOrder(o));

  // a receber: qualquer pedido ativo (no quadro ou entregue) ainda não pago
  const { rows: unpaid } = await q(
    "SELECT * FROM orders WHERE archived = 0 AND payment_status != 'pago'"
  );

  res.json({
    selected_month: selected,
    month: {
      total: monthTotal,
      paid: monthPaid,
      count: monthOrders.length,
      avg: monthOrders.length ? monthTotal / monthOrders.length : 0
    },
    open: {
      count: open.length,
      total: open.reduce((sum, o) => sum + parseValueBRL(o.value), 0)
    },
    receivable: {
      count: unpaid.length,
      total: unpaid.reduce((sum, o) => sum + parseValueBRL(o.value), 0)
    },
    months,
    month_orders: monthOrders,
    pending_invoices: pendingInvoices
  });
}));

// ---------- Bot de pré-atendimento ----------

app.get('/api/bot/status', h(async (req, res) => {
  const s = await getSettings();
  res.json({
    enabled: s.bot_enabled === '1',
    has_key: Boolean(s.openai_api_key),
    model: s.openai_model,
    test_number: s.bot_test_number || '',
    webhook_url: `${baseUrl(req)}/api/bot/webhook?secret=${s.bot_webhook_secret}`
  });
}));

// Configura o webhook na Evolution API apontando para o nosso endpoint do bot.
app.post('/api/bot/setup-webhook', h(async (req, res) => {
  const s = await getSettings();
  if (!s.evolution_url || !s.evolution_apikey || !s.evolution_instance) {
    return res.status(400).json({ error: 'Configure a Evolution API (URL, chave e instância) antes.' });
  }
  const base = s.evolution_url.replace(/\/+$/, '');
  const instance = encodeURIComponent(s.evolution_instance);
  const url = `${baseUrl(req)}/api/bot/webhook?secret=${s.bot_webhook_secret}`;
  const headers = { 'Content-Type': 'application/json', apikey: s.evolution_apikey };
  const events = ['MESSAGES_UPSERT'];

  // Formato Evolution v2 (objeto webhook aninhado); fallback para o formato antigo.
  let resp = await fetch(`${base}/webhook/set/${instance}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: false, events } })
  });
  if (!resp.ok) {
    resp = await fetch(`${base}/webhook/set/${instance}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabled: true, url, webhook_by_events: false, events })
    });
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return res.status(502).json({ error: `Evolution recusou a configuração (${resp.status}): ${body.slice(0, 250)}` });
  }
  res.json({ ok: true, url });
}));

app.get('/api/bot/conversations', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM bot_conversations ORDER BY updated_at DESC, id DESC LIMIT 200');
  const { rows: lastMsgs } = await q(
    `SELECT DISTINCT ON (phone) phone, content, role, created_at
     FROM bot_messages ORDER BY phone, id DESC`
  );
  const lastMap = new Map(lastMsgs.map((m) => [m.phone, m]));
  res.json(
    rows.map((c) => ({
      ...c,
      last_message: lastMap.get(c.phone)?.content || null,
      last_role: lastMap.get(c.phone)?.role || null
    }))
  );
}));

app.get('/api/bot/conversations/:phone', h(async (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const { rows } = await q('SELECT * FROM bot_conversations WHERE phone = $1', [phone]);
  if (!rows.length) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const { rows: messages } = await q(
    'SELECT id, role, content, created_at FROM bot_messages WHERE phone = $1 ORDER BY id ASC',
    [phone]
  );
  res.json({ ...rows[0], messages });
}));

// Reativa o bot para uma conversa já encerrada (ele volta a responder aquele número).
app.post('/api/bot/conversations/:phone/reactivate', h(async (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const { rowCount } = await q(
    "UPDATE bot_conversations SET status = 'active', handled_reason = NULL, handled_at = NULL, updated_at = now() WHERE phone = $1",
    [phone]
  );
  if (!rowCount) return res.status(404).json({ error: 'Conversa não encontrada.' });
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
