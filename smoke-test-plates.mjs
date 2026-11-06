// Testa as placas montadas na landing page, com banco em memória e Drive e Evolution simulados.
process.env.API_TOKEN = 'teste-token';

import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests, setSettings, ensureSchema, q } = await import(`file://${ROOT}/lib/db.js`);
const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

const realFetch = globalThis.fetch;
const files = new Map();
const sent = [];
let seq = 0;
let driveDown = false;
let evolutionDown = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'x', expires_in: 3600 }) };
  if (u.includes('/upload/drive/v3/files')) {
    if (driveDown) return { ok: false, status: 500, text: async () => 'fora do ar' };
    const id = `f${++seq}`;
    files.set(id, Buffer.from(opts.body));
    return { ok: true, json: async () => ({ id, name: id }) };
  }
  if (u.includes('alt=media')) {
    const f = files.get(u.split('/files/')[1].split('?')[0]);
    return { ok: Boolean(f), status: f ? 200 : 404, arrayBuffer: async () => f.buffer.slice(f.byteOffset, f.byteOffset + f.length), text: async () => '' };
  }
  if (u.includes('/drive/v3/files')) return { ok: true, json: async () => ({ id: `pasta${++seq}`, name: 'pasta' }) };
  if (u.includes('evolution.test')) {
    if (evolutionDown) return { ok: false, status: 500, text: async () => 'erro' };
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({}) };
  }
  return realFetch(url, opts);
};

const { default: app } = await import(`file://${ROOT}/api/index.js`);
const server = app.listen(3134);
const B = 'http://localhost:3134';
await ensureSchema();
await setSettings({
  google_client_id: 'a', google_client_secret: 'b', google_refresh_token: 'c',
  evolution_url: 'https://evolution.test', evolution_apikey: 'k', evolution_instance: 'i',
  bot_webhook_secret: 's', bot_engine: 'off'
});

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const SVG = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="140mm"><text>Ana</text></svg>';
const token = (n) => `tokenparaotesteplaca${String(n).padStart(2, '0')}`;
const post = (body, headers = {}) => realFetch(`${B}/api/plates`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const auth = { Authorization: 'Bearer teste-token' };
const base = (n, extra = {}) => ({ token: token(n), jpg: JPG, svg: SVG, data: { name: 'Ana', size: '14x20', color: 'preto', frame: 'filete' }, ...extra });

let res = await post(base(1));
check('salva a placa sem login', res.status === 201);
const { id } = await res.json();
check('a pasta do Drive recebeu JPG e SVG', files.size === 2);
check('reenviar o mesmo código não duplica', (await post(base(1))).status === 201 && files.size === 2);

check('código inválido é recusado', (await post(base(1, { token: 'curto' }))).status === 400);
check('imagem que não é JPG é recusada', (await post(base(2, { jpg: Buffer.from('<html>').toString('base64') }))).status === 400);
check('SVG com script é recusado', (await post(base(2, { svg: SVG.replace('<text>', '<script>alert(1)</script><text>') }))).status === 400);
check('SVG com evento é recusado', (await post(base(2, { svg: SVG.replace('<text>', '<text onload="x()">') }))).status === 400);
check('SVG sem declaração é recusado', (await post(base(2, { svg: '<svg></svg>' }))).status === 400);
check('logo de tipo proibido é recusada', (await post(base(2, { logo: { type: 'text/html', data: JPG } }))).status === 400);
check('arte que não é PNG é recusada', (await post(base(2, { arte: JPG }))).status === 400);
check('corpo gigante é recusado sem derrubar', (await post(base(2, { jpg: 'A'.repeat(6 * 1024 * 1024) }))).status >= 400);

driveDown = true;
check('Drive fora do ar devolve erro claro', (await post(base(3))).status === 502);
const { rows: semLinha } = await q('SELECT id FROM plate_designs WHERE token = $1', [token(3)]);
check('falha no Drive não deixa linha pela metade', semLinha.length === 0);
driveDown = false;

res = await post(base(4, { logo: { type: 'image/png', data: JPG } }));
check('aceita logo', res.status === 201);
const logoId = (await res.json()).id;
check('aceita duas logos', (await post(base(5, { logos: [{ type: 'image/png', data: JPG }, { type: 'image/jpeg', data: JPG }] }))).status === 201);
check('terceira logo é recusada', (await post(base(6, { logos: [1, 2, 3].map(() => ({ type: 'image/png', data: JPG })) }))).status === 400);

res = await realFetch(`${B}/api/plates/${token(1)}/image.jpg`);
check('imagem é pública pelo código', res.status === 200 && res.headers.get('content-type') === 'image/jpeg');
res = await realFetch(`${B}/api/plates/${token(1)}`);
const html = await res.text();
check('página do link traz a miniatura', res.status === 200 && html.includes('og:image') && html.includes('noindex'));
check('código desconhecido dá 404', (await realFetch(`${B}/api/plates/${token(9)}`)).status === 404);

check('SVG exige login', (await realFetch(`${B}/api/plates/${id}/file/svg`)).status === 401);
check('lista exige login', (await realFetch(`${B}/api/plates`)).status === 401);
res = await realFetch(`${B}/api/plates/${id}/file/svg`, { headers: auth });
check('SVG baixa como anexo', res.status === 200 && /attachment/.test(res.headers.get('content-disposition')));
check('placa sem logo não tem arquivo de logo', (await realFetch(`${B}/api/plates/${id}/file/logo`, { headers: auth })).status === 404);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
res = await post(base(7, { arte: PNG, foto: JPG }));
check('aceita a arte da placa', res.status === 201);
const idArte = (await res.json()).id;
const placaArte = () => realFetch(`${B}/api/plates`, { headers: auth }).then((r) => r.json()).then((d) => d.plates.find((p) => p.id === idArte));
let pa = await placaArte();
check('a landing não consegue criar foto', pa.has_arte && !pa.has_foto);
check('arte exige login', (await realFetch(`${B}/api/plates/${idArte}/file/arte`)).status === 401);
check('arte baixa com login', (await realFetch(`${B}/api/plates/${idArte}/file/arte`, { headers: auth })).status === 200);
const salvarFoto = (id, jpg, h2 = auth) => realFetch(`${B}/api/plates/${id}/foto`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h2 }, body: JSON.stringify({ jpg }) });
check('salvar foto exige login', (await salvarFoto(idArte, JPG, {})).status === 401);
check('foto inválida é recusada', (await salvarFoto(idArte, PNG)).status === 400);
check('placa inexistente dá 404', (await salvarFoto(999999, JPG)).status === 404);
check('corpo grande da foto passa do limite geral', (await salvarFoto(idArte, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400 * 1024)]).toString('base64'))).status === 200);
pa = await placaArte();
check('botão salva a foto', pa.has_foto && pa.foto_v);
const v1 = pa.foto_v;
check('gerar de novo funciona', (await salvarFoto(idArte, JPG)).status === 200);
pa = await placaArte();
check('gerar de novo troca a foto', pa.foto_v !== v1);
res = await realFetch(`${B}/api/plates/${token(7)}/foto.jpg`);
check('foto abre pelo código da placa', res.status === 200 && res.headers.get('content-type') === 'image/jpeg');
check('placa sem foto dá 404 na foto', (await realFetch(`${B}/api/plates/${token(1)}/foto.jpg`)).status === 404);
const duas = (await (await realFetch(`${B}/api/plates`, { headers: auth })).json()).plates.find((p) => p.token === token(5));
check('histórico aponta as duas logos', duas?.has_logo && duas?.has_logo2);
check('segunda logo baixa', (await realFetch(`${B}/api/plates/${duas?.id}/file/logo2`, { headers: auth })).status === 200);
check('logo original baixa', (await realFetch(`${B}/api/plates/${logoId}/file/logo`, { headers: auth })).status === 200);

