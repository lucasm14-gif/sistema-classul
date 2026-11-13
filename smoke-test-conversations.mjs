// Testa o arquivo de conversas (aba Conversas) com Evolution e Google "de mentira".
process.env.API_TOKEN = 'teste-token';

import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests, setSettings, ensureSchema, q } = await import(`file://${ROOT}/lib/db.js`);
const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());
const { default: app } = await import(`file://${ROOT}/api/index.js`);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const realFetch = globalThis.fetch;
const drive = { folders: [], uploads: [] };
let mediaFails = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/chat/getBase64FromMediaMessage/')) {
    if (mediaFails) return { ok: false, status: 400, text: async () => 'expirou' };
    return { ok: true, json: async () => ({ base64: PNG.toString('base64'), mimetype: 'image/png' }) };
  }
  if (u.includes('oauth2.googleapis.com')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
  if (u.includes('googleapis.com/upload/drive')) {
    const id = 'file' + (drive.uploads.length + 1);
    drive.uploads.push(id);
    return { ok: true, json: async () => ({ id, name: 'foto.png', mimeType: 'image/png', size: String(PNG.length), webViewLink: `https://drive/${id}` }) };
  }
  if (u.includes('googleapis.com/drive/v3/files') && u.includes('alt=media')) return { ok: true, arrayBuffer: async () => PNG };
  if (u.includes('googleapis.com/drive/v3/files')) {
    const body = JSON.parse(opts.body || '{}');
    const id = 'folder' + (drive.folders.length + 1);
    drive.folders.push(body.name);
    return { ok: true, json: async () => ({ id, name: body.name }) };
  }
  if (u.includes('openai.com')) return { ok: true, json: async () => ({ choices: [{ message: { content: 'oi' } }] }) };
  if (u.includes('evolution.exemplo.com')) return { ok: true, json: async () => ({ key: { id: 'X' } }) };
  return realFetch(url, opts);
};

const server = app.listen(3127);
const B = 'http://localhost:3127/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

await ensureSchema();
await setSettings({
  bot_engine: 'off',
  bot_webhook_secret: 'segredo123',
  evolution_url: 'https://evolution.exemplo.com',
  evolution_apikey: 'fake',
  evolution_instance: 'classul',
  google_client_id: 'cid',
  google_client_secret: 'sec',
  google_refresh_token: 'rt',
  google_folder_id: 'raiz'
});
await q("INSERT INTO clients (name, phone) VALUES ('Maria da Silva', '(51) 99888-7766')");

