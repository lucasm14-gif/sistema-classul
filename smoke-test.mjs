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

// ---------- Código de retirada ----------

r = await fetch(`${B}/orders`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ customer_name: 'Pedido Código', phone: '(51) 97777-6666' })
});
const codeOrder = await r.json();
check('pedido ganha código de retirada de 4 dígitos', /^\d{4}$/.test(codeOrder.pickup_code || ''), codeOrder.pickup_code);

r = await fetch(`${B}/orders/${codeOrder.id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'pronto' }) });
await r.json();
r = await fetch(`${B}/orders/${codeOrder.id}`, { headers: H });
const codeFull = await r.json();
check(
  'mensagem de pronto renderiza {codigo}',
  (codeFull.messages[0]?.body || '').includes(codeOrder.pickup_code),
  (codeFull.messages[0]?.body || '').match(/Código de retirada: \d{4}/)?.[0] || 'não encontrado'
);

// ---------- Funcionários, comentários e atribuição ----------

const HU = { ...H, 'X-Classul-User': 'Lucas' };

// pedido criado registra o autor
r = await fetch(`${B}/orders`, { method: 'POST', headers: HU, body: JSON.stringify({ customer_name: 'Cliente Autor' }) });
const authored = await r.json();
check('pedido registra created_by/updated_by', authored.created_by === 'Lucas' && authored.updated_by === 'Lucas');

// mover por outro funcionário atualiza updated_by
r = await fetch(`${B}/orders/${authored.id}/status`, {
  method: 'PATCH',
  headers: { ...H, 'X-Classul-User': 'Maria' },
  body: JSON.stringify({ status: 'producao' })
});
check('mover atualiza updated_by', (await r.json()).order.updated_by === 'Maria');

// funcionários
r = await fetch(`${B}/employees`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Lucas', color: '#4a9c33' }) });
check('criar funcionário', (await r.json()).name === 'Lucas');
r = await fetch(`${B}/employees`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'lucas' }) });
check('funcionário duplicado não cria outro', r.status === 200);
r = await fetch(`${B}/employees`, { headers: H });
check('listar funcionários', (await r.json()).length === 1);

// comentários
r = await fetch(`${B}/orders/${authored.id}/comments`, { method: 'POST', headers: HU, body: JSON.stringify({ body: 'Cliente quer entrega rápida' }) });
const comment = await r.json();
check('criar comentário com autor', comment.author === 'Lucas' && comment.body.includes('entrega'));
r = await fetch(`${B}/orders/${authored.id}`, { headers: H });
check('comentário aparece no pedido', (await r.json()).comments.length === 1);

// etiquetas de conversa
r = await fetch(`${B}/chats/5551999998888`, { method: 'PUT', headers: H, body: JSON.stringify({ employee: 'Lucas', status: 'atendendo' }) });
check('marcar conversa', (await r.json()).employee === 'Lucas');
r = await fetch(`${B}/chats/(51)99999-8888`, { headers: H });
check('ler etiqueta (telefone normalizado)', (await r.json()).employee === 'Lucas');
r = await fetch(`${B}/chats`, { headers: H });
check('listar etiquetas', (await r.json()).length === 1);
r = await fetch(`${B}/chats/5551999998888`, { method: 'DELETE', headers: H });
check('limpar etiqueta', (await r.json()).ok === true);

// etiqueta por nome (contato salvo, sem telefone) guarda o nome da conversa
r = await fetch(`${B}/chats/${encodeURIComponent('n_moises casa')}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ employee: 'Maria', status: 'atendendo', name: 'moises casa' })
});
const named = await r.json();
check('etiqueta por nome guarda chat_name', named.employee === 'Maria' && named.chat_name === 'moises casa');
r = await fetch(`${B}/chats`, { headers: H });
const allChats = await r.json();
check('listagem inclui chat_name', allChats.some((c) => c.chat_name === 'moises casa'));
await fetch(`${B}/chats/${encodeURIComponent('n_moises casa')}`, { method: 'DELETE', headers: H });

// ---------- Leads do WhatsApp (cliques do site) ----------

// tracking é público (sem Bearer) e aceita form-urlencoded (sendBeacon), com UTMs
r = await fetch(`${B}/leads/track`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    page: '/produto/placa-de-homenagem',
    label: 'Chamar no WhatsApp',
    utm_source: 'instagram',
    utm_campaign: 'dia-das-maes'
  })
});
check('registrar lead sem Bearer (204)', r.status === 204);

// também aceita JSON; sem UTM mas com referrer externo → origem pelo domínio
await fetch(`${B}/leads/track`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ page: '/', label: 'Enviar mensagem', referrer: 'https://www.google.com/search?q=placa' })
});

r = await fetch(`${B}/leads`, { headers: H });
const leads = await r.json();
check('estatísticas de leads', leads.total === 2 && leads.today === 2 && leads.last30 === 2, JSON.stringify({ total: leads.total, today: leads.today }));
check('série tem 30 dias', Array.isArray(leads.series) && leads.series.length === 30);
check(
  'top_pages agrupa por página',
  leads.top_pages.some((p) => p.page === '/produto/placa-de-homenagem' && p.count === 1) &&
    leads.top_pages.some((p) => p.page === '/' && p.page_label === 'Página inicial'),
  JSON.stringify(leads.top_pages)
);
check(
  'top_sources: UTM com campanha e domínio do referrer',
  leads.top_sources.some((s) => s.source === 'instagram · dia-das-maes' && s.count === 1) &&
    leads.top_sources.some((s) => s.source === 'google.com' && s.count === 1),
  JSON.stringify(leads.top_sources)
);
check('recentes trazem os cliques com origem', leads.recent.length === 2 && leads.recent.some((r2) => r2.source));
r = await fetch(`${B}/leads`);
check('leads exige Bearer', r.status === 401);


