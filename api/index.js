import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { q, STATUSES, getSettings, setSettings, ensureSchema } from '../lib/db.js';
import {
  pluggyAuth,
  createConnectToken,
  getItem,
  buildFinanceSummary
} from '../lib/pluggy.js';
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
// navigator.sendBeacon do site envia os leads como application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: false }));

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
    const result = await handleIncoming(req.body, baseUrl(req));
    res.status(200).json(result);
  } catch (err) {
    console.error('bot webhook:', err);
    res.status(200).json({ error: err.message });
  }
});

// Registro de lead — chamado pelo site (classul.com.br) quando alguém clica num
// botão de WhatsApp. Público (sem Bearer), aceita JSON ou form-urlencoded (sendBeacon).
// Responde 204 rápido para não atrasar a saída do usuário para o WhatsApp.
app.post('/api/leads/track', async (req, res) => {
  try {
    const body = req.body || {};
    const clip = (v, n) => (v == null ? null : String(v).replace(/[\r\n\t]/g, ' ').trim().slice(0, n) || null);
    const page = clip(body.page, 120);
    const label = clip(body.label, 80);
    const referrer = clip(body.referrer || req.headers.referer, 200);
    const userAgent = clip(req.headers['user-agent'], 250);
    const utmSource = clip(body.utm_source, 60);
    const utmMedium = clip(body.utm_medium, 60);
    const utmCampaign = clip(body.utm_campaign, 80);
    await ensureSchema();
    await q(
      `INSERT INTO leads (page, label, referrer, user_agent, utm_source, utm_medium, utm_campaign)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [page, label, referrer, userAgent, utmSource, utmMedium, utmCampaign]
    );
    res.status(204).end();
  } catch (err) {
    console.error('leads track:', err);
    // Nunca falha de forma barulhenta: o rastreamento não pode quebrar o site.
    res.status(204).end();
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
  'pickup_time',
  'payment_status'
];
const PAYMENT_STATUSES = ['pendente', 'sinal', 'pago'];

function serializeOrder(order) {
  return { ...order, order_number: formatOrderNumber(order.id) };
}

// Nome do funcionário que está fazendo a ação (vem do header, salvo no dispositivo).
function currentUser(req) {
  const u = req.headers['x-classul-user'];
  return u ? String(u).trim().slice(0, 60) || null : null;
}

// Chave de uma conversa: telefone normalizado quando houver dígitos, senão o texto cru (ex: 'n_...').
function chatKey(param) {
  return normalizePhone(param) || String(param || '').trim().slice(0, 80);
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
  const { rows: comments } = await q(
    'SELECT * FROM order_comments WHERE order_id = $1 ORDER BY created_at ASC, id ASC',
    [order.id]
  );
  res.json({ ...serializeOrder(order), messages, attachments, comments });
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
  const user = currentUser(req);
  const { rows } = await q(
    `INSERT INTO orders (customer_name, phone, description, product_type, case_color, value, due_date, pickup_time, status, client_id, payment_status, pickup_code, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
    [
      String(data.customer_name).trim(),
      normalizePhone(data.phone) || (data.phone ? String(data.phone) : null),
      data.description || null,
      data.product_type || null,
      data.case_color || null,
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
  updates.updated_by = currentUser(req);
  const fields = Object.keys(updates);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  await q(`UPDATE orders SET ${sets}, updated_at = now() WHERE id = $${fields.length + 1}`, [
    ...Object.values(updates),
    order.id
  ]);
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
  const mover = currentUser(req);
  // registra a data de entrega (base do faturamento)
  if (status === 'entregue') {
    await q(
      'UPDATE orders SET status = $1, delivered_at = COALESCE(delivered_at, now()), updated_at = now(), updated_by = $3 WHERE id = $2',
      [status, order.id, mover]
    );
  } else {
    await q('UPDATE orders SET status = $1, delivered_at = NULL, updated_at = now(), updated_by = $3 WHERE id = $2', [
      status,
      order.id,
      mover
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

// ---------- Leads do WhatsApp (cliques do site) ----------

// Dia local de São Paulo no formato YYYY-MM-DD.
function dayKeySP(date) {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

// Nome amigável da página a partir do caminho (igual ao painel antigo).
function pageLabel(path) {
  const p = String(path || '').trim();
  if (!p || p === '/') return 'Página inicial';
  const clean = p.replace(/^\/+|\/+$/g, '');
  if (clean.startsWith('produto/')) {
    return 'Produto: ' + clean.slice(8).replace(/-/g, ' ');
  }
  return clean;
}

// Origem do lead: UTM quando houver (com campanha), senão o domínio de onde
// veio (referrer), senão "Direto".
function leadSource(row) {
  const source = String(row.utm_source || '').trim();
  if (source) {
    const campaign = String(row.utm_campaign || '').trim();
    return campaign ? `${source} · ${campaign}` : source;
  }
  const ref = String(row.referrer || '').trim();
  if (ref) {
    try {
      const host = new URL(ref).hostname.replace(/^www\./, '');
      if (host && !host.includes('classul')) return host;
    } catch {
      /* referrer malformado — cai para "Direto" */
    }
  }
  return 'Direto';
}

app.get('/api/leads', h(async (req, res) => {
  const { rows: totalRows } = await q('SELECT COUNT(*)::int AS n FROM leads');
  const total = totalRows[0]?.n || 0;

  // Só os últimos 30 dias alimentam gráfico, páginas, origens e recentes.
  const { rows } = await q(
    `SELECT page, label, referrer, utm_source, utm_medium, utm_campaign, created_at
     FROM leads WHERE created_at >= now() - interval '30 days' ORDER BY created_at DESC, id DESC`
  );

  // Série dos últimos 30 dias (dias sem clique = 0).
  const series = [];
  const seriesMap = new Map();
  const today = dayKeySP(new Date());
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKeySP(d);
    const bucket = { day: key, count: 0 };
    series.push(bucket);
    seriesMap.set(key, bucket);
  }

  const byPage = new Map();
  const bySource = new Map();
  const recent = [];
  for (const r of rows) {
    const key = dayKeySP(r.created_at);
    const bucket = seriesMap.get(key);
    if (bucket) bucket.count += 1;
    const pkey = r.page || '/';
    byPage.set(pkey, (byPage.get(pkey) || 0) + 1);
    const source = leadSource(r);
    bySource.set(source, (bySource.get(source) || 0) + 1);
    if (recent.length < 20) {
      recent.push({
        created_at: r.created_at,
        page: pkey,
        page_label: pageLabel(pkey),
        label: r.label,
        source
      });
    }
  }

  const last7 = series.slice(-7).reduce((sum, s) => sum + s.count, 0);
  const last30 = series.reduce((sum, s) => sum + s.count, 0);
  const todayCount = seriesMap.get(today)?.count || 0;

  const topPages = [...byPage.entries()]
    .map(([page, count]) => ({ page, page_label: pageLabel(page), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topSources = [...bySource.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  res.json({
    total,
    today: todayCount,
    last7,
    last30,
    series,
    top_pages: topPages,
    top_sources: topSources,
    recent
  });
}));

// ---------- Funcionários (perfil simples, sem senha) ----------

app.get('/api/employees', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM employees WHERE active = 1 ORDER BY name ASC');
  res.json(rows);
}));

app.post('/api/employees', h(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do funcionário.' });
  const color = req.body?.color || null;
  // reativa se já existir com o mesmo nome (case-insensitive)
  const { rows: exist } = await q('SELECT * FROM employees WHERE LOWER(name) = LOWER($1) LIMIT 1', [name]);
  if (exist.length) {
    await q('UPDATE employees SET active = 1, color = COALESCE($2, color) WHERE id = $1', [exist[0].id, color]);
    return res.status(200).json({ ...exist[0], active: 1, color: color || exist[0].color });
  }
  const { rows } = await q('INSERT INTO employees (name, color) VALUES ($1, $2) RETURNING *', [name, color]);
  res.status(201).json(rows[0]);
}));

app.delete('/api/employees/:id', h(async (req, res) => {
  await q('UPDATE employees SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Comentários do pedido ----------

app.post('/api/orders/:id/comments', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Escreva um comentário.' });
  const author = currentUser(req) || req.body?.author || null;
  const { rows } = await q(
    'INSERT INTO order_comments (order_id, author, body) VALUES ($1, $2, $3) RETURNING *',
    [order.id, author, body]
  );
  res.status(201).json(rows[0]);
}));

app.delete('/api/comments/:id', h(async (req, res) => {
  await q('DELETE FROM order_comments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Etiquetas de conversa do WhatsApp (compartilhadas) ----------

app.get('/api/chats', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM chat_assignments ORDER BY updated_at DESC');
  res.json(rows);
}));

app.get('/api/chats/:phone', h(async (req, res) => {
  const phone = chatKey(req.params.phone);
  const { rows } = await q('SELECT * FROM chat_assignments WHERE phone = $1', [phone]);
  res.json(rows[0] || { phone, employee: null, status: null, note: null, chat_name: null });
}));

app.put('/api/chats/:phone', h(async (req, res) => {
  const phone = chatKey(req.params.phone);
  if (!phone) return res.status(400).json({ error: 'Conversa inválida.' });
  const employee = req.body?.employee ? String(req.body.employee).slice(0, 60) : null;
  const status = req.body?.status ? String(req.body.status).slice(0, 40) : null;
  const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
  const chatName = req.body?.name ? String(req.body.name).slice(0, 120) : null;
  const { rows } = await q(
    `INSERT INTO chat_assignments (phone, employee, status, note, chat_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (phone) DO UPDATE SET employee = EXCLUDED.employee, status = EXCLUDED.status,
       note = EXCLUDED.note, chat_name = COALESCE(EXCLUDED.chat_name, chat_assignments.chat_name), updated_at = now()
     RETURNING *`,
    [phone, employee, status, note, chatName]
  );
  res.json(rows[0]);
}));

app.delete('/api/chats/:phone', h(async (req, res) => {
  const phone = chatKey(req.params.phone);
  await q('DELETE FROM chat_assignments WHERE phone = $1', [phone]);
  res.json({ ok: true });
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

// ---------- Finanças pessoais (Open Finance via Pluggy) ----------
//
// Camada extra de segurança: além do login do sistema (Bearer), a aba tem um PIN
// próprio. Quem sabe o PIN recebe um "finance token" (derivado do hash do PIN, sem
// nunca trafegar o PIN em requisições seguintes) e só com ele os dados/gráficos são
// liberados. Assim, ver as finanças exige login + PIN.

const APP_SECRET = () => process.env.API_TOKEN || 'classul';
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hashPin = (pin) => sha256(`${APP_SECRET()}:pin:${pin}`);
const financeTokenFor = (pinHash) => sha256(`${APP_SECRET()}:fin:${pinHash}`);

async function getFinancePinHash() {
  const { rows } = await q("SELECT value FROM settings WHERE key = 'finance_pin_hash'");
  return rows[0]?.value || '';
}

async function getPluggyCreds() {
  const { rows } = await q(
    "SELECT key, value FROM settings WHERE key IN ('pluggy_client_id', 'pluggy_client_secret')"
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { clientId: map.pluggy_client_id || '', clientSecret: map.pluggy_client_secret || '' };
}

async function saveSetting(key, value) {
  await q(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, String(value ?? '')]
  );
}

async function financeItems() {
  const { rows } = await q(
    'SELECT item_id, connector_name, connector_image, label FROM finance_items ORDER BY created_at ASC'
  );
  return rows;
}

// Middleware da trava: exige o header X-Finance-Token válido. Responde 403 (não 401)
// para o front distinguir "re-logar" de "digitar o PIN de novo".
async function requireFinance(req, res, next) {
  try {
    const pinHash = await getFinancePinHash();
    if (!pinHash) return res.status(403).json({ error: 'Defina um PIN para as finanças.', finance_locked: true });
    const token = req.headers['x-finance-token'] || '';
    if (token !== financeTokenFor(pinHash)) {
      return res.status(403).json({ error: 'Finanças bloqueadas.', finance_locked: true });
    }
    next();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

// Estado da aba (só precisa do login): se tem PIN, se tem credenciais, quantos itens.
app.get('/api/finance/status', h(async (req, res) => {
  const pinHash = await getFinancePinHash();
  const { clientId, clientSecret } = await getPluggyCreds();
  const items = await financeItems();
  res.json({
    has_pin: Boolean(pinHash),
    has_credentials: Boolean(clientId && clientSecret),
    item_count: items.length
  });
}));

// Cria (primeira vez) ou troca o PIN. Para trocar, exige o PIN atual.
app.post('/api/finance/pin', h(async (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  if (pin.length < 4) return res.status(400).json({ error: 'O PIN precisa ter pelo menos 4 dígitos.' });
  const current = await getFinancePinHash();
  if (current) {
    const currentPin = String(req.body?.current_pin || '').trim();
    if (hashPin(currentPin) !== current) return res.status(403).json({ error: 'PIN atual incorreto.' });
  }
  const newHash = hashPin(pin);
  await saveSetting('finance_pin_hash', newHash);
  res.json({ ok: true, token: financeTokenFor(newHash) });
}));

// Destrava: recebe o PIN e devolve o finance token.
app.post('/api/finance/unlock', h(async (req, res) => {
  const pinHash = await getFinancePinHash();
  if (!pinHash) return res.status(400).json({ error: 'Nenhum PIN configurado ainda.', no_pin: true });
  const pin = String(req.body?.pin || '').trim();
  if (hashPin(pin) !== pinHash) return res.status(403).json({ error: 'PIN incorreto.' });
  res.json({ ok: true, token: financeTokenFor(pinHash) });
}));

// Credenciais da Pluggy (atrás da trava). Nunca devolve o secret em texto.
app.get('/api/finance/config', requireFinance, h(async (req, res) => {
  const { clientId, clientSecret } = await getPluggyCreds();
  res.json({ client_id: clientId, has_secret: Boolean(clientSecret) });
}));

app.put('/api/finance/config', requireFinance, h(async (req, res) => {
  if ('client_id' in (req.body || {})) {
    await saveSetting('pluggy_client_id', String(req.body.client_id || '').trim());
  }
  // Secret só é sobrescrito quando enviado não-vazio (permite salvar só o Client ID).
  const secret = String(req.body?.client_secret || '').trim();
  if (secret) await saveSetting('pluggy_client_secret', secret);
  const { clientId, clientSecret } = await getPluggyCreds();
  res.json({ client_id: clientId, has_secret: Boolean(clientSecret) });
}));

// Gera o connect token para abrir o widget Pluggy Connect (conectar/atualizar banco).
app.post('/api/finance/connect-token', requireFinance, h(async (req, res) => {
  const { clientId, clientSecret } = await getPluggyCreds();
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Configure as credenciais da Pluggy antes de conectar um banco.' });
  }
  const apiKey = await pluggyAuth(clientId, clientSecret);
  const itemId = req.body?.item_id ? String(req.body.item_id) : null;
  const token = await createConnectToken(apiKey, itemId, { clientUserId: 'classul-owner' });
  res.json({ token });
}));

// Registra um item conectado (o widget devolve o item.id no onSuccess).
app.post('/api/finance/items', requireFinance, h(async (req, res) => {
  const itemId = String(req.body?.item_id || '').trim();
  if (!itemId) return res.status(400).json({ error: 'Informe o item_id da conexão.' });
  let connectorName = null;
  let connectorImage = null;
  try {
    const { clientId, clientSecret } = await getPluggyCreds();
    const apiKey = await pluggyAuth(clientId, clientSecret);
    const item = await getItem(apiKey, itemId);
    connectorName = item?.connector?.name || null;
    connectorImage = item?.connector?.imageUrl || null;
  } catch {
    /* se falhar buscar o conector, ainda salvamos o item */
  }
  await q(
    `INSERT INTO finance_items (item_id, connector_name, connector_image)
     VALUES ($1, $2, $3)
     ON CONFLICT (item_id) DO UPDATE SET connector_name = COALESCE(EXCLUDED.connector_name, finance_items.connector_name),
       connector_image = COALESCE(EXCLUDED.connector_image, finance_items.connector_image), updated_at = now()`,
    [itemId, connectorName, connectorImage]
  );
  res.status(201).json({ ok: true, item_id: itemId, connector_name: connectorName });
}));

// Renomeia a conexão. No Meu Pluggy o conector é sempre o agregador ("MeuPluggy"),
// então o apelido é o que garante o nome certo do banco no painel.
app.put('/api/finance/items/:id', requireFinance, h(async (req, res) => {
  const label = String(req.body?.label || '').trim().slice(0, 40);
  const { rowCount } = await q('UPDATE finance_items SET label = $2, updated_at = now() WHERE item_id = $1', [
    req.params.id,
    label || null
  ]);
  if (!rowCount) return res.status(404).json({ error: 'Conexão não encontrada.' });
  res.json({ ok: true, item_id: req.params.id, label: label || null });
}));

app.delete('/api/finance/items/:id', requireFinance, h(async (req, res) => {
  await q('DELETE FROM finance_items WHERE item_id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Painel consolidado: saldos, patrimônio, gastos do mês, categorias, contas a pagar.
app.get('/api/finance/summary', requireFinance, h(async (req, res) => {
  const { clientId, clientSecret } = await getPluggyCreds();
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Configure as credenciais da Pluggy.', needs_setup: true });
  }
  const items = await financeItems();
  if (!items.length) {
    return res.json({ empty: true, connectors: [], accounts: [], series: [], categories: [], recent: [], upcoming: [] });
  }
  const apiKey = await pluggyAuth(clientId, clientSecret);
  const days = /^\d+$/.test(String(req.query.days)) ? Math.min(90, Math.max(7, Number(req.query.days))) : 30;
  const summary = await buildFinanceSummary(apiKey, items, { days });
  res.json(summary);
}));

// ---------- Área pessoal do Lucas (missões e rotinas) ----------
//
// Aba com vida própria dentro do sistema: mesma trava em duas camadas das
// finanças (login Bearer + PIN próprio). Quem sabe o PIN recebe um "lucas token"
// derivado do hash do PIN; sem ele nada de tarefas/rotinas é devolvido.

const lucasHashPin = (pin) => sha256(`${APP_SECRET()}:lucaspin:${pin}`);
const lucasTokenFor = (pinHash) => sha256(`${APP_SECRET()}:lucas:${pinHash}`);

async function getLucasPinHash() {
  const { rows } = await q("SELECT value FROM settings WHERE key = 'lucas_pin_hash'");
  return rows[0]?.value || '';
}

// Igual ao requireFinance: 403 com lucas_locked para o front pedir o PIN de novo
// (e não confundir com sessão expirada, que é 401).
async function requireLucas(req, res, next) {
  try {
    const pinHash = await getLucasPinHash();
    if (!pinHash) return res.status(403).json({ error: 'Defina um PIN para esta área.', lucas_locked: true });
    const token = req.headers['x-lucas-token'] || '';
    if (token !== lucasTokenFor(pinHash)) {
      return res.status(403).json({ error: 'Área bloqueada.', lucas_locked: true });
    }
    next();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

const LUCAS_PRIORITIES = ['baixa', 'media', 'critica'];
const LUCAS_STATUSES = ['aberta', 'andamento', 'concluida'];

app.get('/api/lucas/status', h(async (req, res) => {
  res.json({ has_pin: Boolean(await getLucasPinHash()) });
}));

app.post('/api/lucas/pin', h(async (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  if (pin.length < 4) return res.status(400).json({ error: 'O PIN precisa ter pelo menos 4 dígitos.' });
  const current = await getLucasPinHash();
  if (current) {
    const currentPin = String(req.body?.current_pin || '').trim();
    if (lucasHashPin(currentPin) !== current) return res.status(403).json({ error: 'PIN atual incorreto.' });
  }
  const newHash = lucasHashPin(pin);
  await saveSetting('lucas_pin_hash', newHash);
  res.json({ ok: true, token: lucasTokenFor(newHash) });
}));

app.post('/api/lucas/unlock', h(async (req, res) => {
  const pinHash = await getLucasPinHash();
  if (!pinHash) return res.status(400).json({ error: 'Nenhum PIN configurado ainda.', no_pin: true });
  const pin = String(req.body?.pin || '').trim();
  if (lucasHashPin(pin) !== pinHash) return res.status(403).json({ error: 'PIN incorreto.' });
  res.json({ ok: true, token: lucasTokenFor(pinHash) });
}));

// Dia (YYYY-MM-DD) N dias atrás no fuso de São Paulo.
function lucasDayBack(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKeySP(d);
}

// Sequência de dias seguidos cumpridos, contando só os dias em que a rotina é
// programada. O dia de hoje ainda em aberto não quebra a sequência.
function lucasStreak(days, doneSet) {
  const scheduled = (key) => {
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    return days.includes(String(weekday));
  };
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const key = lucasDayBack(i);
    if (!scheduled(key)) continue;
    if (doneSet.has(key)) {
      streak += 1;
      continue;
    }
    if (i === 0) continue; // hoje ainda dá tempo
    break;
  }
  return streak;
}

// Tudo que a tela precisa numa chamada só: missões, rotinas (com histórico de 28
// dias, sequência e status de hoje) e os números do topo.
app.get('/api/lucas/overview', requireLucas, h(async (req, res) => {
  const today = dayKeySP(new Date());
  const weekday = String(new Date(`${today}T12:00:00Z`).getUTCDay());

  const { rows: tasks } = await q(
    `SELECT id, title, notes, priority, status, due_date, done_at, created_at, updated_at
     FROM lucas_tasks
     ORDER BY CASE status WHEN 'andamento' THEN 0 WHEN 'aberta' THEN 1 ELSE 2 END,
              CASE priority WHEN 'critica' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
              COALESCE(due_date, '9999-12-31'), id DESC`
  );
  const { rows: routineRows } = await q(
    'SELECT id, title, time_of_day, days, active FROM lucas_routines ORDER BY COALESCE(time_of_day, \'99:99\'), id'
  );
  const since = lucasDayBack(27);
  const { rows: logs } = await q('SELECT routine_id, day FROM lucas_routine_logs WHERE day >= $1', [since]);

  const byRoutine = new Map();
  for (const log of logs) {
    if (!byRoutine.has(log.routine_id)) byRoutine.set(log.routine_id, new Set());
    byRoutine.get(log.routine_id).add(log.day);
  }

  const history = [];
  for (let i = 27; i >= 0; i--) history.push(lucasDayBack(i));

  const routines = routineRows.map((r) => {
    const done = byRoutine.get(r.id) || new Set();
    const days = String(r.days || '0123456');
    return {
      ...r,
      days,
      today: days.includes(weekday),
      done_today: done.has(today),
      streak: lucasStreak(days, done),
      history: history.map((day) => ({ day, done: done.has(day) }))
    };
  });

  const todayRoutines = routines.filter((r) => r.active && r.today);
  const doneToday = todayRoutines.filter((r) => r.done_today).length;
  const open = tasks.filter((t) => t.status !== 'concluida');

  res.json({
    today,
    tasks,
    routines,
    stats: {
      routines_today: todayRoutines.length,
      routines_done: doneToday,
      tasks_open: open.length,
      tasks_critical: open.filter((t) => t.priority === 'critica').length,
      tasks_late: open.filter((t) => t.due_date && t.due_date < today).length,
      tasks_done_today: tasks.filter((t) => t.done_at && dayKeySP(t.done_at) === today).length
    }
  });
}));

function lucasTaskPayload(body = {}) {
  const priority = LUCAS_PRIORITIES.includes(body.priority) ? body.priority : 'media';
  const status = LUCAS_STATUSES.includes(body.status) ? body.status : 'aberta';
  return {
    title: String(body.title || '').trim(),
    notes: body.notes ? String(body.notes).trim() : null,
    priority,
    status,
    due_date: body.due_date ? String(body.due_date).slice(0, 10) : null
  };
}

app.post('/api/lucas/tasks', requireLucas, h(async (req, res) => {
  const t = lucasTaskPayload(req.body);
  if (!t.title) return res.status(400).json({ error: 'Dê um nome para a missão.' });
  const { rows } = await q(
    `INSERT INTO lucas_tasks (title, notes, priority, status, due_date, done_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [t.title, t.notes, t.priority, t.status, t.due_date, t.status === 'concluida' ? new Date() : null]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/lucas/tasks/:id', requireLucas, h(async (req, res) => {
  const { rows: current } = await q('SELECT * FROM lucas_tasks WHERE id = $1', [req.params.id]);
  if (!current.length) return res.status(404).json({ error: 'Missão não encontrada.' });
  const old = current[0];
  const body = req.body || {};
  const t = lucasTaskPayload({
    title: body.title ?? old.title,
    notes: body.notes ?? old.notes,
    priority: body.priority ?? old.priority,
    status: body.status ?? old.status,
    due_date: body.due_date ?? old.due_date
  });
  if (!t.title) return res.status(400).json({ error: 'Dê um nome para a missão.' });
  // done_at só muda quando a missão entra ou sai de concluída.
  let doneAt = old.done_at;
  if (t.status === 'concluida' && old.status !== 'concluida') doneAt = new Date();
  if (t.status !== 'concluida') doneAt = null;
  const { rows } = await q(
    `UPDATE lucas_tasks SET title = $2, notes = $3, priority = $4, status = $5, due_date = $6,
       done_at = $7, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.params.id, t.title, t.notes, t.priority, t.status, t.due_date, doneAt]
  );
  res.json(rows[0]);
}));

app.delete('/api/lucas/tasks/:id', requireLucas, h(async (req, res) => {
  await q('DELETE FROM lucas_tasks WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

function lucasRoutinePayload(body = {}) {
  const days = String(body.days ?? '0123456').replace(/[^0-6]/g, '');
  const time = String(body.time_of_day || '').trim();
  return {
    title: String(body.title || '').trim(),
    time_of_day: /^\d{2}:\d{2}$/.test(time) ? time : null,
    days: days || '0123456',
    active: body.active === 0 || body.active === false ? 0 : 1
  };
}

app.post('/api/lucas/routines', requireLucas, h(async (req, res) => {
  const r = lucasRoutinePayload(req.body);
  if (!r.title) return res.status(400).json({ error: 'Dê um nome para a rotina.' });
  const { rows } = await q(
    'INSERT INTO lucas_routines (title, time_of_day, days, active) VALUES ($1, $2, $3, $4) RETURNING *',
    [r.title, r.time_of_day, r.days, r.active]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/lucas/routines/:id', requireLucas, h(async (req, res) => {
  const { rows: current } = await q('SELECT * FROM lucas_routines WHERE id = $1', [req.params.id]);
  if (!current.length) return res.status(404).json({ error: 'Rotina não encontrada.' });
  const old = current[0];
  const body = req.body || {};
  const r = lucasRoutinePayload({
    title: body.title ?? old.title,
    time_of_day: body.time_of_day ?? old.time_of_day,
    days: body.days ?? old.days,
    active: body.active ?? old.active
  });
  if (!r.title) return res.status(400).json({ error: 'Dê um nome para a rotina.' });
  const { rows } = await q(
    `UPDATE lucas_routines SET title = $2, time_of_day = $3, days = $4, active = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, r.title, r.time_of_day, r.days, r.active]
  );
  res.json(rows[0]);
}));

app.delete('/api/lucas/routines/:id', requireLucas, h(async (req, res) => {
  await q('DELETE FROM lucas_routine_logs WHERE routine_id = $1', [req.params.id]);
  await q('DELETE FROM lucas_routines WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Marca/desmarca a rotina num dia (padrão: hoje).
app.post('/api/lucas/routines/:id/check', requireLucas, h(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: exists } = await q('SELECT id FROM lucas_routines WHERE id = $1', [id]);
  if (!exists.length) return res.status(404).json({ error: 'Rotina não encontrada.' });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.day || '')) ? req.body.day : dayKeySP(new Date());
  const done = req.body?.done !== false;
  if (done) {
    await q(
      'INSERT INTO lucas_routine_logs (routine_id, day) VALUES ($1, $2) ON CONFLICT (routine_id, day) DO NOTHING',
      [id, day]
    );
  } else {
    await q('DELETE FROM lucas_routine_logs WHERE routine_id = $1 AND day = $2', [id, day]);
  }
  res.json({ ok: true, id, day, done });
}));

// ---------- Configurações ----------

// Chaves sensíveis das abas com trava por PIN (Finanças e Lucas) nunca saem
// pela rota geral de configurações.
const FINANCE_SECRET_KEYS = ['finance_pin_hash', 'pluggy_client_id', 'pluggy_client_secret', 'lucas_pin_hash'];

app.get('/api/settings', h(async (req, res) => {
  const all = await getSettings();
  for (const k of FINANCE_SECRET_KEYS) delete all[k];
  res.json(all);
}));

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
