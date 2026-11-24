// Conversas de teste do atendente (aba "Testar atendente").
//
// O Lucas faz papel de cliente numa conversa falsa. Cada conversa ganha um telefone
// de teste (55 00000 + 6 dígitos — DDD 00 não existe, então nunca bate num cliente
// de verdade). A mensagem dele vai ao Hermes igual a uma do WhatsApp, marcada com
// `teste: true`, e tudo o que o Hermes mandar para esse telefone (texto, foto,
// arquivo) é desviado para cá em vez de sair pela Evolution.
// Apagar a conversa limpa tudo dela: mensagens, histórico do atendimento e os avisos
// que ela gerou nos agentes. Pedidos criados no teste são arquivados (dá para desfazer).
import { q } from './db.js';
import { notifyHermes } from './hermes-events.js';

const PREFIXO = '5500000';
export const ehTelefoneDeTeste = (phone) => new RegExp(`^${PREFIXO}\\d{6}$`).test(String(phone || ''));
const LIMITE_ARQUIVO = 3 * 1024 * 1024;

export class TesteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (v, max = 4000) => String(v ?? '').trim().slice(0, max);

let ready = null;
export function ensureTestesSchema() {
  if (!ready) ready = initSchema().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

async function initSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS teste_conversas (
      id SERIAL PRIMARY KEY,
      telefone TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS teste_mensagens (
      id SERIAL PRIMARY KEY,
      telefone TEXT NOT NULL,
      de TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'texto',
      texto TEXT,
      arquivo_nome TEXT,
      arquivo_mime TEXT,
      arquivo_base64 TEXT,
      arquivo_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

const formatar = (m) => ({
  id: m.id,
  de: m.de,
  tipo: m.tipo,
  texto: m.texto,
  arquivo: m.arquivo_nome || m.arquivo_url
    ? { nome: m.arquivo_nome, mime: m.arquivo_mime, url: m.arquivo_url, ref: m.arquivo_base64 ? `teste:${m.id}` : null }
    : null,
  created_at: m.created_at
});

export async function listarConversas() {
  await ensureTestesSchema();
  const { rows } = await q('SELECT * FROM teste_conversas ORDER BY updated_at DESC, id DESC');
  const { rows: ult } = await q('SELECT telefone, de, texto, tipo, id FROM teste_mensagens ORDER BY id DESC LIMIT 2000');
  return rows.map((c) => {
    const u = ult.find((m) => m.telefone === c.telefone);
    return { ...c, ultima: u ? { de: u.de, texto: u.texto || (u.tipo === 'imagem' ? 'Foto' : 'Arquivo') } : null };
  });
}

export async function criarConversa(nome) {
  await ensureTestesSchema();
  const n = clean(nome, 60) || 'Cliente de teste';
  for (let i = 0; i < 20; i++) {
    const telefone = PREFIXO + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    const { rows: existe } = await q('SELECT 1 FROM teste_conversas WHERE telefone = $1', [telefone]);
    if (existe.length) continue;
    const { rows } = await q('INSERT INTO teste_conversas (telefone, nome) VALUES ($1, $2) RETURNING *', [telefone, n]);
    return rows[0];
  }
  throw new TesteError('Não consegui criar a conversa. Tente de novo.');
}

async function getConversa(telefone) {
  await ensureTestesSchema();
  const { rows } = await q('SELECT * FROM teste_conversas WHERE telefone = $1', [String(telefone)]);
  if (!rows[0]) throw new TesteError('Conversa de teste não encontrada.', 404);
  return rows[0];
}

export async function mensagens(telefone) {
  const c = await getConversa(telefone);
  const { rows } = await q(
    'SELECT id, telefone, de, tipo, texto, arquivo_nome, arquivo_mime, arquivo_url, (arquivo_base64 IS NOT NULL) AS tem_arquivo, created_at FROM teste_mensagens WHERE telefone = $1 ORDER BY id ASC',
    [c.telefone]
  );
  return { conversa: c, mensagens: rows.map((m) => formatar({ ...m, arquivo_base64: m.tem_arquivo ? 'x' : null })) };
}

async function gravar(telefone, { de, tipo = 'texto', texto = null, nome = null, mime = null, base64 = null, url = null }) {
  await ensureTestesSchema();
  const { rows } = await q(
    `INSERT INTO teste_mensagens (telefone, de, tipo, texto, arquivo_nome, arquivo_mime, arquivo_base64, arquivo_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [telefone, de, tipo, texto, nome, mime, base64, url]
  );
  await q('UPDATE teste_conversas SET updated_at = now() WHERE telefone = $1', [telefone]);
  return rows[0];
}

// O "cliente" (Lucas) manda uma mensagem: grava e entrega ao Hermes como se fosse do WhatsApp.
export async function clienteEscreve(telefone, { texto, imagem_base64, arquivo_nome, arquivo_mime } = {}) {
  const c = await getConversa(telefone);
  const txt = clean(texto);
  let arquivo = null;
  if (imagem_base64) {
    const limpo = String(imagem_base64).replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    const tamanho = Buffer.from(limpo, 'base64').length;
    if (!tamanho) throw new TesteError('Arquivo inválido.');
    if (tamanho > LIMITE_ARQUIVO) throw new TesteError('Arquivo acima de 3 MB.', 413);
    arquivo = { base64: limpo, nome: clean(arquivo_nome, 120) || 'arquivo', mime: clean(arquivo_mime, 80) || 'application/octet-stream' };
  }
  if (!txt && !arquivo) throw new TesteError('Escreva uma mensagem ou anexe um arquivo.');
  const tipo = arquivo ? (/^image\//.test(arquivo.mime) ? 'imagem' : 'documento') : 'texto';
  const m = await gravar(c.telefone, { de: 'cliente', tipo, texto: txt || null, nome: arquivo?.nome, mime: arquivo?.mime, base64: arquivo?.base64 });

  // Mesmo registro do atendimento real, para historico_conversa funcionar igual.
  await q(
    `INSERT INTO bot_conversations (phone, push_name) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET push_name = EXCLUDED.push_name, updated_at = now()`,
    [c.telefone, c.nome]
  );
  await q('INSERT INTO bot_messages (phone, role, content, wa_message_id) VALUES ($1, $2, $3, $4)', [
    c.telefone,
    'user',
    txt || (tipo === 'imagem' ? '[foto]' : '[arquivo]'),
    `teste-${m.id}`
  ]);

  const entrega = await notifyHermes('mensagem.recebida', {
    telefone: c.telefone,
    de_mim: false,
    nome: c.nome,
    texto: txt,
    tipo: tipo === 'texto' ? 'conversation' : tipo === 'imagem' ? 'imageMessage' : 'documentMessage',
    wa_message_id: `teste-${m.id}`,
    atender: true,
    motivo: 'conversa de teste',
    teste: true,
    arquivo: arquivo ? { ref: `teste:${m.id}`, nome: arquivo.nome, tipo: arquivo.mime } : null
  });
  return { mensagem: formatar(m), entregue_ao_hermes: Boolean(entrega?.sent), erro: entrega?.sent ? null : entrega?.error || entrega?.skipped || (entrega?.status ? `o Hermes respondeu HTTP ${entrega.status}` : 'o Hermes não respondeu') };
}

// Desvio da Evolution: o que o sistema mandaria para um telefone de teste fica aqui.
export async function desviarEnvio(telefone, { tipo, texto, base64, mime, nome, url }) {
  await ensureTestesSchema();
  const { rows } = await q('SELECT 1 FROM teste_conversas WHERE telefone = $1', [telefone]);
  if (!rows.length) throw new TesteError('Esta conversa de teste foi apagada.', 404);
  const m = await gravar(telefone, { de: 'atendente', tipo, texto: texto || null, nome, mime, base64, url });
  return { key: { id: `teste-${m.id}` }, teste: true };
}

export async function arquivo(id) {
  await ensureTestesSchema();
  const { rows } = await q('SELECT arquivo_nome, arquivo_mime, arquivo_base64 FROM teste_mensagens WHERE id = $1', [Number(id)]);
  const m = rows[0];
  if (!m?.arquivo_base64) throw new TesteError('Arquivo de teste não encontrado.', 404);
  return { buffer: Buffer.from(m.arquivo_base64, 'base64'), nome: m.arquivo_nome || `teste-${id}`, mime: m.arquivo_mime || 'application/octet-stream' };
}

export async function apagarConversa(telefone) {
  const c = await getConversa(telefone);
  await q('DELETE FROM teste_mensagens WHERE telefone = $1', [c.telefone]);
  await q('DELETE FROM bot_messages WHERE phone = $1', [c.telefone]);
  await q('DELETE FROM bot_conversations WHERE phone = $1', [c.telefone]);
  // Avisos nos agentes que vieram deste teste (as tabelas só existem se os agentes já rodaram).
  await q("DELETE FROM agente_mensagens WHERE referencia = $1", [c.telefone]).catch(() => {});
  await q("DELETE FROM nf_rascunhos WHERE telefone_cliente = $1 AND nota_id IS NULL", [c.telefone]).catch(() => {});
  const { rowCount: arquivados } = await q('UPDATE orders SET archived = 1 WHERE phone = $1 AND archived = 0', [c.telefone]);
  await q('DELETE FROM teste_conversas WHERE telefone = $1', [c.telefone]);
  return { apagada: c.telefone, pedidos_arquivados: arquivados || 0 };
}
