// Testa a conexão com o Hermes: chave própria, catálogo de ferramentas,
// execução das ferramentas e os avisos que o sistema manda para a VPS.
// Nada sai para a internet: a Evolution é mockada e o "Hermes" é um
// servidorzinho local que guarda o que recebeu.
process.env.API_TOKEN = 'teste-token';

import http from 'node:http';
import crypto from 'node:crypto';
import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests, setSettings, ensureSchema } = await import(`file://${ROOT}/lib/db.js`);

const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());

const { default: app } = await import(`file://${ROOT}/api/index.js`);

// --- Evolution mockada; localhost (sistema e Hermes falso) passa reto ---
const realFetch = globalThis.fetch;
const sentMessages = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/message/sendText/')) {
    sentMessages.push(JSON.parse(opts.body).text);
    return { ok: true, json: async () => ({ key: { id: 'WA' + sentMessages.length } }) };
  }
  if (u.includes('evolution.exemplo.com')) return { ok: true, json: async () => ({}) };
  return realFetch(url, opts);
};

// --- Hermes falso: guarda cada evento que o sistema mandar ---
const recebidos = [];
const hermes = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    recebidos.push({ headers: req.headers, body: JSON.parse(body || '{}'), raw: body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => hermes.listen(3131, r));
const HERMES_URL = 'http://localhost:3131/webhook';

const server = app.listen(3130);
const B = 'http://localhost:3130/api';
const ADMIN = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };
const CHAVE = 'chave-do-hermes-123';
const HER = { 'Content-Type': 'application/json', Authorization: `Bearer ${CHAVE}` };

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};
const call = async (tool, args = {}, headers = HER) => {
  const r = await fetch(`${B}/hermes/call`, { method: 'POST', headers, body: JSON.stringify({ tool, args }) });
  return { status: r.status, body: await r.json() };
};

await ensureSchema();
await setSettings({
  hermes_token: CHAVE,
  hermes_enabled: '0',
  hermes_webhook_url: HERMES_URL,
  bot_webhook_secret: 'segredo123',
  evolution_url: 'https://evolution.exemplo.com',
  evolution_apikey: 'fake',
  evolution_instance: 'classul',
  msg_pronto_enabled: '1'
});

// ---------------------------------------------------------------- 1. acesso
let r = await fetch(`${B}/hermes/ping`);
check('sem chave o Hermes não entra', r.status === 401);

r = await fetch(`${B}/hermes/ping`, { headers: { Authorization: 'Bearer chave-errada' } });
check('chave errada é recusada', r.status === 401);

r = await fetch(`${B}/hermes/ping`, { headers: HER });
check('com a conexão desligada não responde nem com a chave certa', r.status === 403);

// liga pelo painel (login do sistema)
r = await fetch(`${B}/hermes/config`, {
  method: 'PUT',
  headers: ADMIN,
  body: JSON.stringify({ enabled: true, webhook_url: HERMES_URL })
});
check('painel liga a conexão', (await r.json()).ok === true);

r = await fetch(`${B}/hermes/ping`, { headers: HER });
let ping = await r.json();
check('ping responde depois de ligado', r.status === 200 && ping.ok === true, `${ping.ferramentas} ferramentas`);

r = await fetch(`${B}/hermes/ping`, { headers: { 'X-Hermes-Token': CHAVE } });
check('header X-Hermes-Token também serve', (await r.json()).ok === true);

// ------------------------------------------------------------ 2. ferramentas
r = await fetch(`${B}/hermes/tools`, { headers: HER });
const tools = (await r.json()).tools;
check('catálogo lista as ferramentas', tools.length >= 20 && tools.every((t) => t.name && t.parameters));
check('catálogo tem as ferramentas principais',
  ['criar_pedido', 'buscar_pedido', 'mover_pedido', 'enviar_mensagem', 'entregas_proximas', 'faturamento']
    .every((n) => tools.some((t) => t.name === n)));

