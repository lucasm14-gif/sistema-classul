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

// O webhook devolve { watcher, bot }: o observador e o bot rodam lado a lado.
// Estes testes olham só a parte do bot.

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
check('número fora do teste é ignorado', (await r.json()).bot.ignored === 'fora do número de teste');

// 3. primeira mensagem do número de teste → bot responde
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'Oi, quero uma placa')) });
let res = (await r.json()).bot;
check('bot responde a primeira mensagem', res.replied === true && res.done === false, sentMessages.at(-1));

// 4. bot conclui quando o modelo emite [[ATENDIDO]]
openaiReply = 'Perfeito! Então é uma Placa de homenagem 20x30 para aposentadoria. Um atendente da Classul vai te passar arte, valor e prazo. Obrigado! 🙂\n[[ATENDIDO]]';
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'Placa de homenagem 20x30 pra aposentadoria')) });
res = (await r.json()).bot;
check('bot encerra ao entender o pedido', res.replied === true && res.done === true);
check('token [[ATENDIDO]] não vai para o cliente', !sentMessages.at(-1).includes('ATENDIDO'), sentMessages.at(-1));

// 5. depois de encerrado, não responde mais
const before = sentMessages.length;
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'mais uma pergunta dias depois')) });
res = (await r.json()).bot;
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
check('responde após reativar', (await r.json()).bot.replied === true);

// 8. handoff humano: você responde manualmente (fromMe, não é eco do bot) → silencia
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'Oi, é a Classul falando manualmente', true, 'HUMANO1')) });
check('handoff humano detectado', (await r.json()).bot.handoff === true);
const after = sentMessages.length;
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, 'cliente responde depois do humano')) });
check('bot silencia após humano assumir', (await r.json()).bot.ignored === 'conversa já atendida' && sentMessages.length === after);

// 9. eco do próprio bot (fromMe com conteúdo que o bot mandou) não vira handoff
await q("UPDATE bot_conversations SET status = 'active', handled_reason = NULL WHERE phone = '555192462861'");
const botText = sentMessages[0];
r = await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(upsert(TEST_JID, botText, true, 'ECO1')) });
check('eco do bot não é tratado como handoff', (await r.json()).bot.ignored === 'eco do próprio bot');

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

// ---------- O bot avalia cada conversa (sem número de teste: liberado para todos) ----------
await setSettings({ bot_test_number: '', bot_ignore_numbers: '5551900000001\n(51) 90000-0002' });
const post = async (body) => (await (await fetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json()).bot;
let lastSystem = '';
let openaiCalls = 0;
{
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('openai.com')) {
      openaiCalls++;
      lastSystem = JSON.parse(opts.body).messages[0].content;
    }
    return mocked(url, opts);
  };
}

// 12. conversa pessoal: o modelo lê, devolve [[SILENCIO]] e nada é enviado nem guardado
let antes = sentMessages.length;
openaiReply = '[[SILENCIO]]';
res = await post(upsert('5551911110002@s.whatsapp.net', 'Oi pai, vai almoçar em casa hoje?'));
check('conversa pessoal: bot lê e fica calado', res.ignored === 'bot preferiu não responder' && sentMessages.length === antes);
let guardadas = (await q("SELECT count(*)::int AS n FROM bot_messages WHERE phone = '5551911110002'")).rows[0].n;
check('conversa pessoal não vira histórico do bot', guardadas === 0);

// 13. vinte mensagens pessoais seguidas nunca disparam a mensagem de "limite"
for (let i = 0; i < 20; i++) await post(upsert('5551911110002@s.whatsapp.net', `mensagem pessoal ${i}`));
check('conversa pessoal longa não recebe mensagem automática', sentMessages.length === antes);

// 14. o roteiro vai com a hora de Porto Alegre para a saudação
check('modelo recebe o horário e a saudação certa', /AGORA: .*horário de Porto Alegre.*Saudação certa neste horário: "(Bom dia|Boa tarde|Boa noite),"/.test(lastSystem), lastSystem.split('\n').at(-1));

// 15. mensagem pronta do site → responde e manda a tabela
sentImages.length = 0;
openaiReply = 'Boa tarde,\n[[FOTO:tabela_homenagem]]\nJá tens o que vai na placa?';
res = await post(upsert('5551911110003@s.whatsapp.net', 'Olá! Gostaria de solicitar um orçamento para placas de homenagem personalizadas.'));
check('lead do site é respondido', res.replied === true, sentMessages.at(-1));
check('manda a tabela de preços', sentImages.some((u) => u.endsWith('/bot-fotos/tabela-homenagem.jpg')), sentImages.join(', '));