const hook = (msg, key = {}, extra = {}) => realFetch(`${B}/api/bot/webhook?secret=s`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: '5551999990000@s.whatsapp.net', id: 'M', ...key }, pushName: 'Cliente', message: msg, ...extra } })
}).then((r) => r.json());
const link = (n) => ({ conversation: `Minha placa: https://x/api/plates/${token(n)}` });

check('mensagem sem placa não faz nada', (await hook({ conversation: 'oi' })).plate.ignored === 'sem placa' && !sent.length);
check('mensagem nossa não dispara', (await hook(link(1), { fromMe: true })).plate.ignored === 'mensagem nossa' && !sent.length);
check('grupo não dispara', (await hook(link(1), { remoteJid: '123@g.us' })).plate.ignored && !sent.length);
await setSettings({ plate_send_image: 'false' });
check('desligado não envia', (await hook(link(1))).plate.ignored === 'envio desligado' && !sent.length);
await setSettings({ plate_send_image: 'true' });
check('placa desconhecida não envia', (await hook(link(9))).plate.ignored === 'placa não encontrada' && !sent.length);

check('cliente enviou: responde com a imagem', (await hook(link(1))).plate.sent === true);
check('envia como imagem para o número certo', sent[0]?.number === '5551999990000' && sent[0]?.mediatype === 'image' && sent[0]?.media.endsWith(`/api/plates/${token(1)}/image.jpg`));
check('não envia duas vezes', (await hook(link(1))).plate.ignored === 'imagem já enviada' && sent.length === 1);

evolutionDown = true;
check('falha no envio aparece', Boolean((await hook(link(4))).plate.error));
evolutionDown = false;
check('falha no envio pode tentar de novo', (await hook(link(4))).plate.sent === true && sent.length === 2);

const lid = await hook(link(1), { remoteJid: 'abc@lid', senderPn: '5551888880000@s.whatsapp.net' });
check('conversa com identificador novo usa o telefone real', lid.plate.ignored === 'imagem já enviada');

const list = await (await realFetch(`${B}/api/plates`, { headers: auth })).json();
const first = list.plates.find((p) => p.id === id);
check('histórico traz dados e telefone', first?.data.name === 'Ana' && first?.phone && first?.image_sent_at);
check('histórico não expõe o caminho do Drive', !JSON.stringify(list).includes('svg_file_id'));
res = await realFetch(`${B}/api/plates-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ send_image: false }) });
check('interruptor salva', (await res.json()).send_image === false && (await (await realFetch(`${B}/api/plates`, { headers: auth })).json()).send_image === false);

for (let i = 0; i < 30; i += 1) await post(base(20 + i));
check('limite por hora segura excesso', (await post({ ...base(60), token: 'tokenparaotesteplacaZZ' })).status === 429);

server.close();