r = await fetch(`${B}/hermes/tools?format=openai`, { headers: HER });
const openai = (await r.json()).tools;
check('formato OpenAI vem pronto', openai[0].type === 'function' && Boolean(openai[0].function.parameters));

r = await fetch(`${B}/hermes/tools?format=anthropic`, { headers: HER });
const anthropic = (await r.json()).tools;
check('formato Anthropic vem pronto', Boolean(anthropic[0].input_schema));

// --------------------------------------------------------------- 3. pedidos
let res = await call('criar_pedido', {
  customer_name: 'Maria Teste Hermes',
  phone: '5551988887777',
  product: 'Placa de homenagem',
  size: '14x20',
  value: '250,00',
  due_date: '2030-01-10',
  pickup_time: '14:00'
});
check('Hermes cria pedido', res.body.ok === true && res.body.result.id > 0, res.body.result?.order_number);
const pedidoId = res.body.result.id;
const codigo = res.body.result.pickup_code;
check('pedido já nasce com código de retirada de 4 dígitos', /^\d{4}$/.test(codigo || ''), codigo);

res = await call('buscar_pedido', { codigo_retirada: codigo });
check('acha o pedido pelo código de retirada', res.body.result.id === pedidoId);

res = await call('buscar_pedido', { numero: '0001' });
check('acha o pedido pelo número', res.body.result.id === pedidoId);

res = await call('listar_pedidos', { busca: 'Maria Teste' });
check('lista encontra o pedido pela busca', res.body.result.total === 1);

res = await call('atualizar_pedido', { id: pedidoId, value: '300,00', payment_status: 'sinal' });
check('atualiza valor e pagamento', res.body.result.value === '300,00' && res.body.result.payment_status === 'sinal');

res = await call('atualizar_pedido', { id: pedidoId, payment_status: 'inventado' });
check('pagamento inválido vira erro explicado, não quebra', res.body.ok === false && /Status de pagamento/.test(res.body.error));

res = await call('comentar_pedido', { id: pedidoId, texto: 'Cliente pediu letra dourada.' });
check('comenta no pedido', res.body.result.body.includes('dourada') && res.body.result.author === 'Hermes');

const antes = sentMessages.length;
res = await call('mover_pedido', { id: pedidoId, status: 'pronto' });
check('move para pronto', res.body.result.order.status === 'pronto');
check('mover para pronto avisa o cliente no WhatsApp', sentMessages.length === antes + 1,
  (sentMessages.at(-1) || '').split('\n')[0]);
check('a mensagem leva o código de retirada', (sentMessages.at(-1) || '').includes(codigo));

res = await call('entregas_proximas', { dias: 4 });
check('entregas próximas responde com hoje e listas', Boolean(res.body.result.hoje) && Array.isArray(res.body.result.proximos));

res = await call('faturamento', {});
check('faturamento responde', typeof res.body.result.faturado === 'number');

res = await call('resumo_do_dia', {});
check('resumo do dia lista o que está pronto', res.body.result.prontos_para_retirada.length === 1);

// -------------------------------------------------------------- 4. clientes
res = await call('buscar_cliente', { telefone: '5551988887777' });
check('cliente foi criado junto com o pedido', res.body.result.name === 'Maria Teste Hermes');
check('histórico do cliente traz o pedido', res.body.result.pedidos.length === 1);

// -------------------------------------------------------------- 5. WhatsApp
res = await call('enviar_mensagem', { telefone: '5551988887777', texto: 'Oi! Aqui é a Classul.' });
check('Hermes manda mensagem pelo WhatsApp', res.body.result.enviado === true && sentMessages.at(-1) === 'Oi! Aqui é a Classul.');

res = await call('enviar_mensagem', { telefone: 'xx', texto: 'oi' });
check('telefone inválido vira erro explicado', res.body.ok === false && /Telefone inválido/.test(res.body.error));

res = await call('ferramenta_que_nao_existe', {});
check('ferramenta desconhecida não quebra o laço do bot', res.body.ok === false && /desconhecida/.test(res.body.error));

