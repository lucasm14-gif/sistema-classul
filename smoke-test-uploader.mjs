// Testa o enviador de artes de ponta a ponta: o programinha roda de verdade
// como processo separado, vigiando uma pasta temporária, contra a API real
// (com o Google simulado). Nenhuma chamada externa acontece.
process.env.API_TOKEN = 'teste-token';

import { newDb } from 'pg-mem';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const PORT = 3140;
const { _setPoolForTests, setSettings, ensureSchema } = await import(`file://${ROOT}/lib/db.js`);

const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());

// --- Google simulado: token, pastas, sessão de upload e metadados ---
const realFetch = globalThis.fetch;
const arquivos = new Map(); // id -> { name, mimeType, size }
const excluidos = [];
let idSeq = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('oauth2.googleapis.com/token')) {
    return { ok: true, json: async () => ({ access_token: 'fake-token', expires_in: 3600 }) };
  }
  if (u.includes('/upload/drive/v3/files') && u.includes('resumable')) {
    const meta = JSON.parse(opts.body);
    const id = `file-${++idSeq}`;
    arquivos.set(id, { id, name: meta.name, mimeType: 'application/x-coreldraw', size: 0 });
    return {
      ok: true,
      headers: { get: (h) => (h.toLowerCase() === 'location' ? `http://localhost:${PORT}/google-falso/${id}` : null) },
      json: async () => ({ id })
    };
  }
  if (u.includes('/drive/v3/files') && (opts.method || 'GET') === 'POST') {
    return { ok: true, json: async () => ({ id: `pasta-${++idSeq}`, name: 'pasta' }) };
  }
  if (u.includes('/drive/v3/files/') && (opts.method || 'GET') === 'DELETE') {
    excluidos.push(u.split('/drive/v3/files/')[1].split('?')[0]);
    return { ok: true, json: async () => ({}) };
  }
  if (u.includes('/drive/v3/files/')) {
    const id = u.split('/drive/v3/files/')[1].split('?')[0];
    const f = arquivos.get(id) || { id, name: 'desconhecido' };
    return { ok: true, json: async () => ({ ...f, webViewLink: `https://drive.google.com/${id}` }) };
  }
  return realFetch(url, opts);
};

const { default: app } = await import(`file://${ROOT}/api/index.js`);

// Recebe o PUT que o enviador manda "para o Google".
app.put('/google-falso/:id', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  const f = arquivos.get(req.params.id);
  if (f) f.size = req.body.length;
  res.json({ id: req.params.id });
});

const server = app.listen(PORT);
const B = `http://localhost:${PORT}/api`;
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

await ensureSchema();
await setSettings({
  google_client_id: 'id-falso',
  google_client_secret: 'segredo-falso',
  google_refresh_token: 'refresh-falso'
});

// pedido #0001, para o roteamento pelo nome do arquivo
let r = await fetch(`${B}/orders`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ customer_name: 'Dona Marta', phone: '(51) 93333-4444' })
});
const pedido = await r.json();
check('pedido de teste criado', pedido.order_number === '#0001');

r = await fetch(`${B}/orders`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ customer_name: 'Batalhão 3º BE / Seção', phone: '(51) 98888-7777' })
});
const pedido2 = await r.json();
check('segundo pedido criado', pedido2.order_number === '#0002');

// --- prepara o enviador numa pasta temporária ---
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'classul-uploader-'));
const artes = path.join(base, 'Artes');
fs.mkdirSync(artes);
fs.copyFileSync(path.join(ROOT, 'uploader', 'classul-uploader.mjs'), path.join(base, 'classul-uploader.mjs'));
fs.writeFileSync(
  path.join(base, 'config.json'),
  JSON.stringify({
    apiUrl: `http://localhost:${PORT}`,
    apiToken: 'teste-token',
    pasta: artes,
    segundosParado: 0,
    intervaloMs: 300,
    sincronizarACadaMs: 400
  })
);

