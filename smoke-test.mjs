// Smoke test da API serverless (Vercel) usando Postgres em memória (pg-mem).
process.env.API_TOKEN = 'teste-token';
process.env.EVOLUTION_URL = 'https://evolution.scalemidia.com.br';
process.env.EVOLUTION_APIKEY = 'fake';
process.env.EVOLUTION_INSTANCE = '';

import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests } = await import(`file://${ROOT}/lib/db.js`);
const { default: app } = await import(`file://${ROOT}/api/index.js`);

const mem = newDb();
const pgAdapter = mem.adapters.createPg();
_setPoolForTests(new pgAdapter.Pool());

const server = app.listen(3111);
const B = 'http://localhost:3111/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

// health sem auth
let r = await fetch(`${B}/health`);
check('health', r.status === 200);

// 401 sem token
r = await fetch(`${B}/orders`);
check('401 sem token', r.status === 401);

// criar pedido
r = await fetch(`${B}/orders`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    customer_name: 'João da Silva',
    phone: '(51) 99999-8888',
    product_type: 'Maquina',
    value: '150,00',
    due_date: '2026-07-20'
  })
});
let order = await r.json();
check('criar pedido', r.status === 201 && order.order_number === '#0001', JSON.stringify(order).slice(0, 120));
check('telefone normalizado', order.phone === '5551999998888', order.phone);

// listar
r = await fetch(`${B}/orders`, { headers: H });
let list = await r.json();
check('listar pedidos', Array.isArray(list) && list.length === 1);

// editar
r = await fetch(`${B}/orders/1`, { method: 'PUT', headers: H, body: JSON.stringify({ value: '199,90', case_color: 'Azul' }) });
let edited = await r.json();
check('editar pedido', edited.value === '199,90' && edited.case_color === 'Azul');

// mover para producao (sem mensagem)
r = await fetch(`${B}/orders/1/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'producao' }) });
let moved = await r.json();
check('mover p/ producao', moved.order.status === 'producao' && moved.notification.skipped === true);

// mover para pronto (tenta WhatsApp — Evolution não configurada => error registrado)
r = await fetch(`${B}/orders/1/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'pronto' }) });
moved = await r.json();
check(
  'mover p/ pronto tenta WhatsApp',
  moved.order.status === 'pronto' && moved.notification.sent === false && /Evolution/.test(moved.notification.error || ''),
  moved.notification.error
);

// histórico de mensagens no pedido
r = await fetch(`${B}/orders/1`, { headers: H });
let full = await r.json();
check('log de mensagem registrado', full.messages.length === 1 && full.messages[0].success === 0);

// settings
r = await fetch(`${B}/settings`, { headers: H });
let settings = await r.json();
check('settings seed do env', settings.evolution_url === 'https://evolution.scalemidia.com.br');

r = await fetch(`${B}/settings`, { method: 'PUT', headers: H, body: JSON.stringify({ evolution_instance: 'classul Notion', chave_invalida: 'x' }) });
settings = await r.json();
check('salvar settings (e ignorar chave inválida)', settings.evolution_instance === 'classul Notion' && !('chave_invalida' in settings));

// arquivar
r = await fetch(`${B}/orders/1/archive`, { method: 'PATCH', headers: H, body: JSON.stringify({ archived: true }) });
let archived = await r.json();
check('arquivar', archived.archived === 1);
r = await fetch(`${B}/orders?archived=1`, { headers: H });
list = await r.json();
check('listar arquivados', list.length === 1);

// excluir
r = await fetch(`${B}/orders/1`, { method: 'DELETE', headers: H });
check('excluir', (await r.json()).ok === true);

// ---------- Clientes ----------

r = await fetch(`${B}/clients`, { headers: H });
let clientsList = await r.json();
check(
  'cliente auto-criado pelo pedido',
  clientsList.length === 1 && clientsList[0].name === 'João da Silva' && clientsList[0].phone === '5551999998888',
  clientsList.map((c) => c.name).join(', ')
);

// novo pedido com o mesmo telefone → vincula ao cliente existente
r = await fetch(`${B}/orders`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ customer_name: 'Joao (obra nova)', phone: '51 99999-8888' })
});
const o2 = await r.json();
check('pedido vinculado ao cliente existente pelo telefone', o2.client_id === clientsList[0].id);

r = await fetch(`${B}/clients/${clientsList[0].id}`, { headers: H });
const detail = await r.json();
check('histórico de pedidos do cliente', detail.orders.length === 1 && detail.orders[0].id === o2.id);

// CRUD manual de cliente
r = await fetch(`${B}/clients`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ name: 'Fulano Teste', phone: '(51) 98888-7777', company: 'ACME' })
});
const manual = await r.json();
check('criar cliente manual (telefone normalizado)', r.status === 201 && manual.phone === '5551988887777');