// ------------------------------------------- 6. o sistema avisando o Hermes
check('Hermes foi avisado do pedido criado', recebidos.some((e) => e.body.event === 'pedido.criado'));
const evStatus = recebidos.find((e) => e.body.event === 'pedido.status');
check('Hermes foi avisado da mudança de etapa', Boolean(evStatus), `${evStatus?.body.data.de} → ${evStatus?.body.data.para}`);
check('o aviso vai autenticado com a chave', evStatus?.headers.authorization === `Bearer ${CHAVE}`);
check('o aviso vai assinado (HMAC) para a VPS conferir',
  evStatus?.headers['x-classul-signature'] ===
    crypto.createHmac('sha256', CHAVE).update(evStatus.raw).digest('hex'));

// um pedido criado pela tela do sistema também avisa o Hermes
const quantosAntes = recebidos.length;
await fetch(`${B}/orders`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ customer_name: 'Pedido pela tela' }) });
check('pedido criado na tela do sistema também avisa o Hermes', recebidos.length > quantosAntes);

// --------------------------------------- 7. Hermes assumindo o pré-atendimento
const upsert = (texto) => ({
  event: 'messages.upsert',
  data: {
    key: { remoteJid: '5551977776666@s.whatsapp.net', fromMe: false, id: 'M' + Math.random().toString(36).slice(2, 8) },
    pushName: 'Cliente Novo',
    message: { conversation: texto }
  }
});

r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: ADMIN, body: JSON.stringify(upsert('oi, quero uma placa')) });
check('com o bot interno, o Hermes não recebe a mensagem', (await r.json()).bot.ignored === 'bot desativado');

await fetch(`${B}/hermes/config`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ engine: 'hermes' }) });
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: ADMIN, body: JSON.stringify(upsert('oi, quero uma placa')) });
const encaminhado = (await r.json()).bot;
check('com o Hermes no comando, a mensagem é encaminhada', encaminhado.encaminhado === true && encaminhado.texto === 'oi, quero uma placa');
check('a VPS recebeu a mensagem do cliente', recebidos.some((e) => e.body.event === 'mensagem.recebida' && e.body.data.telefone === '5551977776666'));

res = await call('historico_conversa', { telefone: '5551977776666' });
check('a conversa fica guardada no sistema mesmo com o Hermes respondendo', res.body.result.mensagens.length === 1);

res = await call('encerrar_conversa', { telefone: '5551977776666', motivo: 'Hermes entendeu o pedido' });
check('Hermes encerra a conversa', res.body.result.status === 'handled');

await fetch(`${B}/hermes/config`, { method: 'PUT', headers: ADMIN, body: JSON.stringify({ engine: 'off' }) });
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: ADMIN, body: JSON.stringify(upsert('mais uma')) });
check('pré-atendimento desligado não responde ninguém', (await r.json()).bot.ignored === 'pré-atendimento desligado');

// ------------------------------------------------- 7b. área pessoal do Lucas
res = await call('lucas_criar_missao', { titulo: 'Pagar boleto do aluguel', prioridade: 'critica', prazo: '2020-01-01' });
check('Hermes cria missão na área do Lucas', res.body.ok === true && res.body.result.priority === 'critica');
const missaoId = res.body.result.id;

res = await call('lucas_criar_missao', { titulo: '' });
check('missão sem nome vira erro explicado', res.body.ok === false && /nome/.test(res.body.error));

res = await call('lucas_criar_missao', { titulo: 'Qualquer', prioridade: 'urgentissima' });
check('prioridade inválida vira erro explicado', res.body.ok === false && /Prioridade/.test(res.body.error));

await call('lucas_criar_missao', { titulo: 'Pagar internet' });
res = await call('lucas_concluir_missao', { busca: 'pagar' });
check('busca ambígua devolve as opções com id', res.body.ok === false && /Use o id/.test(res.body.error));