// ---- Área pessoal do Lucas (missões e rotinas com trava por PIN) ----

r = await fetch(`${B}/lucas/status`, { headers: H });
let lucas = await r.json();
check('lucas: começa sem PIN', lucas.has_pin === false);

r = await fetch(`${B}/lucas/overview`, { headers: H });
let lucasBody = await r.json();
check('lucas: sem PIN a área fica trancada', r.status === 403 && lucasBody.lucas_locked === true);

r = await fetch(`${B}/lucas/pin`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '123' }) });
check('lucas: PIN curto é recusado', r.status === 400);

r = await fetch(`${B}/lucas/pin`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '4242' }) });
const lucasToken = (await r.json()).token;
check('lucas: cria o PIN e devolve token', r.status === 200 && Boolean(lucasToken));

r = await fetch(`${B}/lucas/unlock`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '0000' }) });
check('lucas: PIN errado não destrava', r.status === 403);

r = await fetch(`${B}/lucas/unlock`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '4242' }) });
check('lucas: PIN certo destrava com o mesmo token', (await r.json()).token === lucasToken);

r = await fetch(`${B}/lucas/overview`, { headers: { ...H, 'X-Lucas-Token': 'token-errado' } });
check('lucas: token inválido continua trancado', r.status === 403);

const LH = { ...H, 'X-Lucas-Token': lucasToken };

r = await fetch(`${B}/lucas/tasks`, { method: 'POST', headers: LH, body: JSON.stringify({ title: '' }) });
check('lucas: missão sem nome é recusada', r.status === 400);

r = await fetch(`${B}/lucas/tasks`, {
  method: 'POST',
  headers: LH,
  body: JSON.stringify({ title: 'Fechar orçamento', priority: 'critica', due_date: '2020-01-01' })
});
const task = await r.json();
check('lucas: cria missão', r.status === 201 && task.priority === 'critica' && task.done_at === null);

await fetch(`${B}/lucas/tasks`, {
  method: 'POST',
  headers: LH,
  body: JSON.stringify({ title: 'Prioridade inventada', priority: 'urgentissima' })
});

r = await fetch(`${B}/lucas/routines`, {
  method: 'POST',
  headers: LH,
  body: JSON.stringify({ title: 'Treino', time_of_day: '06:30', days: '0123456' })
});
const routine = await r.json();
check('lucas: cria rotina', r.status === 201 && routine.days === '0123456');

r = await fetch(`${B}/lucas/routines/${routine.id}/check`, { method: 'POST', headers: LH, body: JSON.stringify({}) });
const checked = await r.json();
check('lucas: marca rotina hoje', checked.ok === true && /^\d{4}-\d{2}-\d{2}$/.test(checked.day));
// marcar de novo não duplica
await fetch(`${B}/lucas/routines/${routine.id}/check`, { method: 'POST', headers: LH, body: JSON.stringify({}) });

r = await fetch(`${B}/lucas/overview`, { headers: LH });
const overview = await r.json();
check('lucas: prioridade inválida vira média', overview.tasks.some((t) => t.priority === 'media'));
check(
  'lucas: rotina cumprida hoje entra na contagem',
  overview.stats.routines_today === 1 && overview.stats.routines_done === 1,
  JSON.stringify(overview.stats)
);
check('lucas: histórico de 28 dias por rotina', overview.routines[0].history.length === 28 && overview.routines[0].streak === 1);
check('lucas: missão com prazo velho conta como atrasada', overview.stats.tasks_late === 1);

r = await fetch(`${B}/lucas/tasks/${task.id}`, { method: 'PUT', headers: LH, body: JSON.stringify({ status: 'concluida' }) });
const doneTask = await r.json();
check('lucas: concluir missão grava a data', doneTask.status === 'concluida' && Boolean(doneTask.done_at));

r = await fetch(`${B}/lucas/tasks/${task.id}`, { method: 'PUT', headers: LH, body: JSON.stringify({ status: 'aberta' }) });
check('lucas: reabrir missão limpa a data', (await r.json()).done_at === null);

r = await fetch(`${B}/lucas/routines/${routine.id}/check`, {
  method: 'POST',
  headers: LH,
  body: JSON.stringify({ done: false })
});
check('lucas: desmarca rotina', r.status === 200);
r = await fetch(`${B}/lucas/overview`, { headers: LH });
check('lucas: contagem volta a zero', (await r.json()).stats.routines_done === 0);

r = await fetch(`${B}/lucas/routines/${routine.id}`, { method: 'DELETE', headers: LH });
check('lucas: apaga rotina', r.status === 200);

r = await fetch(`${B}/settings`, { headers: H });
const settingsAfter = await r.json();
check('lucas: hash do PIN não vaza nas configurações', settingsAfter.lucas_pin_hash === undefined);

r = await fetch(`${B}/lucas/overview`, { headers: { 'Content-Type': 'application/json', 'X-Lucas-Token': lucasToken } });
check('lucas: token do PIN não substitui o login', r.status === 401);

server.close();
console.log('\nFim dos testes.');