const filho = spawn(process.execPath, ['classul-uploader.mjs'], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'] });
const saida = [];
filho.stdout.on('data', (d) => saida.push(String(d)));
filho.stderr.on('data', (d) => saida.push(String(d)));

// Espera uma condição virar verdadeira (o enviador trabalha em segundo plano).
let ok;
const esperar = async (fn, segundos = 12) => {
  const limite = Date.now() + segundos * 1000;
  while (Date.now() < limite) {
    if (await fn()) return true;
    await new Promise((r2) => setTimeout(r2, 250));
  }
  return false;
};

const anexosDoPedido = async () => {
  const res = await fetch(`${B}/orders/${pedido.id}`, { headers: H });
  return (await res.json()).attachments || [];
};
const recebidos = async () => {
  const res = await fetch(`${B}/inbox-files`, { headers: H });
  return await res.json();
};

// --- 1. o enviador cria uma pasta por pedido em aberto ---
ok = await esperar(async () => {
  const dirs = fs.readdirSync(artes, { withFileTypes: true }).filter((d) => d.isDirectory());
  return dirs.length === 2;
}, 10);
const pastas = fs.readdirSync(artes, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
check('cria uma pasta para cada pedido em aberto', ok, pastas.join(' | '));
check(
  'pasta traz o número e o nome do cliente',
  pastas.some((n) => n.startsWith('0001 - Dona Marta')) && pastas.some((n) => n.startsWith('0002 - Batalhão')),
  pastas.join(' | ')
);
check(
  'caracteres proibidos em pasta são trocados',
  pastas.some((n) => n.includes('Batalhão 3º BE - Seção')),
  pastas.find((n) => n.startsWith('0002')) || ''
);

// --- 2. arquivo salvo dentro da pasta do cliente vai para o pedido dele ---
const pasta2 = path.join(artes, pastas.find((n) => n.startsWith('0002')));
fs.writeFileSync(path.join(pasta2, 'arte final.cdr'), Buffer.alloc(1500, 4));
const anexosDo2 = async () => {
  const res = await fetch(`${B}/orders/${pedido2.id}`, { headers: H });
  return (await res.json()).attachments || [];
};
ok = await esperar(async () => (await anexosDo2()).length === 1);
check('arquivo na pasta do cliente vai para o pedido dele (sem número no nome)', ok);
check('nome do arquivo é preservado', (await anexosDo2())[0]?.name === 'arte final.cdr');

// --- 3. na raiz, ainda vale o número no nome ---
fs.writeFileSync(path.join(artes, '0001 - dona marta.cdr'), Buffer.alloc(2048, 7));
ok = await esperar(async () => (await anexosDoPedido()).length === 1);
check('arquivo com número do pedido é anexado nele', ok, saida.join('').trim().split('\n').pop());
if (!ok) {
  console.log('--- saída do enviador ---');
  console.log(saida.join(''));
  console.log('-------------------------');
  filho.kill();
  server.close();
  process.exit(1);
}

let anexos = await anexosDoPedido();
check(
  'anexo entra como arte do pedido',
  anexos[0].name === '0001 - dona marta.cdr' && anexos[0].category === 'arte',
  `${anexos[0]?.name} / ${anexos[0]?.category}`
);

// --- 2. salvar de novo substitui, não duplica ---
const antesExcluidos = excluidos.length;
fs.writeFileSync(path.join(artes, '0001 - dona marta.cdr'), Buffer.alloc(4096, 9));
ok = await esperar(async () => {
  const a = await anexosDoPedido();
  return a.length === 1 && a[0].drive_file_id !== anexos[0].drive_file_id;
});
check('salvar de novo substitui a versão anterior', ok, `${(await anexosDoPedido()).length} anexo(s)`);
check('versão antiga é apagada do Drive', excluidos.length === antesExcluidos + 1);

// --- 3. sem número no nome cai nos Recebidos ---
fs.writeFileSync(path.join(artes, 'aposentadoria antonio.cdr'), Buffer.alloc(1024, 3));
ok = await esperar(async () => (await recebidos()).length === 1);
check('arquivo sem número cai nos Recebidos', ok);
const naCaixa = await recebidos();
check('nome preservado nos Recebidos', naCaixa[0]?.name === 'aposentadoria antonio.cdr', naCaixa[0]?.name);

// --- 4. arquivos temporários são ignorados ---
fs.writeFileSync(path.join(artes, '~$rascunho.cdr'), Buffer.alloc(64, 1));
fs.writeFileSync(path.join(artes, 'backup.bak'), Buffer.alloc(64, 1));
await new Promise((r2) => setTimeout(r2, 1500));
check(
  'temporários (~ e .bak) são ignorados',
  (await recebidos()).length === 1 && (await anexosDoPedido()).length === 1
);

// --- 5. não reenvia o que já subiu ---
const antesArquivos = arquivos.size;
await new Promise((r2) => setTimeout(r2, 1200));
check('não reenvia arquivo que já subiu', arquivos.size === antesArquivos, `${arquivos.size} envios`);

// --- 6. a janela explica o que aconteceu ---
const texto = saida.join('');
check('mostra para onde cada arquivo foi', /pedido #0001/.test(texto) && /recebidos/.test(texto));
check('avisa quando substitui', /substituiu a versão anterior/.test(texto));

filho.kill();
server.close();
fs.rmSync(base, { recursive: true, force: true });
console.log('\nFim dos testes do enviador.');