// 16. o bot passa para o atendente e para
openaiReply = 'Ok, já te retorno,\n[[ATENDIDO]]';
res = await post(upsert('5551911110003@s.whatsapp.net', 'segue o texto da placa: Homenagem ao Sr. João'));
check('passa para o atendente e encerra', res.replied === true && res.done === true && !sentMessages.at(-1).includes('ATENDIDO'));

// 17. humano responde → bot para (mesmo sem o bot ter falado antes)
res = await post(upsert('5551911110006@s.whatsapp.net', 'Bom dia, em que posso ajudar?', true, 'HUMANO1'));
check('resposta de humano é detectada', res.handoff === true);
antes = sentMessages.length;
openaiReply = 'Bom dia,';
res = await post(upsert('5551911110006@s.whatsapp.net', 'quero uma placa de homenagem'));
check('bot não fala depois que o humano respondeu', res.ignored === 'conversa já atendida' && sentMessages.length === antes);

// 18. número na lista de não responder nem chega ao modelo
const chamadas = openaiCalls;
res = await post(upsert('5551900000001@s.whatsapp.net', 'quero uma placa de homenagem'));
check('lista de não responder vale mesmo com assunto de cliente', res.ignored === 'não é cliente' && sentMessages.length === antes, res.motivo);
res = await post(upsert('5551900000002@s.whatsapp.net', 'me passa o orçamento da placa'));
check('lista aceita número com máscara e não gasta IA', res.ignored === 'não é cliente' && openaiCalls === chamadas);

// 19. conversa no endereço novo do WhatsApp (@lid) usa o número de remoteJidAlt
openaiReply = 'Boa tarde, no momento não estamos fazendo troféus e medalhas,';
const lid = upsert('132607148822545@lid', 'boa tarde, vocês fazem troféu?');
lid.data.key.remoteJidAlt = '5551911110004@s.whatsapp.net';
res = await post(lid);
check('conversa @lid é atendida pelo número real', res.replied === true && res.phone === '5551911110004');

// 20. roteiro padrão: os cinco pontos pedidos
r = await fetch(`${B}/bot/default-prompt`, { headers: H });
const dp = (await r.json()).prompt || '';
check('roteiro traz tabela, endereço, troféus/medalhas e marcadores',
  dp.includes('R$ 238,00') && dp.includes('Carlos Von Koseritz, 63') && dp.includes('não estamos fazendo troféus e medalhas') &&
  dp.includes('[[SILENCIO]]') && dp.includes('[[ATENDIDO]]') && dp.includes('{PRODUTOS}'));

// ---------- Chat de teste (aba "Testar bot") ----------
const chat = async (messages, roteiro) => {
  const rr = await fetch(`${B}/bot/test-chat`, { method: 'POST', headers: H, body: JSON.stringify({ messages, roteiro }) });
  return { status: rr.status, body: await rr.json() };
};
antes = sentMessages.length;
const nBanco = (await q('SELECT count(*)::int AS n FROM bot_messages')).rows[0].n;
openaiReply = 'Boa tarde,\n[[FOTO:tabela_homenagem]]\nJá tens o que vai na placa?';
let c = await chat([{ role: 'user', content: 'quanto custa a placa de homenagem?' }], 'padrao');
check('chat de teste responde com texto e fotos', c.status === 200 && c.body.texto.includes('Já tens') && c.body.fotos.length === 2 && c.body.fotos[0].url.endsWith('/bot-fotos/tabela-homenagem.jpg'));
check('chat de teste não deixa marcador no texto', !/\[\[/.test(c.body.texto));
check('chat de teste com roteiro padrão usa o roteiro novo', lastSystem.includes('não estamos fazendo troféus e medalhas'));
openaiReply = '[[SILENCIO]]';
c = await chat([{ role: 'user', content: 'oi pai' }]);
check('chat de teste mostra quando o bot fica calado', c.body.silencio === true && c.body.texto === '');
openaiReply = 'Ok, já te retorno,\n[[ATENDIDO]]';
c = await chat([{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'Boa tarde,' }, { role: 'user', content: 'segue o texto' }]);
check('chat de teste mostra quando o bot passa para o atendente', c.body.done === true && c.body.texto === 'Ok, já te retorno,');
check('chat de teste não envia WhatsApp nem grava no banco', sentMessages.length === antes && (await q('SELECT count(*)::int AS n FROM bot_messages')).rows[0].n === nBanco);
c = await chat([]);
check('chat de teste sem mensagem dá erro claro', c.status === 400);

server.close();
console.log('\nFim dos testes do bot.');
