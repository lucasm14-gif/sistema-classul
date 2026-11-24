#!/usr/bin/env node
// Fichas da placa (modo "Arte pelo Mac"): o Hermes atende, junta as informações e
// posta a ficha no agente Artes. Aqui no Mac o Claude busca a ficha, faz a arte com
// a skill placa-vetor e devolve a arte para o Lucas aprovar na aba Agentes.
//
//   node tools/fichas.mjs listar                     fichas esperando arte
//   node tools/fichas.mjs baixar ART21 [pasta]       ficha + logo/referências numa pasta
//   node tools/fichas.mjs entregar ART21 arte.jpg foto.jpg [vetor.pdf] [--texto "..."]
//
// Usa o API_TOKEN do .env (o mesmo login do sistema). Grava no sistema de verdade:
// "entregar" só depois de o Lucas dizer que a arte está boa.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lerEnv() {
  const env = {};
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) return env;
  for (const linha of fs.readFileSync(arq, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = { ...lerEnv(), ...process.env };
const BASE = String(env.SISTEMA_URL || 'https://sistema-classul.vercel.app').replace(/\/+$/, '');
const TOKEN = env.API_TOKEN;
if (!TOKEN) {
  console.error('Falta API_TOKEN no .env da raiz do sistema.');
  process.exit(1);
}
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'X-Classul-User': 'Lucas (Mac)' };

async function api(metodo, rota, corpo) {
  const res = await fetch(BASE + rota, {
    method: metodo,
    headers: corpo ? { ...HEADERS, 'Content-Type': 'application/json' } : HEADERS,
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    let msg = txt;
    try {
      msg = JSON.parse(txt).error || txt;
    } catch {}
    throw new Error(`${res.status}: ${String(msg).slice(0, 300)}`);
  }
  return res;
}

const slug = (s) =>
  String(s || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'cliente';

const MIMES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml', webp: 'image/webp' };

async function listar() {
  const lista = await (await api('GET', '/api/agentes/fichas')).json();
  if (!lista.length) return console.log('Nenhuma ficha esperando arte.');
  for (const f of lista) {
    const d = f.dados || {};
    console.log(`${f.codigo}  ${d.etapa || 'arte'}  ${d.cliente || '-'}  ${d.tamanho || ''} ${d.estojo || ''}  (${new Date(f.created_at).toLocaleString('pt-BR')})`);
  }
}

async function baixar(codigo, pasta) {
  const f = await (await api('GET', `/api/agentes/fichas/${encodeURIComponent(codigo)}`)).json();
  const d = f.dados || {};
  const dir = path.resolve(pasta || path.join(RAIZ, 'output', `placa-${slug(d.cliente)}-${f.codigo.toLowerCase()}`));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ficha.json'), JSON.stringify(f, null, 2));
  fs.writeFileSync(path.join(dir, 'ficha.txt'), `${f.codigo} · estado ${f.estado}\n\n${f.texto || ''}\n`);
  let n = 0;
  for (const a of f.anexos || []) {
    try {
      const res = await api('GET', `/api/agentes/arquivo?ref=${encodeURIComponent(a.ref)}`);
      const nome = (a.nome || `anexo-${++n}`).replace(/[^\w.\- ]/g, '_');
      fs.writeFileSync(path.join(dir, nome), Buffer.from(await res.arrayBuffer()));
      console.log('anexo:', nome);
    } catch (err) {
      console.log(`anexo ${a.ref} não baixou: ${err.message}`);
    }
  }
  console.log(`pasta: ${dir}`);
  console.log(`\n${f.texto}`);
}

async function entregar(codigo, args) {
  let texto = '';
  const arquivos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--texto') {
      texto = args[++i] || '';
      continue;
    }
    const p = path.resolve(args[i]);
    const buf = fs.readFileSync(p);
    if (buf.length > 3 * 1024 * 1024) throw new Error(`${path.basename(p)} passa de 3 MB: reduza antes (JPG qualidade 85).`);
    const ext = path.extname(p).slice(1).toLowerCase();
    arquivos.push({ base64: buf.toString('base64'), nome: path.basename(p), tipo: MIMES[ext] || 'application/octet-stream' });
  }
  if (!arquivos.length) throw new Error('Diga os arquivos: a arte (e a foto, o vetor).');
  const total = arquivos.reduce((s, a) => s + a.base64.length, 0);
  if (total > 4.3 * 1024 * 1024) throw new Error('Arquivos grandes demais juntos (limite ~3 MB somados). Entregue em duas vezes ou reduza.');
  const r = await (await api('POST', `/api/agentes/fichas/${encodeURIComponent(codigo)}/entregar`, { arquivos, texto })).json();
  console.log(`Entregue: ${r.codigo} no agente Artes, esperando o Lucas aprovar (${r.anexos.length} arquivo(s)).`);
}

const [cmd, ...resto] = process.argv.slice(2);
try {
  if (cmd === 'listar') await listar();
  else if (cmd === 'baixar' && resto[0]) await baixar(resto[0], resto[1]);
  else if (cmd === 'entregar' && resto[0]) await entregar(resto[0], resto.slice(1));
  else {
    console.log('Uso: node tools/fichas.mjs listar | baixar CODIGO [pasta] | entregar CODIGO arquivos... [--texto "..."]');
    process.exit(1);
  }
} catch (err) {
  console.error('Erro:', err.message);
  process.exit(1);
}
