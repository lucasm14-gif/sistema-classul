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
  createUploadSessionInFolder,
  ensureOrderFolder,
  ensureInboxFolder,
  ensurePhotosFolder,
  downloadFile,
  getFileMeta,
  deleteFile
} from '../lib/google.js';
import {
  ORDER_FIELDS,
  PAYMENT_STATUSES,
  serializeOrder,
  getOrder,
  getClient,
  createOrder,
  updateOrderFields,
  moveOrderStatus,
  parseValueBRL,
  monthKeySP,
  dayKeySP,
  OrderError
} from '../lib/orders.js';
import { TOOLS, toolsFor, runTool, isPrivateTool, forwardIncomingToHermes } from '../lib/hermes.js';
import {
  lucasOverview,
  createLucasTask,
  updateLucasTask,
  deleteLucasTask,
  createLucasRoutine,
  updateLucasRoutine,
  deleteLucasRoutine,
  checkLucasRoutine
} from '../lib/lucas.js';
import { notifyHermes, logHermes } from '../lib/hermes-events.js';
import { handleIncoming } from '../lib/bot.js';
import { handleWatchedMessage } from '../lib/watcher.js';
import { analyzeChat, STAGES } from '../lib/analyst.js';
import { CASE_COLORS, PLATE_SIZES, PRODUCT_TYPES } from '../lib/default-content.js';

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
    // Quem faz o pré-atendimento: o bot de IA daqui, o Hermes na VPS, ou ninguém.
    const engine = settings.bot_engine || 'interno';
    const atendimento =
      engine === 'hermes'
        ? forwardIncomingToHermes(req.body)
        : engine === 'off'
          ? Promise.resolve({ ignored: 'pré-atendimento desligado' })
          : handleIncoming(req.body, baseUrl(req));

    // Observador e atendimento são independentes: um só escuta, o outro responde.
    // Um erro em qualquer um deles não pode derrubar o webhook.
    const [watched, bot] = await Promise.allSettled([handleWatchedMessage(req.body), atendimento]);
    res.status(200).json({
      watcher: watched.status === 'fulfilled' ? watched.value : { error: watched.reason?.message },
      bot: bot.status === 'fulfilled' ? bot.value : { error: bot.reason?.message }
    });
  } catch (err) {
    console.error('bot webhook:', err);
    res.status(200).json({ error: err.message });
  }
});

// ---------- Hermes (bot na VPS) ----------
// Ficam antes do Bearer do sistema de propósito: o Hermes entra com a chave
// própria dele, que pode ser trocada sem mexer no login de ninguém.

async function requireHermes(req, res) {
  await ensureSchema();
  const settings = await getSettings();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.headers['x-hermes-token'] || '');
  if (!settings.hermes_token || token !== settings.hermes_token) {
    res.status(401).json({ ok: false, error: 'Chave do Hermes inválida ou ausente.' });
    return null;
  }
  if (settings.hermes_enabled !== '1') {
    res.status(403).json({ ok: false, error: 'A conexão com o Hermes está desligada nas configurações do sistema.' });
    return null;
  }
  return settings;
}