let n = 0;
const hook = async (data) =>
  (await (await realFetch(`${B}/bot/webhook?secret=segredo123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'messages.upsert', data }) })).json()).archive;
const msg = (jid, message, { fromMe = false, id = 'M' + ++n, ts = 1760000000 + n * 60, pushName = 'Mari' } = {}) => ({
  key: { remoteJid: jid, fromMe, id },
  pushName,
  messageTimestamp: ts,
  message
});
const get = async (path) => {
  const r = await realFetch(`${B}${path}`, { headers: H });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
};

// Número sem o nono dígito, como o WhatsApp costuma entregar.
const MARIA = '555198887766@s.whatsapp.net';
const JOAO = '5511977776666@s.whatsapp.net';

let r = await hook(msg(MARIA, { conversation: 'Oi, quero uma placa de homenagem' }));
check('guarda mensagem de conversa não acompanhada', r.stored === true, JSON.stringify(r));
r = await hook(msg(MARIA, { conversation: 'Claro! Qual tamanho?' }, { fromMe: true, pushName: 'Classul' }));
check('guarda a mensagem enviada por nós', r.stored === true);
r = await hook(msg(MARIA, { conversation: 'repetida' }, { id: 'M1' }));
check('não duplica a mesma mensagem', r.ignored === 'mensagem já guardada', JSON.stringify(r));
r = await hook(msg('1203630@g.us', { conversation: 'grupo' }));
check('ignora grupo', r.ignored === 'não é conversa individual');
r = await hook(msg(MARIA, { reactionMessage: { text: '👍' } }));
check('ignora reação', r.ignored === 'evento de conversa');

r = await hook(msg(MARIA, { imageMessage: { mimetype: 'image/jpeg', caption: 'segue o logo' } }));
check('foto vai para o Drive', r.file?.saved === true, JSON.stringify(r.file));
check('cria pasta de conversas + pasta do contato', drive.folders[0] === 'Classul - Conversas do WhatsApp' && drive.folders[1] === 'Mari - 555198887766', drive.folders.join(' | '));
const photoId = r.id;
r = await hook(msg(MARIA, { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'arte.pdf', mimetype: 'application/pdf' } } } }));
check('documento embrulhado é reconhecido', r.media === 'documento' && r.file?.saved === true);
check('reaproveita a pasta do contato', drive.folders.length === 2);

mediaFails = true;
r = await hook(msg(MARIA, { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } }));
check('falha de mídia não derruba e fica marcada', r.stored === true && Boolean(r.file?.error));
const audioId = r.id;
mediaFails = false;
r = await (await realFetch(`${B}/conversations/media/${audioId}/retry`, { method: 'POST', headers: H })).json();
check('tentar de novo guarda o arquivo', r.message?.media_status === 'salva', JSON.stringify(r));

r = await hook(msg('99887766554433@lid', { conversation: 'vim pelo lid' }, { pushName: 'João' }));
check('conta @lid sem número é ignorada', r.ignored === 'não é conversa individual');
r = await hook({ ...msg('99887766554433@lid', { extendedTextMessage: { text: 'Preciso de 10 medalhas' } }, { pushName: 'João' }), key: { remoteJid: '99887766554433@lid', remoteJidAlt: JOAO, fromMe: false, id: 'LID2' } });
check('conta @lid com número ao lado é guardada', r.stored === true && r.phone === '5511977776666', JSON.stringify(r));

let list = (await get('/conversations')).body;
check('lista as duas conversas, a mais recente primeiro', list.chats.length === 2 && list.chats[0].phone === '5511977776666', JSON.stringify(list.chats.map((c) => c.phone)));
const maria = list.chats.find((c) => c.phone === '555198887766');
check('usa o nome do cliente cadastrado (casando sem o nono dígito)', maria?.name === 'Maria da Silva' && maria.client_id === 1, maria?.name);
check('prévia mostra a última mensagem', maria?.last_media_type === 'audio');

let chat = (await get('/conversations/555198887766/messages')).body;
check('abre a conversa em ordem', chat.messages.length === 5 && chat.messages[0].body === 'Oi, quero uma placa de homenagem' && chat.messages[1].from_me === true, String(chat.messages.length));
check('legenda da foto e arquivo salvos', chat.messages[2].body === 'segue o logo' && chat.messages[2].media_status === 'salva' && chat.messages[2].web_view_link);

const file = await get(`/conversations/media/${photoId}`);
check('serve a foto guardada', file.status === 200 && file.type.startsWith('image/png') && file.body.equals(PNG), `${file.status} ${file.type}`);
check('arquivo exige login', (await realFetch(`${B}/conversations/media/${photoId}`)).status === 401);

// Paginação: 130 mensagens antigas numa conversa.
for (let i = 0; i < 130; i++) {
  await q("INSERT INTO wa_messages (phone, wa_message_id, from_me, body, sent_at) VALUES ('5511977776666', $1, 0, $2, $3)", [
    'OLD' + i,
    'antiga ' + i,
    new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString()
  ]);
}
let page = (await get('/conversations/5511977776666/messages')).body;
check('primeira página traz as 60 mais recentes', page.messages.length === 60 && page.has_older === true && page.messages.at(-1).body === 'Preciso de 10 medalhas');
let seen = page.messages.length;
let first = page.messages[0];
while (page.has_older) {
  page = (await get(`/conversations/5511977776666/messages?before=${page.messages[0].id}`)).body;
  check(`página anterior termina antes da seguinte (${seen})`, new Date(page.messages.at(-1).sent_at) <= new Date(first.sent_at));
  seen += page.messages.length;
  first = page.messages[0];
}
check('rolando para cima chega em todas as mensagens', seen === 131 && first.body === 'antiga 0', String(seen));

const found = (await get('/conversations?q=medalhas')).body;
check('busca acha a mensagem pelo texto', found.messages.length === 1 && found.messages[0].chat_name === 'João', JSON.stringify(found.messages.map((m) => m.body)));
check('busca por nome acha a conversa', (await get('/conversations?q=maria')).body.chats.length === 1);
check('busca por telefone acha a conversa', (await get('/conversations?q=97777-6666')).body.chats.length === 1);
check('busca por telefone com o nono dígito a mais', (await get('/conversations?q=51998887766')).body.chats.length === 1);
const hit = (await get('/conversations?q=antiga 50')).body.messages[0];
const around = (await get(`/conversations/5511977776666/messages?around=${hit.id}`)).body;
check('abrir resultado traz a janela em volta', around.messages.some((m) => m.id === hit.id) && around.has_older && around.has_newer, String(around.messages.length));
const after = (await get(`/conversations/5511977776666/messages?after=${around.messages.at(-1).id}&limit=200`)).body;
check('rolar para baixo continua até a mais recente', after.has_newer === false && after.messages.at(-1).body === 'Preciso de 10 medalhas');
check('conversa inexistente dá 404', (await get('/conversations/5500000000000/messages')).status === 404);
check('"%" na busca não vira curinga', (await get('/conversations?q=%25%25')).body.messages.length === 0);

const { rows: watched } = await q('SELECT COUNT(*)::int AS n FROM chat_messages');
check('Observador continua separado (nada em chat_messages)', watched[0].n === 0);

server.close();
console.log(process.exitCode ? '\nFALHOU' : '\nTudo certo.');
