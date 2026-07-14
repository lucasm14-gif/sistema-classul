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

server.close();
console.log('\nFim dos testes.');
