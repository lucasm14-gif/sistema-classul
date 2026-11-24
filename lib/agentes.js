// Agentes: conversas no estilo WhatsApp dentro do sistema (aba Agentes), cada uma
// cuidando de um assunto — Notas fiscais, Artes para aprovar, Pendências, Dúvidas,
// Orçamentos — e quantos mais o Hermes criar.
//
// Quem escreve nos agentes é o Hermes (e o Claude dele). Quem responde é o Lucas,
// na tela. Cada resposta vira o evento `agente.resposta` para o Hermes (e também
// fica disponível em `agente_respostas`, para quem preferir buscar).
//
// Nota fiscal tem regra própria: o Hermes só monta o RASCUNHO. Quem emite é o
// próprio sistema, quando o Lucas clica em Aprovar na tela com o PIN das Notas.
// Não existe ferramenta do Hermes que aprove ou emita nota.
import { q, getSettings, setSettings } from './db.js';
import { OrderError, getOrder } from './orders.js';
import { formatOrderNumber, normalizePhone, sendDocument } from './whatsapp.js';
import { ensureAgentsFolder, ensureOrderFolder, uploadBufferToFolder, downloadFile, getFileMeta } from './google.js';
import { notifyHermes } from './hermes-events.js';
import { renderQuotePdf, normalizeQuote, quoteFileName } from './quotes.js';
import * as nfe from './nfe/service.js';
import { prepareItems } from './nfe/xml.js';
import { ehTelefoneDeTeste } from './testes.js';

export const AGENTES_PADRAO = [
  { slug: 'artes', nome: 'Artes para aprovar', descricao: 'Artes e fotos que o Claude montou, esperando o seu ok antes de ir ao cliente.', cor: '#62bb46', ordem: 1 },
  { slug: 'notas', nome: 'Notas fiscais', descricao: 'Rascunhos de NF-e para aprovar. Aprovou, o sistema emite.', cor: '#2563eb', ordem: 2 },
  { slug: 'duvidas', nome: 'Dúvidas', descricao: 'Perguntas de clientes que o atendente não sabe responder. O cliente espera a sua resposta.', cor: '#ee3b33', ordem: 3 },
  { slug: 'pendencias', nome: 'Pendências', descricao: 'Estojo colorido para conferir, prazos apertados, tarefas paradas, erros.', cor: '#f59e0b', ordem: 4 },
  { slug: 'orcamentos', nome: 'Orçamentos', descricao: 'Orçamentos em PDF que o atendente gerou e mandou.', cor: '#8b5cf6', ordem: 5 },
  { slug: 'descontos', nome: 'Descontos', descricao: 'Cliente pediu desconto (5 unidades ou mais): a situação e quanto você deixa dar.', cor: '#0d9488', ordem: 6 }
];

export const TIPOS = ['info', 'aprovacao', 'pergunta'];
const LIMITE_ARQUIVO = 3 * 1024 * 1024; // a Vercel não aceita corpo bem maior que isso em base64

export class AgenteError extends OrderError {}