res = await call('lucas_concluir_missao', { busca: 'aluguel' });
check('conclui missão pelo trecho do título', res.body.result.status === 'concluida' && Boolean(res.body.result.done_at));

res = await call('lucas_concluir_missao', { id: missaoId, reabrir: true });
check('reabre missão', res.body.result.status === 'aberta' && res.body.result.done_at === null);

res = await call('lucas_atualizar_missao', { id: missaoId, notas: 'vence dia 10', status: 'andamento' });
check('atualiza só o que foi enviado', res.body.result.notes === 'vence dia 10' && res.body.result.priority === 'critica');

res = await call('lucas_criar_rotina', { titulo: 'Academia', horario: '06:30', dias: ['segunda', 'quarta', 'sexta'] });
check('cria rotina com dias por nome', res.body.result.days === '135' && res.body.result.time_of_day === '06:30',
  res.body.result.dias_texto);
const rotinaId = res.body.result.id;

res = await call('lucas_criar_rotina', { titulo: 'Ler', dias: 'dias úteis' });
check('"dias úteis" vira segunda a sexta', res.body.result.days === '12345');

res = await call('lucas_criar_rotina', { titulo: 'Meditar', dias: ['feriado'] });
check('dia desconhecido vira erro explicado', res.body.ok === false && /Dia da semana/.test(res.body.error));

res = await call('lucas_marcar_rotina', { busca: 'academia', dia: '2026-09-21' });
check('marca rotina num dia', res.body.result.feita === true && res.body.result.dia === '2026-09-21');

res = await call('lucas_atualizar_rotina', { id: rotinaId, ativa: false });
check('pausa a rotina sem apagar', res.body.result.active === 0);

res = await call('lucas_painel', { com_historico: true });
const painel = res.body.result;
check('painel traz missões, rotinas e números',
  painel.missoes.length === 2 && painel.rotinas.length === 2 && painel.numeros.tasks_late === 1);
check('painel traz o histórico quando pedido',
  painel.rotinas.find((r) => r.id === rotinaId).historico.includes('2026-09-21'));

res = await call('lucas_apagar_rotina', { id: rotinaId });
check('apaga rotina', res.body.result.apagada.titulo === 'Academia');
res = await call('lucas_apagar_missao', { busca: 'internet' });
check('apaga missão', res.body.result.apagada.titulo === 'Pagar internet');
res = await call('lucas_painel');
check('painel reflete o que foi apagado', res.body.result.missoes.length === 1 && res.body.result.rotinas.length === 1);

// ------------------------------------------------------------- 8. registro
r = await fetch(`${B}/hermes/events?limit=100`, { headers: ADMIN });
const eventos = await r.json();
check('registro guarda o que o Hermes pediu', eventos.some((e) => e.direction === 'entrada' && e.name === 'criar_pedido'));
check('registro guarda o que o sistema avisou', eventos.some((e) => e.direction === 'saida' && e.name === 'pedido.status'));
check('registro guarda também o que deu errado', eventos.some((e) => e.ok === 0));
const privados = eventos.filter((e) => e.name.startsWith('lucas_'));
check('registro da área do Lucas não guarda o conteúdo',
  privados.length > 0 && privados.every((e) => !e.args && !e.result && !JSON.stringify(e).includes('aluguel')));

// --------------------------------------------------------- 9. trocar a chave
r = await fetch(`${B}/hermes/rotate-token`, { method: 'POST', headers: ADMIN });
const novaChave = (await r.json()).token;
check('gera chave nova', /^[a-f0-9]{48}$/.test(novaChave));
r = await fetch(`${B}/hermes/ping`, { headers: HER });
check('a chave antiga para de funcionar na hora', r.status === 401);
r = await fetch(`${B}/hermes/ping`, { headers: { Authorization: `Bearer ${novaChave}` } });
check('a chave nova funciona', (await r.json()).ok === true);

server.close();
hermes.close();
console.log('\nFim dos testes do Hermes.');
