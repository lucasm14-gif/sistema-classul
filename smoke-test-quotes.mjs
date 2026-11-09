// Testa o orçamento em PDF da extensão: leitura pelo Hermes (resposta rápida e
// tarefa demorada), conferência do que falta e o PDF no papel timbrado.
// Nada sai para a internet: banco em pg-mem e um "Hermes" falso local.
process.env.API_TOKEN = 'teste-token';
delete process.env.HERMES_CLAUDE_KEY;
delete process.env.HERMES_AI_KEY;

import http from 'node:http';
import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests, setSettings, ensureSchema } = await import(`file://${ROOT}/lib/db.js`);
const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());
const { default: app } = await import(`file://${ROOT}/api/index.js`);
const { neutralize, toNumber, normalizeQuote, dataPorExtenso } = await import(`file://${ROOT}/lib/quotes.js`);

const CHAVE = 'chave-orcamento';
const RESPOSTA = {
  destinatario: 'BRIGADA MILITAR DE MONTENEGRO-RS',
  aos_cuidados: 'Compras',
  itens: [
    { descricao: 'Placa aço inox escovado gravado tam 60x80cm', quantidade: 1, valor_unitario: 3250 },
    { descricao: 'Placa aço inox escovado gravado tam 25x35cm', quantidade: 1, valor_unitario: null }
  ],
  prazo_producao: '',
  entrega: '',
  validade: '',
  observacoes: '',
  faltando: ['Qual o valor da placa 25x35?']
};

// modo do Hermes falso: 'rapido' devolve texto; 'tarefa' devolve uma tarefa que fica pronta na 2ª consulta
let modo = 'rapido';
let consultas = 0;
const recebidos = [];
const hermes = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.authorization !== `Bearer ${CHAVE}`) return send(401, { ok: false, erro: 'sem chave' });
    if (req.method === 'POST') {
      recebidos.push(JSON.parse(body || '{}'));
      if (modo === 'tarefa') return send(200, { ok: true, tarefa: 'T123', status: 'processando' });
      return send(200, { ok: true, texto: '```json\n' + JSON.stringify(RESPOSTA) + '\n```' });
    }
    if (req.url === '/claude/tarefa/T123') {
      consultas++;
      if (consultas < 2) return send(200, { ok: true, status: 'processando' });
      return send(200, { ok: true, status: 'pronta', texto: JSON.stringify(RESPOSTA) });
    }
    send(404, { ok: false, erro: 'rota' });
  });
});
await new Promise((r) => hermes.listen(3147, r));