const clean = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
const parseJson = (v, fallback) => {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ------------------------------------------------------------------ schema

let ready = null;
export function ensureAgentesSchema() {
  if (!ready) ready = initSchema().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

async function initSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS agentes (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      descricao TEXT,
      cor TEXT,
      ordem INTEGER NOT NULL DEFAULT 100,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS agente_mensagens (
      id SERIAL PRIMARY KEY,
      agente_id INTEGER NOT NULL,
      autor TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'info',
      texto TEXT,
      anexos TEXT,
      referencia TEXT,
      codigo TEXT,
      estado TEXT,
      resposta TEXT,
      respondido_por TEXT,
      respondido_em TIMESTAMPTZ,
      nf_rascunho_id INTEGER,
      lida INTEGER NOT NULL DEFAULT 0,
      entregue INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS nf_rascunhos (
      id SERIAL PRIMARY KEY,
      estado TEXT NOT NULL DEFAULT 'aguardando',
      dados TEXT NOT NULL,
      resumo TEXT,
      pedido TEXT,
      telefone_cliente TEXT,
      nota_id INTEGER,
      erro TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  for (const a of AGENTES_PADRAO) {
    await q(
      'INSERT INTO agentes (slug, nome, descricao, cor, ordem) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (slug) DO NOTHING',
      [a.slug, a.nome, a.descricao, a.cor, a.ordem]
    );
  }
}

// ------------------------------------------------------------------ agentes

async function acharAgente(chave) {
  await ensureAgentesSchema();
  const k = String(chave ?? '').trim();
  const { rows } = /^\d+$/.test(k)
    ? await q('SELECT * FROM agentes WHERE id = $1', [Number(k)])
    : await q('SELECT * FROM agentes WHERE slug = $1', [slugify(k)]);
  if (!rows[0]) throw new AgenteError(`Agente "${k}" não existe. Veja os agentes com agentes_listar ou crie com agente_criar.`, 404);
  return rows[0];
}

export async function listarAgentes() {
  await ensureAgentesSchema();
  const { rows: agentes } = await q('SELECT * FROM agentes WHERE ativo = 1 ORDER BY ordem ASC, id ASC');
  const { rows: msgs } = await q('SELECT id, agente_id, autor, tipo, texto, estado, lida, created_at FROM agente_mensagens ORDER BY id DESC LIMIT 2000');
  const settings = await getSettings();
  return {
    arte_automatica: settings.atendente_arte_automatica === '1',
    agentes: agentes.map((a) => {
      const minhas = msgs.filter((m) => m.agente_id === a.id);
      const ultima = minhas[0] || null;
      return {
        id: a.id,
        slug: a.slug,
        nome: a.nome,
        descricao: a.descricao,
        cor: a.cor,
        esperando_lucas: minhas.filter((m) => m.estado === 'pendente').length,
        nao_lidas: minhas.filter((m) => m.autor !== 'lucas' && !Number(m.lida)).length,
        ultima: ultima ? { autor: ultima.autor, texto: clean(ultima.texto, 120), em: ultima.created_at } : null
      };
    })
  };
}

export async function criarAgente({ slug, nome, descricao, cor } = {}) {
  await ensureAgentesSchema();
  const n = clean(nome, 60);
  if (!n) throw new AgenteError('Dê um nome ao agente.');
  const s = slugify(slug || n);
  if (!s) throw new AgenteError('Nome inválido.');
  const { rows: existe } = await q('SELECT * FROM agentes WHERE slug = $1', [s]);
  if (existe[0]) {
    await q('UPDATE agentes SET ativo = 1 WHERE id = $1', [existe[0].id]);
    return { ...existe[0], ativo: 1, ja_existia: true };
  }
  const corOk = /^#[0-9a-f]{6}$/i.test(String(cor || '')) ? cor : '#64748b';
  const { rows } = await q(
    'INSERT INTO agentes (slug, nome, descricao, cor) VALUES ($1, $2, $3, $4) RETURNING *',
    [s, n, clean(descricao, 300) || null, corOk]
  );
  return rows[0];
}

// ------------------------------------------------------------------ mensagens

function formatarMensagem(m) {
  return {
    id: m.id,
    agente_id: m.agente_id,
    autor: m.autor,
    tipo: m.tipo,
    texto: m.texto,
    anexos: parseJson(m.anexos, []),
    referencia: m.referencia,
    codigo: m.codigo,
    estado: m.estado,
    resposta: m.resposta,
    respondido_por: m.respondido_por,
    respondido_em: m.respondido_em,
    nf_rascunho_id: m.nf_rascunho_id,
    lida: Boolean(Number(m.lida)),
    created_at: m.created_at
  };
}

function normalizarAnexos(lista) {
  return (Array.isArray(lista) ? lista : [])
    .map((a) => (typeof a === 'string' ? { ref: a } : a || {}))
    .filter((a) => /^(drive|nfe|placa|teste):/.test(String(a.ref || '')))
    .slice(0, 10)
    .map((a) => ({ ref: String(a.ref), nome: clean(a.nome, 120) || null, tipo: clean(a.tipo, 80) || null }));
}

export async function postar({ agente, texto, anexos, tipo = 'info', referencia, autor = 'hermes', nf_rascunho_id = null } = {}) {
  const a = await acharAgente(agente);
  const t = TIPOS.includes(tipo) || tipo === 'nf' || tipo === 'mensagem' ? tipo : 'info';
  const txt = clean(texto, 6000);
  const lista = normalizarAnexos(anexos);
  if (!txt && !lista.length) throw new AgenteError('Mensagem vazia: mande texto ou anexo.');
  const espera = ['aprovacao', 'pergunta', 'nf'].includes(t);
  const { rows } = await q(
    `INSERT INTO agente_mensagens (agente_id, autor, tipo, texto, anexos, referencia, estado, nf_rascunho_id, lida, entregue)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [a.id, autor, t, txt || null, JSON.stringify(lista), clean(referencia, 200) || null, espera ? 'pendente' : null, nf_rascunho_id,
      autor === 'lucas' ? 1 : 0, autor === 'lucas' ? 0 : 1]
  );
  let m = rows[0];
  if (espera) {
    const codigo = `${a.slug.replace(/-/g, '').slice(0, 3).toUpperCase()}${m.id}`;
    ({ rows: [m] } = await q('UPDATE agente_mensagens SET codigo = $2 WHERE id = $1 RETURNING *', [m.id, codigo]));
  }
  return { ...formatarMensagem(m), agente: a.slug };
}

export async function mensagensDoAgente(chave, { limite = 200, marcarLidas = true } = {}) {
  const a = await acharAgente(chave);
  const { rows } = await q(
    'SELECT * FROM agente_mensagens WHERE agente_id = $1 ORDER BY id DESC LIMIT $2',
    [a.id, Math.min(500, Math.max(1, Number(limite) || 200))]
  );
  if (marcarLidas) await q("UPDATE agente_mensagens SET lida = 1 WHERE agente_id = $1 AND autor <> 'lucas' AND lida = 0", [a.id]);
  return { agente: a, mensagens: rows.reverse().map(formatarMensagem) };
}

async function getMensagem(id) {
  await ensureAgentesSchema();
  const { rows } = await q('SELECT * FROM agente_mensagens WHERE id = $1', [Number(id)]);
  if (!rows[0]) throw new AgenteError('Mensagem não encontrada.', 404);
  return rows[0];
}

async function avisarHermes(m, agente) {
  const fm = formatarMensagem(m);
  await notifyHermes('agente.resposta', {
    agente: agente.slug,
    mensagem_id: fm.id,
    codigo: fm.codigo,
    tipo: fm.tipo,
    decisao: fm.estado,
    resposta: fm.resposta,
    referencia: fm.referencia,
    texto_original: clean(fm.texto, 600),
    por: fm.respondido_por
  });
}

// O Lucas decide numa mensagem que espera por ele.
//   decisao: 'aprovado' | 'corrigir' (aprovação), 'respondido' (pergunta).
// Nota fiscal NÃO passa por aqui para aprovar: usa aprovarNf (exige o PIN das Notas).
export async function decidir(id, { decisao, resposta } = {}, user = 'Lucas') {
  const m = await getMensagem(id);
  if (m.estado !== 'pendente') throw new AgenteError('Esta mensagem já foi respondida.');
  const r = clean(resposta, 4000);
  let estado;
  if (m.tipo === 'nf') {
    if (decisao !== 'corrigir' && decisao !== 'recusado') throw new AgenteError('Nota fiscal se aprova pelo botão Aprovar e emitir, com o PIN das Notas.');
    estado = decisao;
    await q("UPDATE nf_rascunhos SET estado = $2, erro = $3, updated_at = now() WHERE id = $1", [m.nf_rascunho_id, estado === 'corrigir' ? 'corrigir' : 'recusado', r || null]);
  } else if (m.tipo === 'pergunta') {
    if (!r) throw new AgenteError('Escreva a resposta.');
    estado = 'respondido';
  } else {
    if (!['aprovado', 'corrigir'].includes(decisao)) throw new AgenteError('Escolha aprovar ou corrigir.');
    if (decisao === 'corrigir' && !r) throw new AgenteError('Escreva o que precisa corrigir.');
    estado = decisao;
  }
  const { rows } = await q(
    `UPDATE agente_mensagens SET estado = $2, resposta = $3, respondido_por = $4, respondido_em = now(), entregue = 0, lida = 1
     WHERE id = $1 RETURNING *`,
    [m.id, estado, r || null, clean(user, 60) || 'Lucas']
  );
  const agente = await acharAgente(m.agente_id);
  await avisarHermes(rows[0], agente);
  return formatarMensagem(rows[0]);
}

// O Lucas escreve no chat de um agente (instrução livre para o Hermes).
export async function lucasEscreve(chave, texto, user = 'Lucas') {
  const txt = clean(texto, 4000);
  if (!txt) throw new AgenteError('Escreva a mensagem.');
  const msg = await postar({ agente: chave, texto: txt, tipo: 'mensagem', autor: 'lucas' });
  await q('UPDATE agente_mensagens SET respondido_por = $2 WHERE id = $1', [msg.id, clean(user, 60) || 'Lucas']);
  await notifyHermes('agente.mensagem', { agente: msg.agente, mensagem_id: msg.id, texto: txt, por: clean(user, 60) || 'Lucas' });
  return msg;
}

// Para o Hermes buscar o que o Lucas decidiu/escreveu e ainda não foi entregue.
export async function respostasNaoEntregues({ marcar = true } = {}) {
  await ensureAgentesSchema();
  const { rows } = await q(
    `SELECT m.*, a.slug AS agente_slug FROM agente_mensagens m JOIN agentes a ON a.id = m.agente_id
     WHERE m.entregue = 0 AND (m.autor = 'lucas' OR m.estado IN ('aprovado', 'corrigir', 'respondido', 'recusado', 'emitida', 'erro'))
     ORDER BY m.id ASC LIMIT 100`
  );
  if (marcar && rows.length) {
    for (const r of rows) await q('UPDATE agente_mensagens SET entregue = 1 WHERE id = $1', [r.id]);
  }
  return rows.map((r) => ({ agente: r.agente_slug, ...formatarMensagem(r) }));
}

export async function setArteAutomatica(ligado) {
  await setSettings({ atendente_arte_automatica: ligado ? '1' : '0' });
  await notifyHermes('atendente.fase', { arte_automatica: Boolean(ligado) });
  return { arte_automatica: Boolean(ligado) };
}

// ------------------------------------------------------------------ arquivos

function bufferDoBase64(base64) {
  const limpo = String(base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!limpo) throw new AgenteError('Arquivo vazio.');
  const buf = Buffer.from(limpo, 'base64');
  if (!buf.length) throw new AgenteError('Base64 inválido.');
  if (buf.length > LIMITE_ARQUIVO) throw new AgenteError('Arquivo acima de 3 MB. Reduza (JPG com qualidade 85 costuma bastar).', 413);
  return buf;
}

const MIMES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml', cdr: 'application/octet-stream', webp: 'image/webp' };
const mimeDoNome = (nome) => MIMES[String(nome).split('.').pop().toLowerCase()] || 'application/octet-stream';

// Sobe um arquivo (base64) para a pasta dos agentes no Drive e devolve a ref.
export async function subirArquivo({ base64, nome, tipo } = {}) {
  const buffer = bufferDoBase64(base64);
  const name = clean(nome, 150).replace(/[\\/]/g, '-') || `arquivo-${Date.now()}`;
  const mimeType = clean(tipo, 80) || mimeDoNome(name);
  const pasta = await ensureAgentsFolder();
  const f = await uploadBufferToFolder(pasta, { name, mimeType, buffer });
  return { ref: `drive:${f.id}`, nome: f.name || name, tipo: f.mimeType || mimeType, tamanho: buffer.length };
}

const CATEGORIAS = ['arte', 'arquivo', 'nota_fiscal', 'material'];

// Anexa um arquivo a um pedido do quadro (pasta do pedido no Drive + lista de anexos).
export async function anexarAoPedido({ pedido, ref, base64, nome, tipo, categoria = 'arte' } = {}) {
  const n = parseInt(String(pedido ?? '').replace(/\D/g, ''), 10);
  const order = Number.isFinite(n) ? await getOrder(n) : null;
  if (!order) throw new AgenteError('Pedido não encontrado. Use o número do pedido, ex: 0042.', 404);
  const cat = CATEGORIAS.includes(categoria) ? categoria : 'arquivo';

  let buffer, name, mimeType;
  if (base64) {
    buffer = bufferDoBase64(base64);
    name = clean(nome, 150).replace(/[\\/]/g, '-') || `arquivo-${Date.now()}`;
    mimeType = clean(tipo, 80) || mimeDoNome(name);
  } else if (/^drive:/.test(String(ref || ''))) {
    const id = String(ref).slice(6);
    const meta = await getFileMeta(id);
    buffer = await downloadFile(id);
    name = clean(nome, 150) || meta.name || `arquivo-${id}`;
    mimeType = meta.mimeType || mimeDoNome(name);
  } else {
    throw new AgenteError('Mande o arquivo em base64 ou a ref drive:... que o subir_arquivo devolveu.');
  }

  const pasta = await ensureOrderFolder(order);
  const f = await uploadBufferToFolder(pasta, { name, mimeType, buffer });
  const { rows } = await q(
    `INSERT INTO attachments (order_id, drive_file_id, name, mime_type, size, web_view_link, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [order.id, f.id, f.name || name, f.mimeType || mimeType, f.size ? Number(f.size) : buffer.length, f.webViewLink || null, cat]
  );
  return {
    pedido: formatOrderNumber(order.id),
    anexo_id: rows[0].id,
    ref: `drive:${f.id}`,
    nome: rows[0].name,
    categoria: cat
  };
}

// ------------------------------------------------------------------ orçamento

export async function gerarOrcamento(args = {}) {
  const { quote, faltando } = normalizeQuote(args);
  if (faltando.length) throw new AgenteError(`Falta no orçamento: ${faltando.map((f) => f.pergunta).join(' ')}`);
  const pdf = await renderQuotePdf(quote);
  const nome = quoteFileName(quote);
  const pasta = await ensureAgentsFolder();
  const f = await uploadBufferToFolder(pasta, { name: nome, mimeType: 'application/pdf', buffer: pdf });
  const ref = `drive:${f.id}`;
  const total = quote.itens.reduce((s, it) => s + (it.valor_unitario || 0) * it.quantidade, 0);

  let enviado = null;
  if (args.enviar_para) {
    const phone = normalizePhone(args.enviar_para);
    if (!phone) throw new AgenteError('Telefone para envio inválido.');
    await sendDocument(phone, pdf.toString('base64'), nome, 'application/pdf', clean(args.legenda, 500));
    enviado = phone;
  }
  if (args.avisar_lucas !== false) {
    await postar({
      agente: 'orcamentos',
      texto: `Orçamento para ${quote.destinatario}: ${quote.itens.map((it) => `${it.quantidade}x ${it.descricao}`).join('; ')}. Total ${brl(total)}.` +
        (enviado ? ` Enviado ao cliente (${enviado}).` : ' Ainda não enviado ao cliente.'),
      anexos: [{ ref, nome, tipo: 'application/pdf' }],
      referencia: enviado || clean(args.referencia, 200) || null
    });
  }
  return { ref, nome, total, enviado_para: enviado };
}

// ------------------------------------------------------------------ nota fiscal

const CAMPOS_CLIENTE = ['documento', 'nome', 'ie', 'email', 'telefone', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'cod_municipio', 'uf'];
const digitos = (v) => String(v ?? '').replace(/\D/g, '');

// Monta o rascunho, confere o que dá para conferir sem gastar número de nota e
// manda para o agente Notas fiscais. NÃO emite.
export async function criarRascunhoNf(args = {}) {
  await ensureAgentesSchema();
  await nfe.ensureNfeSchema();
  const cfg = await nfe.getConfig();

  const c = args.cliente || {};
  const cliente = Object.fromEntries(CAMPOS_CLIENTE.map((k) => [k, clean(c[k], 160)]));
  cliente.documento = digitos(cliente.documento);
  cliente.cep = digitos(cliente.cep);
  cliente.uf = String(cliente.uf || '').toUpperCase().slice(0, 2);
  const faltando = [];
  if (![11, 14].includes(cliente.documento.length)) faltando.push('CPF ou CNPJ válido');
  if (!cliente.nome) faltando.push('nome ou razão social');
  if (cliente.cep.length !== 8) faltando.push('CEP');
  if (!cliente.logradouro) faltando.push('rua');
  if (!cliente.numero) faltando.push('número do endereço');
  if (!cliente.bairro) faltando.push('bairro');
  if (!cliente.municipio) faltando.push('cidade');
  if (cliente.uf.length !== 2) faltando.push('UF');
  if (faltando.length) throw new AgenteError(`Faltam dados do cliente para a nota: ${faltando.join(', ')}.`);

  const itensBrutos = Array.isArray(args.itens) ? args.itens : [];
  if (!itensBrutos.length) throw new AgenteError('Inclua os itens da nota (produto_id do cadastro das Notas, quantidade e valor unitário). Use nfe_produtos para achar o produto.');
  const fora = cliente.uf !== String(cfg.emitente?.uf || 'RS').toUpperCase();
  const itens = [];
  for (const [i, it] of itensBrutos.entries()) {
    const { rows } = await q('SELECT * FROM nfe_produtos WHERE id = $1', [Number(it.produto_id)]);
    const p = rows[0];
    if (!p) throw new AgenteError(`Item ${i + 1}: produto_id ${it.produto_id} não existe no cadastro das Notas. Use nfe_produtos.`);
    const valor = Number(String(it.valor_unitario ?? p.valor).replace(',', '.'));
    itens.push({
      produto_id: p.id, codigo: p.codigo, descricao: clean(it.descricao, 120) || p.descricao, ncm: p.ncm, cest: p.cest,
      cfop_dentro: p.cfop_dentro, cfop_fora: p.cfop_fora, cfop: fora ? p.cfop_fora : p.cfop_dentro, unidade: p.unidade, origem: p.origem,
      csosn: p.csosn, aliq_tributos: p.aliq_tributos, quantidade: Number(String(it.quantidade ?? 1).replace(',', '.')), valor_unitario: valor,
      desconto: Number(String(it.desconto ?? 0).replace(',', '.')) || 0, info_adicional: clean(it.info_adicional, 300)
    });
  }
  try {
    prepareItems(itens);
  } catch (err) {
    throw new AgenteError(err.message);
  }

  const total = itens.reduce((s, it) => s + it.quantidade * it.valor_unitario - (it.desconto || 0), 0);
  const dados = {
    cliente,
    itens,
    pagamento: { tPag: String(args.forma_pagamento || cfg.pagamento_padrao || '17') },
    inf_cpl: args.inf_cpl ?? undefined
  };
  const pedido = clean(args.pedido, 20) || null;
  const telefone = normalizePhone(args.telefone_cliente) || null;
  const ambiente = Number(cfg.ambiente) === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO (teste, sem valor fiscal)';
  const end = [cliente.logradouro, cliente.numero, cliente.complemento, cliente.bairro, `${cliente.municipio}/${cliente.uf}`, `CEP ${cliente.cep}`]
    .filter(Boolean)
    .join(', ');
  const resumo = [
    ehTelefoneDeTeste(telefone) ? 'CONVERSA DE TESTE: aprovar não emite nota de verdade.' : null,
    `Nota fiscal para ${cliente.nome}`,
    `${cliente.documento.length === 14 ? 'CNPJ' : 'CPF'}: ${cliente.documento}${cliente.ie ? ` · IE ${cliente.ie}` : ''}`,
    `Endereço: ${end}`,
    cliente.email ? `E-mail: ${cliente.email}` : null,
    '',
    ...itens.map((it) => `${it.quantidade}x ${it.descricao} — ${brl(it.valor_unitario)} cada (CFOP ${it.cfop})`),
    '',
    `Total: ${brl(total)}`,
    pedido ? `Pedido: ${pedido}` : null,
    `Ambiente: ${ambiente}`
  ]
    .filter((l) => l !== null)
    .join('\n');

  const { rows } = await q(
    'INSERT INTO nf_rascunhos (dados, resumo, pedido, telefone_cliente) VALUES ($1, $2, $3, $4) RETURNING *',
    [JSON.stringify(dados), resumo, pedido, telefone]
  );
  const r = rows[0];
  const msg = await postar({ agente: 'notas', tipo: 'nf', texto: resumo, referencia: telefone || pedido, nf_rascunho_id: r.id });
  return { rascunho_id: r.id, codigo: msg.codigo, estado: 'aguardando', total, resumo, aviso: 'Só o Lucas aprova, na aba Agentes. Você recebe o evento nf.emitida quando a nota sair.' };
}

export async function listarRascunhosNf({ estado } = {}) {
  await ensureAgentesSchema();
  const { rows } = estado
    ? await q('SELECT id, estado, resumo, pedido, telefone_cliente, nota_id, erro, created_at, updated_at FROM nf_rascunhos WHERE estado = $1 ORDER BY id DESC LIMIT 50', [estado])
    : await q('SELECT id, estado, resumo, pedido, telefone_cliente, nota_id, erro, created_at, updated_at FROM nf_rascunhos ORDER BY id DESC LIMIT 50');
  return rows.map((r) => ({ ...r, ref_pdf: r.nota_id ? `nfe:${r.nota_id}:pdf` : null }));
}

// Só pela tela, com o PIN das Notas (a rota exige o token das Notas).
export async function aprovarNf(mensagemId, user = 'Lucas') {
  const m = await getMensagem(mensagemId);
  if (m.tipo !== 'nf' || !m.nf_rascunho_id) throw new AgenteError('Esta mensagem não é uma nota fiscal.');
  if (m.estado !== 'pendente') throw new AgenteError('Esta nota já foi decidida.');
  const { rows } = await q('SELECT * FROM nf_rascunhos WHERE id = $1', [m.nf_rascunho_id]);
  const r = rows[0];
  if (!r || r.estado !== 'aguardando') throw new AgenteError('Rascunho não está aguardando aprovação.');
  await q("UPDATE nf_rascunhos SET estado = 'emitindo', updated_at = now() WHERE id = $1", [r.id]);
  await q("UPDATE agente_mensagens SET estado = 'emitindo', respondido_por = $2, respondido_em = now() WHERE id = $1", [m.id, clean(user, 60) || 'Lucas']);

  const dados = parseJson(r.dados, {});

  // Conversa de teste (aba Testar atendente): faz o caminho todo, mas não emite nota de verdade.
  if (ehTelefoneDeTeste(r.telefone_cliente)) {
    await q("UPDATE nf_rascunhos SET estado = 'emitida', erro = 'teste: nenhuma nota emitida', updated_at = now() WHERE id = $1", [r.id]);
    const { rows: [mt] } = await q("UPDATE agente_mensagens SET estado = 'emitida', resposta = $2, entregue = 0 WHERE id = $1 RETURNING *", [
      m.id, 'Conversa de teste: aprovado, mas nenhuma nota foi emitida.'
    ]);
    await notifyHermes('nf.emitida', {
      teste: true, rascunho_id: r.id, nota_id: null, numero: null, situacao: 'teste', ref_pdf: null,
      telefone_cliente: r.telefone_cliente, pedido: r.pedido, aviso: 'Conversa de teste: nenhuma nota foi emitida. Diga ao cliente de teste que a nota foi emitida.'
    });
    return formatarMensagem(mt);
  }

  let nota;
  try {
    nota = await nfe.emitir({ cliente: dados.cliente, itens: dados.itens, pagamento: dados.pagamento, ...(dados.inf_cpl != null ? { inf_cpl: dados.inf_cpl } : {}) }, clean(user, 60) || 'Lucas');
  } catch (err) {
    await q("UPDATE nf_rascunhos SET estado = 'erro', erro = $2, updated_at = now() WHERE id = $1", [r.id, err.message]);
    const { rows: [mm] } = await q("UPDATE agente_mensagens SET estado = 'erro', resposta = $2, entregue = 0 WHERE id = $1 RETURNING *", [m.id, err.message]);
    await postar({ agente: 'notas', texto: `Não consegui emitir: ${err.message}`, autor: 'sistema', referencia: r.telefone_cliente || r.pedido });
    await notifyHermes('nf.problema', { rascunho_id: r.id, erro: err.message, telefone_cliente: r.telefone_cliente, pedido: r.pedido });
    return formatarMensagem(mm);
  }

  const ok = nota.situacao === 'autorizada';
  await q('UPDATE nf_rascunhos SET estado = $2, nota_id = $3, erro = $4, updated_at = now() WHERE id = $1', [
    r.id, ok ? 'emitida' : 'erro', nota.id, ok ? null : `${nota.situacao}: ${nota.motivo || ''}`.trim()
  ]);
  const { rows: [mm] } = await q('UPDATE agente_mensagens SET estado = $2, resposta = $3, entregue = 0 WHERE id = $1 RETURNING *', [
    m.id, ok ? 'emitida' : 'erro', ok ? `Nota nº ${nota.numero} autorizada.` : `Nota ${nota.situacao}: ${nota.motivo || 'sem motivo'}`
  ]);
  const refPdf = `nfe:${nota.id}:pdf`;
  await postar({
    agente: 'notas',
    autor: 'sistema',
    texto: ok
      ? `Nota nº ${nota.numero} autorizada para ${nota.cliente_nome}, ${brl(nota.valor_total)}. O atendente vai mandar o PDF ao cliente.`
      : `A nota ficou ${nota.situacao}: ${nota.motivo || 'sem motivo'}. Veja na aba Notas fiscais.`,
    anexos: ok ? [{ ref: refPdf, nome: `NF ${nota.numero}.pdf`, tipo: 'application/pdf' }] : [],
    referencia: r.telefone_cliente || r.pedido
  });
  await notifyHermes(ok ? 'nf.emitida' : 'nf.problema', {
    rascunho_id: r.id,
    nota_id: nota.id,
    numero: nota.numero,
    situacao: nota.situacao,
    motivo: nota.motivo || null,
    ref_pdf: ok ? refPdf : null,
    telefone_cliente: r.telefone_cliente,
    pedido: r.pedido
  });
  return formatarMensagem(mm);
}
