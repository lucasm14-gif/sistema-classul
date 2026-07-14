// Smoke test contra o banco REAL (DATABASE_URL) — usado para validar o Supabase.
// Evolution fica desconfigurada de propósito: nenhuma mensagem real é enviada.
// Uso: DATABASE_URL=... node smoke-test-real-db.mjs

process.env.API_TOKEN = 'teste-token';
process.env.EVOLUTION_URL = '';
process.env.EVOLUTION_APIKEY = '';
process.env.EVOLUTION_INSTANCE = '';

if (!process.env.DATABASE_URL) {
  console.error('Defina DATABASE_URL');
  process.exit(1);
}

const { default: app } = await import('./api/index.js');
const { q, getPool } = await import('./lib/db.js');

const server = app.listen(3112);
const B = 'http://localhost:3112/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

let r = await fetch(`${B}/health`);
check('health', r.status === 200);

r = await fetch(`${B}/orders`);
check('401 sem token', r.status === 401);

r = await fetch(`${B}/orders`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    customer_name: 'Pedido Teste (pode apagar)',
    phone: '(51) 99999-8888',
    product_type: 'Maquina',
    value: '150,00',
    due_date: '2026-07-20'
  })
});
const order = await r.json();
check('criar pedido no Supabase', r.status === 201 && order.id > 0, order.order_number);
check('telefone normalizado', order.phone === '5551999998888', order.phone);

r = await fetch(`${B}/orders/${order.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'pronto' }) });
const moved = await r.json();
check(
  'mover p/ pronto tenta WhatsApp (sem enviar de verdade)',
  moved.order.status === 'pronto' && moved.notification.sent === false && /Evolution/.test(moved.notification.error || ''),
  moved.notification.error
);

r = await fetch(`${B}/orders/${order.id}`, { headers: H });
const full = await r.json();
check('log de mensagem registrado', full.messages.length === 1 && Number(full.messages[0].success) === 0);

r = await fetch(`${B}/orders/${order.id}`, { method: 'DELETE', headers: H });
check('excluir pedido de teste', (await r.json()).ok === true);

r = await fetch(`${B}/orders`, { headers: H });
check('quadro vazio ao final', (await r.json()).length === 0);

// Zera a sequência para o primeiro pedido real ser #0001
await q("SELECT setval('orders_id_seq', 1, false)");
await q("SELECT setval('message_log_id_seq', 1, false)");
console.log('🔄 Sequências reiniciadas (primeiro pedido real será #0001)');

server.close();
await getPool().end();
console.log('\nFim dos testes.');