const server = app.listen(3146);
const B = 'http://localhost:3146/api';
const ADMIN = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};
const post = async (path, body, headers = ADMIN) => {
  const r = await fetch(B + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

await ensureSchema();

const MSGS = [
  { from_me: false, time: '10:01, 22/10/2026', text: 'Bom dia, aqui é da Brigada Militar de Montenegro, setor de compras.' },
  { from_me: false, time: '10:02, 22/10/2026', text: 'Precisamos de orçamento de 2 placas de inox: uma 60x80 e uma 25x35. Pode criar a arte com as fotos?' },
  { from_me: true, time: '10:10, 22/10/2026', text: 'A de 60x80 fica R$ 3.250,00' },
  { from_me: false, time: '10:11, 22/10/2026', text: '' }
];

// ---------------------------------------------------------------- 1. funções puras
check('valores em reais viram número', toNumber('R$ 3.250,00') === 3250 && toNumber('598') === 598 && toNumber('1.234') === 1234 && toNumber('0') === null);
check('palavras que viram pedido de imagem são trocadas', !/\b(arte|fotos|criar)\b/i.test(neutralize('Pode criar a arte com as fotos?')));
check('"parte" e "criança" não são mexidas', neutralize('parte da criança') === 'parte da criança');
check('data por extenso', dataPorExtenso(new Date('2026-10-22T15:00:00Z')) === 'Porto Alegre, 22 de outubro de 2026.');
const n = normalizeQuote({ itens: [{ descricao: 'Placa', valor_unitario: null }] });
check('conferência aponta destinatário e valor faltando', n.faltando.map((f) => f.campo).join() === 'destinatario,itens.0.valor_unitario');

// ---------------------------------------------------------------- 2. sem chave
let r = await post('/quotes/analyze', { messages: MSGS });
check('sem chave configurada pede para configurar', r.status === 400 && /chave do Hermes/.test(r.body.error), r.body.error);

r = await fetch(B + '/quotes/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('rota exige o login do sistema', r.status === 401);

await setSettings({ hermes_ai_url: 'http://localhost:3147/claude', hermes_ai_key: CHAVE });

r = await post('/quotes/analyze', { messages: [{ text: '   ' }] });
check('conversa sem texto é recusada', r.status === 400);

// ---------------------------------------------------------------- 3. resposta rápida
r = await post('/quotes/analyze', { messages: MSGS, contact: { name: 'BM Montenegro' } });
check('Hermes rápido devolve o orçamento', r.status === 200 && r.body.done === true, JSON.stringify(r.body).slice(0, 200));
check('itens e valor vieram', r.body.quote?.itens?.length === 2 && r.body.quote.itens[0].valor_unitario === 3250);
check('padrões do papel timbrado preenchidos', r.body.quote?.validade === '30 DIAS' && /RETIRADA/.test(r.body.quote?.entrega));
check('falta o valor do item 2', r.body.faltando?.some((f) => f.campo === 'itens.1.valor_unitario'));
check('pergunta do Hermes chega ao painel', r.body.perguntas?.[0] === 'Qual o valor da placa 25x35?');
const prompt = recebidos.at(-1)?.texto || '';
check('mensagem vazia fica de fora e a conversa vai como dado', prompt.includes('[CLASSUL 10:10, 22/10/2026] A de 60x80 fica R$ 3.250,00') && !prompt.includes('10:11'));
check('texto enviado ao Hermes não aciona imagem', !/\b(criar|arte|fotos)\b/i.test(prompt.split('--- CONVERSA')[1] || ''));

// ---------------------------------------------------------------- 4. tarefa demorada
modo = 'tarefa';
r = await post('/quotes/analyze', { messages: MSGS });
check('tarefa demorada volta para a extensão consultar', r.body.done === false && r.body.task === 'T123');
r = { body: await (await fetch(B + '/quotes/task/T123', { headers: ADMIN })).json() };
check('primeira consulta ainda processando', r.body.done === false);
r = { body: await (await fetch(B + '/quotes/task/T123', { headers: ADMIN })).json() };
check('segunda consulta traz o orçamento', r.body.done === true && r.body.quote?.itens?.length === 2);
r = await fetch(B + '/quotes/task/..%2Fsegredo', { headers: ADMIN });
check('id de tarefa estranho é recusado', r.status === 400);

// ---------------------------------------------------------------- 5. PDF
r = await post('/quotes/pdf', { quote: { destinatario: 'x', itens: [] } });
check('PDF sem item é recusado', r.status === 400);
r = await post('/quotes/pdf', {
  quote: { ...RESPOSTA, itens: [RESPOSTA.itens[0], { ...RESPOSTA.itens[1], valor_unitario: '598,00', quantidade: 3 }] }
});
const pdf = Buffer.from(r.body.base64 || '', 'base64');
check('PDF gerado', r.status === 200 && pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 50000, `${pdf.length} bytes`);
check('nome do arquivo', r.body.file_name === 'Orçamento - BRIGADA MILITAR DE MONTENEGRO-RS.pdf', r.body.file_name);
if (process.argv[2]) (await import('node:fs')).writeFileSync(process.argv[2], pdf);

// muitos itens não quebram (vai para a 2ª página)
const muitos = Array.from({ length: 18 }, (_, i) => ({ descricao: `Medalha modelo ${i + 1} com fita personalizada`, quantidade: 10, valor_unitario: 12.5 }));
r = await post('/quotes/pdf', { quote: { destinatario: 'Escola', itens: muitos } });
check('orçamento comprido também sai', r.status === 200 && Buffer.from(r.body.base64, 'base64').toString('latin1').match(/\/Type \/Page\b/g)?.length >= 2);

// ---------------------------------------------------------------- 6. config do Hermes
r = { body: await (await fetch(B + '/hermes/config', { headers: ADMIN })).json() };
check('tela do Hermes mostra a rota e que a chave existe (sem mostrar a chave)', r.body.ai_url === 'http://localhost:3147/claude' && r.body.ai_key_set === true && !JSON.stringify(r.body).includes(CHAVE));

server.close();
hermes.close();
