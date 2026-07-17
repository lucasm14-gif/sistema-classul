// Testa o fluxo do bot com OpenAI e Evolution "mockados" (nenhuma chamada externa real).
process.env.API_TOKEN = 'teste-token';

import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests, setSettings, ensureSchema, q } = await import(`file://${ROOT}/lib/db.js`);

const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());

const { default: app } = await import(`file://${ROOT}/api/index.js`);
const bot = await import(`file://${ROOT}/lib/bot.js`);

// --- mocks de rede (OpenAI + Evolution); localhost passa pelo fetch real ---
const realFetch = globalThis.fetch;
let openaiReply = 'Olá! Que bom falar com a Classul 🙂 Me conta o que você procura?';
const sentMessages = [];
const sentImages = [];
let sendCounter = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('openai.com')) {
    return { ok: true, json: async () => ({ choices: [{ message: { content: openaiReply } }] }) };
  }
  if (u.includes('/message/sendText/')) {
    const body = JSON.parse(opts.body);
    sentMessages.push(body.text);
    return { ok: true, json: async () => ({ key: { id: 'BOT' + ++sendCounter } }) };
  }
  if (u.includes('/message/sendMedia/')) {
    const body = JSON.parse(opts.body);
    sentImages.push(body.media || body.mediaMessage?.media);
    return { ok: true, json: async () => ({ key: { id: 'IMG' + ++sendCounter } }) };
  }
  return realFetch(url, opts);
};

const server = app.listen(3120);
const B = 'http://localhost:3120/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

// garante schema + configura o bot direto no banco
await ensureSchema();
await setSettings({
  bot_enabled: '1',
  openai_api_key: 'sk-fake',
  bot_test_number: '555192462861',
  bot_webhook_secret: 'segredo123',
  evolution_url: 'https://evolution.exemplo.com',
  evolution_apikey: 'fake',
  evolution_instance: 'classul'
});

const TEST_JID = '555192462861@s.whatsapp.net';
const OTHER_JID = '5511988887777@s.whatsapp.net';

const upsert = (jid, text, fromMe = false, id = 'C' + Math.random().toString(36).slice(2, 8), pushName = 'Lucas') => ({
  event: 'messages.upsert',
  data: { key: { remoteJid: jid, fromMe, id }, pushName, message: { conversation: text } }
});

// 1. secret inválido é ignorado
let r = await fetch(`${B}/bot/webhook?secret=errado`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'oi')) });
check('webhook com secret errado é ignorado', (await r.json()).ignored === 'secret inválido');

// 2. número fora do teste é ignorado
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(OTHER_JID, 'oi')) });
check('número fora do teste é ignorado', (await r.json()).ignored === 'fora do número de teste');

// 3. primeira mensagem do número de teste → bot responde
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'Oi, quero uma placa')) });
let res = await r.json();
check('bot responde a primeira mensagem', res.replied === true && res.done === false, sentMessages.at(-1));

// 4. bot conclui quando o modelo emite [[ATENDIDO]]
openaiReply = 'Perfeito! Então é uma Placa de homenagem 20x30 para aposentadoria. Um atendente da Classul vai te passar arte, valor e prazo. Obrigado! 🙂\n[[ATENDIDO]]';
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'Placa de homenagem 20x30 pra aposentadoria')) });
res = await r.json();
check('bot encerra ao entender o pedido', res.replied === true && res.done === true);
check('token [[ATENDIDO]] não vai para o cliente', !sentMessages.at(-1).includes('ATENDIDO'), sentMessages.at(-1));

// 5. depois de encerrado, não responde mais
const before = sentMessages.length;
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'mais uma pergunta dias depois')) });
res = await r.json();
check('não responde após encerrar', res.ignored === 'conversa já atendida' && sentMessages.length === before);

// 6. conversa aparece na listagem como atendida
r = await fetch(`${B}/bot/conversations`, { headers: H });
let list = await r.json();
check('conversa listada como atendida', list.length === 1 && list[0].status === 'handled' && list[0].handled_reason === 'bot concluiu');

// 7. reativar volta a responder
r = await fetch(`${B}/bot/conversations/555192462861/reactivate`, { method: 'POST', headers: H });
check('reativar conversa', (await r.json()).ok === true);
openaiReply = 'Oi de novo! Como posso ajudar? 🙂';
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'voltei')) });
check('responde após reativar', (await r.json()).replied === true);

// 8. handoff humano: você responde manualmente (fromMe, não é eco do bot) → silencia
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'Oi, é a Classul falando manualmente', true, 'HUMANO1')) });
check('handoff humano detectado', (await r.json()).handoff === true);
const after = sentMessages.length;
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'cliente responde depois do humano')) });
check('bot silencia após humano assumir', (await r.json()).ignored === 'conversa já atendida' && sentMessages.length === after);

// 9. eco do próprio bot (fromMe com conteúdo que o bot mandou) não vira handoff
await q("UPDATE bot_conversations SET status = 'active', handled_reason = NULL WHERE phone = '555192462861'");
const botText = sentMessages[0];
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, botText, true, 'ECO1')) });
check('eco do bot não é tratado como handoff', (await r.json()).ignored === 'eco do próprio bot');

// 10. bot envia foto quando o modelo emite [[FOTO:...]] e o token não vai no texto
sentImages.length = 0;
openaiReply = 'Temos placas de homenagem lindas! Olha alguns exemplos 🙂\n[[FOTO:placa_homenagem]]';
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'me mostra a placa de homenagem')) });
check('bot envia foto do produto', sentImages.length >= 1 && sentImages.every((u) => u.includes('/bot-fotos/')), sentImages.join(', '));
check('marcador [[FOTO]] não vai para o cliente', !sentMessages.at(-1).includes('FOTO'), sentMessages.at(-1));

// 11. token de foto inválido é ignorado (não quebra e não envia nada)
sentImages.length = 0;
openaiReply = 'Beleza! [[FOTO:inexistente]]';
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'e ai')) });
check('token de foto inválido não envia imagem', sentImages.length === 0);

server.close();
console.log('\nFim dos testes do bot.');