r = await fetch(`${B}/clients?search=acme`, { headers: H });
check('busca de cliente por empresa', (await r.json()).length === 1);

r = await fetch(`${B}/clients/${manual.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ email: 'fulano@acme.com' }) });
check('editar cliente', (await r.json()).email === 'fulano@acme.com');

r = await fetch(`${B}/clients/${manual.id}`, { method: 'DELETE', headers: H });
check('excluir cliente', (await r.json()).ok === true);

// ---------- Google Drive / anexos ----------

r = await fetch(`${B}/google/status`, { headers: H });
const gs = await r.json();
check('drive status (não configurado)', gs.configured === false && gs.connected === false);

r = await fetch(`${B}/google/auth-url`, { headers: H });
check('auth-url exige credenciais', r.status === 400);

r = await fetch(`${B}/orders/${o2.id}/attachments/session`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ name: 'arte-final.png', mimeType: 'image/png', size: 1234 })
});
check('upload exige Drive conectado', r.status === 400 && /Google Drive/.test((await r.json()).error || ''));

r = await fetch(`${B}/orders/${o2.id}`, { headers: H });
const withAtt = await r.json();
check('pedido devolve lista de anexos', Array.isArray(withAtt.attachments) && withAtt.attachments.length === 0);

r = await fetch(`${B}/orders`, { headers: H });
check('lista de pedidos tem attachments_count', (await r.json()).every((o) => 'attachments_count' in o));

// ---------- Faturamento / nota fiscal ----------

// entrega o pedido o2 → delivered_at registrado e has_invoice false
r = await fetch(`${B}/orders/${o2.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'entregue' }) });
const deliveredResp = await r.json();
check(
  'entregar registra delivered_at e has_invoice',
  Boolean(deliveredResp.order.delivered_at) && deliveredResp.order.has_invoice === false
);

// dá um valor ao pedido para o faturamento
await fetch(`${B}/orders/${o2.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ value: '250,00' }) });

r = await fetch(`${B}/stats`, { headers: H });
const stats = await r.json();
check(
  'stats do mês atual',
  stats.month.count === 1 && stats.month.total === 250 && stats.months.length === 6,
  `total=${stats.month.total} count=${stats.month.count}`
);
check('stats: NF pendente listada', stats.pending_invoices.length === 1 && stats.pending_invoices[0].id === o2.id);
check('stats: pedidos em aberto zerados', stats.open.count === 0);

// sessão de upload de NF exige categoria válida e Drive conectado
r = await fetch(`${B}/orders/${o2.id}/attachments/session`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ name: 'nota.pdf', mimeType: 'application/pdf', size: 100, category: 'nota_fiscal' })
});
check('sessão NF sem Drive conectado → erro claro', r.status === 400 && /Google Drive/.test((await r.json()).error || ''));

// voltar o pedido para o quadro limpa delivered_at
r = await fetch(`${B}/orders/${o2.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'pronto' }) });
check('sair de entregue limpa delivered_at', (await r.json()).order.delivered_at === null);

r = await fetch(`${B}/stats`, { headers: H });
check('stats zera após reverter entrega', (await r.json()).month.count === 0);

// ---------- Status de pagamento ----------

r = await fetch(`${B}/orders/${o2.id}`, { headers: H });
check('pedido nasce com pagamento pendente', (await r.json()).payment_status === 'pendente');

r = await fetch(`${B}/orders/${o2.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ payment_status: 'invalido' }) });
check('status de pagamento inválido → 400', r.status === 400);

r = await fetch(`${B}/orders/${o2.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ payment_status: 'pago' }) });
check('marcar como pago', (await r.json()).payment_status === 'pago');

// pedido pago e entregue conta em month.paid; a receber zera
await fetch(`${B}/orders/${o2.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'entregue' }) });
r = await fetch(`${B}/stats`, { headers: H });
let payStats = await r.json();
check(
  'stats: recebido no mês e a receber',
  payStats.month.paid === 250 && payStats.receivable.count === 0,
  `paid=${payStats.month.paid} receivable=${payStats.receivable.count}`
);

// novo pedido com sinal entra no a receber
r = await fetch(`${B}/orders`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ customer_name: 'Pedido Sinal', value: '100,00', payment_status: 'sinal' })
});
const sinalOrder = await r.json();
check('criar pedido com sinal', sinalOrder.payment_status === 'sinal');
r = await fetch(`${B}/stats`, { headers: H });
payStats = await r.json();
check('a receber inclui pedido com sinal', payStats.receivable.count === 1 && payStats.receivable.total === 100);

server.close();
console.log('\nFim dos testes.');