// Teste de vida: o Hermes chama para saber se a chave está valendo.
app.get('/api/hermes/ping', async (req, res) => {
  try {
    const settings = await requireHermes(req, res);
    if (!settings) return;
    res.json({ ok: true, sistema: 'Classul', ferramentas: TOOLS.length, pre_atendimento: settings.bot_engine || 'interno' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Catálogo de ferramentas. ?format=openai ou ?format=anthropic devolve pronto
// para colar no SDK; sem format, vem o schema puro.
app.get('/api/hermes/tools', async (req, res) => {
  try {
    if (!(await requireHermes(req, res))) return;
    res.json({ ok: true, total: TOOLS.length, tools: toolsFor(String(req.query.format || '')) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Executa uma ferramenta. Erros de regra voltam como ok:false (HTTP 200) para
// o laço de tool calling do Hermes poder mostrar o motivo ao modelo e seguir.
app.post('/api/hermes/call', async (req, res) => {
  try {
    if (!(await requireHermes(req, res))) return;
    const { tool, args } = req.body || {};
    if (!tool) return res.status(400).json({ ok: false, error: 'Informe o nome da ferramenta em "tool".' });
    // Ferramentas da área do Lucas ficam no registro sem o conteúdo: o registro
    // aparece na aba Hermes, que não pede o PIN.
    const privado = isPrivateTool(String(tool));
    try {
      const result = await runTool(String(tool), args || {});
      await logHermes('entrada', tool, privado ? {} : { args, result });
      res.json({ ok: true, tool, result });
    } catch (err) {
      await logHermes('entrada', tool, privado ? { ok: false, error: 'área do Lucas (detalhe omitido)' } : { args, ok: false, error: err.message });
      res.json({ ok: false, tool, error: err.message });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
    await notifyHermes('lead.novo', { pagina: page, botao: label, origem: utmSource, campanha: utmCampaign });
    res.status(204).end();
  } catch (err) {
    console.error('leads track:', err);
    // Nunca falha de forma barulhenta: o rastreamento não pode quebrar o site.
    res.status(204).end();
  }
});

// Foto da extensão — público de propósito: a extensão (e o bot, via Evolution)
// precisam baixar a imagem por URL simples. São fotos de catálogo, não sigilosas.
app.get('/api/photos/:id', async (req, res) => {
  try {
    await ensureSchema();
    const { rows } = await q('SELECT * FROM photos WHERE id = $1', [req.params.id]);
    const photo = rows[0];
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada.' });
    const buffer = await downloadFile(photo.drive_file_id);
    res.setHeader('Content-Type', photo.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
    res.send(buffer);
  } catch (err) {
    console.error('foto:', err);
    res.status(502).json({ error: err.message });
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

// Nome do funcionário que está fazendo a ação (vem do header, salvo no dispositivo).
function currentUser(req) {
  const u = req.headers['x-classul-user'];
  return u ? String(u).trim().slice(0, 60) || null : null;
}

// Chave de uma conversa: telefone normalizado quando houver dígitos, senão o texto cru (ex: 'n_...').
function chatKey(param) {
  return normalizePhone(param) || String(param || '').trim().slice(0, 80);
}

// Handler async com tratamento de erro centralizado.
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (!(err instanceof OrderError)) console.error(err);
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
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
  const order = await createOrder(req.body || {}, currentUser(req));
  res.status(201).json(order);
}));

app.put('/api/orders/:id', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json(await updateOrderFields(order, req.body || {}, currentUser(req)));
}));

// Mover no Kanban — dispara mensagem automática nas etapas configuradas.
app.patch('/api/orders/:id/status', h(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json(await moveOrderStatus(order, req.body?.status, currentUser(req)));
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

app.get('/api/lucas/overview', requireLucas, h(async (req, res) => {
  res.json(await lucasOverview());
}));

app.post('/api/lucas/tasks', requireLucas, h(async (req, res) => {
  res.status(201).json(await createLucasTask(req.body));
}));

app.put('/api/lucas/tasks/:id', requireLucas, h(async (req, res) => {
  res.json(await updateLucasTask(req.params.id, req.body || {}));
}));

app.delete('/api/lucas/tasks/:id', requireLucas, h(async (req, res) => {
  await deleteLucasTask(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/lucas/routines', requireLucas, h(async (req, res) => {
  res.status(201).json(await createLucasRoutine(req.body));
}));

app.put('/api/lucas/routines/:id', requireLucas, h(async (req, res) => {
  res.json(await updateLucasRoutine(req.params.id, req.body || {}));
}));

app.delete('/api/lucas/routines/:id', requireLucas, h(async (req, res) => {
  await deleteLucasRoutine(req.params.id);
  res.json({ ok: true });
}));

// Marca/desmarca a rotina num dia (padrão: hoje).
app.post('/api/lucas/routines/:id/check', requireLucas, h(async (req, res) => {
  res.json(await checkLucasRoutine(req.params.id, req.body || {}));
}));

// ---------- Conteúdo da extensão (mensagens, fotos e catálogo) ----------

const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

async function listQuickMessages() {
  const { rows } = await q('SELECT * FROM quick_messages WHERE active = 1 ORDER BY sort_order ASC, id ASC');
  return rows;
}

async function listCatalog() {
  const { rows } = await q('SELECT * FROM catalog_products WHERE active = 1 ORDER BY sort_order ASC, id ASC');
  return rows;
}

async function listPhotoSets(req) {
  const { rows: sets } = await q('SELECT * FROM photo_sets ORDER BY sort_order ASC, id ASC');
  const { rows: photos } = await q('SELECT * FROM photos ORDER BY sort_order ASC, id ASC');
  const base = baseUrl(req);
  return sets.map((set) => ({
    ...set,
    photos: photos
      .filter((ph) => ph.set_id === set.id)
      .map((ph) => ({ id: ph.id, name: ph.name, mime_type: ph.mime_type, url: `${base}/api/photos/${ph.id}` }))
  }));
}

// Tudo que a extensão precisa, numa chamada só (ela consulta isso periodicamente).
app.get('/api/extension/config', h(async (req, res) => {
  const [messages, catalog, sets] = await Promise.all([listQuickMessages(), listCatalog(), listPhotoSets(req)]);
  res.json({
    quick_messages: messages.map((m) => ({ id: m.id, title: m.title, text: m.body })),
    photo_sets: sets,
    catalog: {
      products: catalog.map((p) => ({
        name: p.name,
        short_label: p.short_label,
        has_size: p.has_size === 1,
        is_case: p.is_case === 1
      })),
      case_colors: CASE_COLORS,
      plate_sizes: PLATE_SIZES,
      product_types: PRODUCT_TYPES
    }
  });
}));

// --- Mensagens rápidas ---

app.get('/api/quick-messages', h(async (req, res) => res.json(await listQuickMessages())));

app.post('/api/quick-messages', h(async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!title || !body) return res.status(400).json({ error: 'Informe o título e o texto da mensagem.' });
  const { rows: max } = await q('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM quick_messages');
  const { rows } = await q(
    'INSERT INTO quick_messages (title, body, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [title.slice(0, 80), body, max[0].next]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/quick-messages/:id', h(async (req, res) => {
  const updates = {};
  if ('title' in req.body) updates.title = String(req.body.title || '').trim().slice(0, 80);
  if ('body' in req.body) updates.body = String(req.body.body || '');
  if ('sort_order' in req.body) updates.sort_order = Number(req.body.sort_order) || 0;
  if ('active' in req.body) updates.active = req.body.active ? 1 : 0;
  const fields = Object.keys(updates);
  if (!fields.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const { rows } = await q(
    `UPDATE quick_messages SET ${sets}, updated_at = now() WHERE id = $${fields.length + 1} RETURNING *`,
    [...Object.values(updates), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  res.json(rows[0]);
}));

app.delete('/api/quick-messages/:id', h(async (req, res) => {
  await q('DELETE FROM quick_messages WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Reordena de uma vez (recebe os ids na ordem desejada).
app.put('/api/quick-messages-order', h(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  for (const [i, id] of ids.entries()) {
    await q('UPDATE quick_messages SET sort_order = $1 WHERE id = $2', [i, id]);
  }
  res.json(await listQuickMessages());
}));

// --- Catálogo de produtos ---

app.get('/api/catalog', h(async (req, res) => res.json(await listCatalog())));

app.post('/api/catalog', h(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do produto.' });
  const { rows: max } = await q('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM catalog_products');
  const { rows } = await q(
    'INSERT INTO catalog_products (name, short_label, has_size, is_case, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [
      name.slice(0, 60),
      String(req.body?.short_label || name).trim().slice(0, 20),
      req.body?.has_size ? 1 : 0,
      req.body?.is_case ? 1 : 0,
      max[0].next
    ]
  );
  res.status(201).json(rows[0]);
}));

app.put('/api/catalog/:id', h(async (req, res) => {
  const updates = {};
  if ('name' in req.body) updates.name = String(req.body.name || '').trim().slice(0, 60);
  if ('short_label' in req.body) updates.short_label = String(req.body.short_label || '').trim().slice(0, 20);
  if ('has_size' in req.body) updates.has_size = req.body.has_size ? 1 : 0;
  if ('is_case' in req.body) updates.is_case = req.body.is_case ? 1 : 0;
  if ('sort_order' in req.body) updates.sort_order = Number(req.body.sort_order) || 0;
  if ('active' in req.body) updates.active = req.body.active ? 1 : 0;
  const fields = Object.keys(updates);
  if (!fields.length) return res.status(400).json({ error: 'Nada para atualizar.' });
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const { rows } = await q(
    `UPDATE catalog_products SET ${sets} WHERE id = $${fields.length + 1} RETURNING *`,
    [...Object.values(updates), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json(rows[0]);
}));

app.delete('/api/catalog/:id', h(async (req, res) => {
  // Desativa em vez de apagar: pedidos antigos guardam o nome do produto.
  await q('UPDATE catalog_products SET active = 0 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// --- Fotos ---

app.get('/api/photo-sets', h(async (req, res) => res.json(await listPhotoSets(req))));

app.post('/api/photo-sets', h(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do conjunto.' });
  const { rows: max } = await q('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM photo_sets');
  const { rows } = await q('INSERT INTO photo_sets (name, sort_order) VALUES ($1, $2) RETURNING *', [
    name.slice(0, 60),
    max[0].next
  ]);
  res.status(201).json({ ...rows[0], photos: [] });
}));

app.put('/api/photo-sets/:id', h(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome do conjunto.' });
  const { rows } = await q('UPDATE photo_sets SET name = $1 WHERE id = $2 RETURNING *', [name.slice(0, 60), req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Conjunto não encontrado.' });
  res.json(rows[0]);
}));

app.delete('/api/photo-sets/:id', h(async (req, res) => {
  const { rows: photos } = await q('SELECT * FROM photos WHERE set_id = $1', [req.params.id]);
  for (const photo of photos) {
    try {
      await deleteFile(photo.drive_file_id);
    } catch (err) {
      console.error('Falha ao excluir foto do Drive:', err.message);
    }
  }
  await q('DELETE FROM photos WHERE set_id = $1', [req.params.id]);
  await q('DELETE FROM photo_sets WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Inicia o upload da foto: o navegador manda o arquivo direto para o Drive.
app.post('/api/photo-sets/:id/photos/session', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM photo_sets WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Conjunto não encontrado.' });
  const { name, mimeType, size } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Informe o nome do arquivo.' });
  if (mimeType && !PHOTO_MIMES.includes(mimeType)) {
    return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WEBP.' });
  }
  try {
    const folderId = await ensurePhotosFolder();
    const uploadUrl = await createUploadSessionInFolder(folderId, { name, mimeType, size }, req.headers.origin);
    res.json({ uploadUrl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// Registra a foto depois que o navegador terminou o upload.
app.post('/api/photo-sets/:id/photos', h(async (req, res) => {
  const { rows: sets } = await q('SELECT * FROM photo_sets WHERE id = $1', [req.params.id]);
  if (!sets.length) return res.status(404).json({ error: 'Conjunto não encontrado.' });
  const fileId = req.body?.file_id;
  if (!fileId) return res.status(400).json({ error: 'Informe o file_id do Drive.' });
  const meta = await getFileMeta(fileId);
  const { rows: max } = await q('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM photos WHERE set_id = $1', [
    sets[0].id
  ]);
  const { rows } = await q(
    'INSERT INTO photos (set_id, drive_file_id, name, mime_type, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [sets[0].id, meta.id, meta.name, meta.mimeType || null, max[0].next]
  );
  res.status(201).json({ ...rows[0], url: `${baseUrl(req)}/api/photos/${rows[0].id}` });
}));

app.delete('/api/photos/:id', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM photos WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Foto não encontrada.' });
  try {
    await deleteFile(rows[0].drive_file_id);
  } catch (err) {
    console.error('Falha ao excluir do Drive (removendo só o registro):', err.message);
  }
  await q('DELETE FROM photos WHERE id = $1', [rows[0].id]);
  res.json({ ok: true });
}));

// ---------- Conversas acompanhadas (observador do WhatsApp) ----------

app.get('/api/watched-chats', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM watched_chats ORDER BY last_message_at DESC NULLS LAST, phone ASC');
  const { rows: counts } = await q('SELECT phone, COUNT(*)::int AS n FROM chat_messages GROUP BY phone');
  const map = new Map(counts.map((r) => [r.phone, r.n]));
  res.json(rows.map((r) => ({ ...r, messages_count: map.get(r.phone) || 0 })));
}));

app.get('/api/watched-chats/:phone', h(async (req, res) => {
  const phone = normalizePhone(req.params.phone) || String(req.params.phone).replace(/\D/g, '');
  const { rows } = await q('SELECT * FROM watched_chats WHERE phone = $1', [phone]);
  if (!rows.length) return res.json({ phone, watched: false });
  const { rows: messages } = await q(
    'SELECT * FROM chat_messages WHERE phone = $1 ORDER BY id ASC LIMIT 300',
    [phone]
  );
  res.json({ ...rows[0], watched: true, messages });
}));

app.put('/api/watched-chats/:phone', h(async (req, res) => {
  const phone = normalizePhone(req.params.phone) || String(req.params.phone).replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Telefone inválido.' });
  const { rows } = await q(
    `INSERT INTO watched_chats (phone, chat_name, added_by) VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET chat_name = COALESCE(EXCLUDED.chat_name, watched_chats.chat_name)
     RETURNING *`,
    [phone, req.body?.name ? String(req.body.name).slice(0, 120) : null, currentUser(req)]
  );
  res.json({ ...rows[0], watched: true });
}));

app.delete('/api/watched-chats/:phone', h(async (req, res) => {
  const phone = normalizePhone(req.params.phone) || String(req.params.phone).replace(/\D/g, '');
  await q('DELETE FROM watched_chats WHERE phone = $1', [phone]);
  res.json({ ok: true, watched: false });
}));

// --- Arquivos recebidos que ainda não têm pedido ---

app.get('/api/inbox-files', h(async (req, res) => {
  const { rows } = await q(
    'SELECT * FROM chat_files WHERE attached_order_id IS NULL ORDER BY created_at DESC, id DESC'
  );
  res.json(rows);
}));

// Move o arquivo da caixa de entrada para um pedido (vira anexo dele).
app.post('/api/inbox-files/:id/attach', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM chat_files WHERE id = $1', [req.params.id]);
  const file = rows[0];
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  if (file.attached_order_id) return res.status(400).json({ error: 'Esse arquivo já foi anexado a um pedido.' });
  const order = await getOrder(req.body?.order_id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const category = req.body?.category === 'nota_fiscal' ? 'nota_fiscal' : 'arquivo';
  const { rows: created } = await q(
    `INSERT INTO attachments (order_id, drive_file_id, name, mime_type, size, web_view_link, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [order.id, file.drive_file_id, file.name, file.mime_type, file.size, file.web_view_link, category]
  );
  await q('UPDATE chat_files SET attached_order_id = $1 WHERE id = $2', [order.id, file.id]);
  res.status(201).json(created[0]);
}));

app.delete('/api/inbox-files/:id', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM chat_files WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  try {
    await deleteFile(rows[0].drive_file_id);
  } catch (err) {
    console.error('Falha ao excluir do Drive (removendo só o registro):', err.message);
  }
  await q('DELETE FROM chat_files WHERE id = $1', [rows[0].id]);
  res.json({ ok: true });
}));

// ---------- Sugestões do analista ----------

function serializeSuggestion(row) {
  let data = {};
  try {
    data = JSON.parse(row.data || '{}');
  } catch {
    data = {};
  }
  return { ...row, data, stage_label: STAGES[row.stage] || row.stage || null };
}

app.get('/api/suggestions', h(async (req, res) => {
  const status = req.query.status === 'todas' ? null : req.query.status || 'pendente';
  const { rows } = await q(
    status
      ? 'SELECT * FROM order_suggestions WHERE status = $1 ORDER BY created_at DESC, id DESC'
      : 'SELECT * FROM order_suggestions ORDER BY created_at DESC, id DESC',
    status ? [status] : []
  );
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const orderMap = new Map();
  for (const id of orderIds) {
    const order = await getOrder(id);
    if (order) orderMap.set(id, serializeOrder(order));
  }
  res.json(rows.map((r) => ({ ...serializeSuggestion(r), order: orderMap.get(r.order_id) || null })));
}));

// Roda o analista na hora (o botão "Analisar agora").
app.post('/api/watched-chats/:phone/analyze', h(async (req, res) => {
  const phone = normalizePhone(req.params.phone) || String(req.params.phone).replace(/\D/g, '');
  const result = await analyzeChat(phone, { force: true });
  res.json(result.suggestion ? { ...result, suggestion: serializeSuggestion(result.suggestion) } : result);
}));

// Aceitar: cria o pedido sugerido, ou manda o pedido existente para produção
// quando a sugestão é de arte aprovada.
app.post('/api/suggestions/:id/accept', h(async (req, res) => {
  const { rows } = await q('SELECT * FROM order_suggestions WHERE id = $1', [req.params.id]);
  const suggestion = rows[0];
  if (!suggestion) return res.status(404).json({ error: 'Sugestão não encontrada.' });
  if (suggestion.status !== 'pendente') return res.status(400).json({ error: 'Essa sugestão já foi resolvida.' });

  const user = currentUser(req);
  const data = serializeSuggestion(suggestion).data;

  if (suggestion.kind === 'arte_aprovada') {
    const order = await getOrder(suggestion.order_id);
    if (!order) return res.status(404).json({ error: 'O pedido dessa sugestão não existe mais.' });
    await q(
      "UPDATE orders SET status = 'producao', delivered_at = NULL, updated_at = now(), updated_by = $2 WHERE id = $1",
      [order.id, user]
    );
    await q(
      'INSERT INTO order_comments (order_id, author, body) VALUES ($1, $2, $3)',
      [order.id, user, `Arte aprovada pelo cliente no WhatsApp.${data.evidencia ? `\n"${data.evidencia}"` : ''}`]
    );
    await q(
      "UPDATE order_suggestions SET status = 'aceita', resolved_at = now(), resolved_by = $2 WHERE id = $1",
      [suggestion.id, user]
    );
    return res.json({ ok: true, order: serializeOrder(await getOrder(order.id)) });
  }

  // Novo pedido: o corpo pode trazer correções feitas por você na tela.
  const body = req.body || {};
  const customerName = String(body.customer_name || data.cliente || suggestion.chat_name || '').trim();
  if (!customerName) return res.status(400).json({ error: 'Informe o nome do cliente.' });

  const descricao = [data.descricao, data.quantidade ? `Quantidade: ${data.quantidade}` : null]
    .filter(Boolean)
    .join('\n');

  const order = await createOrder(
    {
      customer_name: customerName,
      phone: suggestion.phone,
      description: body.description ?? descricao ?? null,
      product: body.product ?? data.produto ?? null,
      size: body.size ?? data.tamanho ?? null,
      value: body.value ?? data.valor ?? null,
      due_date: body.due_date ?? data.prazo ?? null
    },
    user
  );

  // Arquivos já recebidos deste cliente passam a ser anexos do pedido novo.
  const { rows: pendingFiles } = await q(
    'SELECT * FROM chat_files WHERE phone = $1 AND attached_order_id IS NULL',
    [suggestion.phone]
  );
  for (const file of pendingFiles) {
    await q(
      `INSERT INTO attachments (order_id, drive_file_id, name, mime_type, size, web_view_link, category)
       VALUES ($1, $2, $3, $4, $5, $6, 'material')`,
      [order.id, file.drive_file_id, file.name, file.mime_type, file.size, file.web_view_link]
    );
    await q('UPDATE chat_files SET attached_order_id = $1 WHERE id = $2', [order.id, file.id]);
  }

  await q(
    "UPDATE order_suggestions SET status = 'aceita', order_id = $2, resolved_at = now(), resolved_by = $3 WHERE id = $1",
    [suggestion.id, order.id, user]
  );
  res.status(201).json({ ok: true, order: serializeOrder(order), attached_files: pendingFiles.length });
}));

app.post('/api/suggestions/:id/dismiss', h(async (req, res) => {
  const { rowCount } = await q(
    "UPDATE order_suggestions SET status = 'descartada', resolved_at = now(), resolved_by = $2 WHERE id = $1 AND status = 'pendente'",
    [req.params.id, currentUser(req)]
  );
  if (!rowCount) return res.status(404).json({ error: 'Sugestão não encontrada ou já resolvida.' });
  res.json({ ok: true });
}));

// ---------- Upload da área de trabalho (arquivos do CorelDRAW) ----------
//
// O arquivo NÃO passa pelo servidor: devolvemos uma URL de upload do Google e
// o programinha manda direto para lá. Isso evita o limite de tamanho da Vercel.

// Descobre o pedido pelo começo do nome do arquivo ("0042 - fulano.cdr").
async function orderFromFileName(name) {
  const m = String(name || '').match(/^\s*#?(\d{1,6})/);
  if (!m) return null;
  const order = await getOrder(Number(m[1]));
  return order && !order.archived ? order : null;
}

app.post('/api/uploads/session', h(async (req, res) => {
  const { name, mimeType, size } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Informe o nome do arquivo.' });

  // Pedido explícito no corpo tem prioridade; senão tenta pelo nome do arquivo.
  let order = null;
  if (req.body?.order_id) order = await getOrder(req.body.order_id);
  if (!order) order = await orderFromFileName(name);

  try {
    const folderId = order ? await ensureOrderFolder(order) : await ensureInboxFolder();
    const uploadUrl = await createUploadSessionInFolder(folderId, { name, mimeType, size }, req.headers.origin);
    res.json({
      uploadUrl,
      order_id: order?.id || null,
      order_number: order ? formatOrderNumber(order.id) : null,
      target: order ? `pedido ${formatOrderNumber(order.id)}` : 'recebidos'
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// Registra o arquivo depois que o upload terminou. Se já existir outro com o
// mesmo nome no mesmo pedido, o antigo é substituído (o CorelDRAW salva várias
// vezes e não queremos 15 cópias do mesmo trabalho).
app.post('/api/uploads/register', h(async (req, res) => {
  const fileId = req.body?.file_id;
  if (!fileId) return res.status(400).json({ error: 'Informe o file_id do Drive.' });
  const meta = await getFileMeta(fileId);
  const order = req.body?.order_id ? await getOrder(req.body.order_id) : null;

  if (order) {
    const { rows: previous } = await q(
      'SELECT * FROM attachments WHERE order_id = $1 AND name = $2 AND drive_file_id <> $3',
      [order.id, meta.name, meta.id]
    );
    for (const old of previous) {
      try {
        await deleteFile(old.drive_file_id);
      } catch (err) {
        console.error('Falha ao excluir versão anterior no Drive:', err.message);
      }
      await q('DELETE FROM attachments WHERE id = $1', [old.id]);
    }
    const { rows } = await q(
      `INSERT INTO attachments (order_id, drive_file_id, name, mime_type, size, web_view_link, category)
       VALUES ($1, $2, $3, $4, $5, $6, 'arte') RETURNING *`,
      [order.id, meta.id, meta.name, meta.mimeType || null, meta.size ? Number(meta.size) : null, meta.webViewLink || null]
    );
    return res.status(201).json({ ...rows[0], replaced: previous.length, order_number: formatOrderNumber(order.id) });
  }

  const { rows } = await q(
    `INSERT INTO chat_files (phone, chat_name, drive_file_id, name, mime_type, size, web_view_link)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      'arquivo-local',
      req.body?.source || 'Computador',
      meta.id,
      meta.name,
      meta.mimeType || null,
      meta.size ? Number(meta.size) : null,
      meta.webViewLink || null
    ]
  );
  res.status(201).json(rows[0]);
}));

// ---------- Configurações ----------

// ---------- Hermes: painel de controle (login do sistema) ----------

app.get('/api/hermes/config', h(async (req, res) => {
  const s = await getSettings();
  const { rows } = await q('SELECT COUNT(*)::int AS n FROM hermes_events');
  res.json({
    enabled: s.hermes_enabled === '1',
    token: s.hermes_token || '',
    webhook_url: s.hermes_webhook_url || '',
    engine: s.bot_engine || 'interno',
    base_url: baseUrl(req),
    endpoints: {
      ping: `${baseUrl(req)}/api/hermes/ping`,
      tools: `${baseUrl(req)}/api/hermes/tools`,
      call: `${baseUrl(req)}/api/hermes/call`
    },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    eventos: rows[0]?.n || 0
  });
}));

app.put('/api/hermes/config', h(async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if ('enabled' in body) patch.hermes_enabled = body.enabled ? '1' : '0';
  if ('webhook_url' in body) patch.hermes_webhook_url = String(body.webhook_url || '').trim();
  if ('engine' in body) {
    if (!['interno', 'hermes', 'off'].includes(body.engine)) {
      return res.status(400).json({ error: 'Pré-atendimento inválido. Use: interno, hermes ou off.' });
    }
    patch.bot_engine = body.engine;
  }
  await setSettings(patch);
  res.json({ ok: true });
}));

// Gera uma chave nova (a antiga para de funcionar na hora).
app.post('/api/hermes/rotate-token', h(async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  await setSettings({ hermes_token: token });
  res.json({ token });
}));

// Bate na VPS para conferir se o webhook do Hermes responde.
app.post('/api/hermes/test', h(async (req, res) => {
  const s = await getSettings();
  if (!s.hermes_webhook_url) return res.status(400).json({ error: 'Informe a URL do webhook do Hermes.' });
  if (s.hermes_enabled !== '1') return res.status(400).json({ error: 'Ligue a conexão com o Hermes antes de testar.' });
  res.json(await notifyHermes('teste', { mensagem: 'Teste de conexão do sistema Classul.' }));
}));

app.get('/api/hermes/events', h(async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const { rows } = await q('SELECT * FROM hermes_events ORDER BY id DESC LIMIT $1', [limit]);
  res.json(rows);
}));

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
