// Testa a área Estudos do app Ideal: aula, questões e dúvidas pedidas ao Hermes
// pela chave do iPhone. Nada sai para a internet: banco em pg-mem e Hermes falso.
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

const CHAVE = 'chave-estudos';
const AULA = {
  titulo: 'Os tons',
  resumo: 'O tom muda o sentido.',
  secoes: [{ titulo: '1. Tom 1', texto: 'Voz alta e reta: **mā**.' }, { titulo: 'Vazia', texto: '' }],
  vocab: [{ hanzi: '妈', pinyin: 'mā', pt: 'mãe' }, { hanzi: '', pinyin: 'x', pt: 'sem caractere' }],
  dicas: ['Treine em voz alta']
};
const QUESTOES = {
  questoes: [
    { enunciado: '1. O que é 妈?', alternativas: ['A) mãe', 'cavalo', 'xingar', 'cânhamo'], correta: 0, explicacao: 'mā = mãe' },
    { enunciado: 'Quebrada', alternativas: ['a', 'b'], correta: 5, explicacao: '' }
  ]
};

let modo = 'normal';
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
    const pedido = JSON.parse(body || '{}');
    recebidos.push(pedido);
    if (modo === 'imagem') return send(200, { ok: true, tarefa: 'T1', status: 'processando' });
    if (pedido.texto.includes('"questoes"')) return send(200, { ok: true, texto: '```json\n' + JSON.stringify(QUESTOES) + '\n```' });
    if (pedido.texto.includes('"secoes"')) return send(200, { ok: true, texto: JSON.stringify(AULA) });
    send(200, { ok: true, texto: 'Porque o tom faz parte da palavra.' });
  });
});
await new Promise((r) => hermes.listen(3149, r));

const server = app.listen(3148);
const B = 'http://localhost:3148/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

await ensureSchema();
await setSettings({ hermes_ai_url: 'http://localhost:3149/claude', hermes_ai_key: CHAVE });

// chave do iPhone
let r = await fetch(`${B}/ideal/pin`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '4242' }) });
const token = (await r.json()).token;
r = await fetch(`${B}/ideal/sync-key`, { method: 'POST', headers: { ...H, 'X-Ideal-Token': token } });
const key = (await r.json()).key;
check('gera a chave do iPhone', Boolean(key));

const STUDY = (body, k = key) =>
  fetch(`${B}/ideal/study`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ideal-Key': k }, body: JSON.stringify(body) });

r = await STUDY({ tipo: 'aula', trilha: 'chines', tema: 'Os 4 tons' }, 'ideal_errada');
check('sem a chave do iPhone é recusado', r.status === 401);

r = await STUDY({ tipo: 'aula', trilha: 'chines', tema: 'Os 4 tons', anteriores: ['Pinyin: iniciais'] });
let b = await r.json();
check('aula de chinês volta limpa', r.status === 200 && b.secoes.length === 1 && b.vocab.length === 1 && b.vocab[0].hanzi === '妈' && b.dicas.length === 1 && b.secoes[0].titulo === 'Tom 1', JSON.stringify(b));
let prompt = recebidos.at(-1);
check('pedido vai como texto, com o tema e o que ele já estudou', prompt.modo === 'texto' && prompt.texto.includes('Os 4 tons') && prompt.texto.includes('Pinyin: iniciais') && prompt.texto.includes('"vocab"'));

r = await STUDY({ tipo: 'aula', trilha: 'enem', area: 'Matemática', tema: 'Porcentagem' });
b = await r.json();
check('aula de ENEM não traz vocabulário', r.status === 200 && b.vocab.length === 0 && !recebidos.at(-1).texto.includes('"vocab"'));

r = await STUDY({ tipo: 'questoes', trilha: 'enem', area: 'Matemática', tema: 'Porcentagem', evitar: ['Uma loja deu 25% de desconto'] });
b = await r.json();
prompt = recebidos.at(-1).texto;
check('questões inválidas são descartadas', r.status === 200 && b.questoes.length === 1 && b.questoes[0].correta === 0 && b.questoes[0].enunciado === 'O que é 妈?' && b.questoes[0].alternativas[0] === 'mãe');
check('ENEM pede 5 alternativas e evita repetir', prompt.includes('5 alternativas') && prompt.includes('Uma loja deu 25%'));

r = await STUDY({ tipo: 'pergunta', trilha: 'chines', tema: 'Os 4 tons', pergunta: 'Por que o tom importa?', historico: [{ p: 'oi', r: 'olá' }] });
b = await r.json();
prompt = recebidos.at(-1).texto;
check('dúvida volta em texto', r.status === 200 && b.resposta.startsWith('Porque'));
check('dúvida leva a conversa anterior', prompt.includes('ALUNO: oi') && prompt.includes('Por que o tom importa?'));

r = await STUDY({ tipo: 'aula', trilha: 'fisica', tema: 'x' });
check('trilha desconhecida é recusada', r.status === 400);
r = await STUDY({ tipo: 'pergunta', trilha: 'enem', tema: 'x', pergunta: '' });
check('pergunta vazia é recusada', r.status === 400);

modo = 'imagem';
r = await STUDY({ tipo: 'aula', trilha: 'enem', tema: 'Porcentagem' });
b = await r.json();
check('se o Hermes virar imagem, avisa', r.status === 502 && /imagem/.test(b.error), JSON.stringify(b));

server.close();
hermes.close();
