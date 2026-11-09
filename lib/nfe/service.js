// Regras da aba Notas: configuração, cadastros, numeração e o ciclo de vida da NF-e
// (emitir → autorizada/rejeitada/pendente → cancelar / carta de correção), além da
// inutilização de números e da importação do histórico do C&K.
//
// Tudo fica em tabelas próprias (nfe_*), fora da tabela settings, para que nada daqui
// (certificado, PIN) apareça em /api/settings nem nas ferramentas do Hermes.
import { q } from '../db.js';
import { encryptCert, openPfx, certFromBlob, CertError } from './cert.js';
import { LOGO_PADRAO } from './logo-padrao.js';
import {
  buildNFe, prepareItems, sign, randomCNF, buildEvento, detalheCancelamento, detalheCCe, buildInutilizacao,
  NfeDataError, digits, clean, validarDocumento, ufCode, round2
} from './xml.js';
import {
  autorizar, consultarRecibo, consultarChave, consultarCadastro, enviarEvento, inutilizar as sefazInutilizar, statusServico,
  montarProc, montarProcEvento, montarProcInut, SefazError, pick, pickBlock
} from './sefaz.js';

export { NfeDataError, CertError, SefazError };

export class NfeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Dados da Classul conforme o cadastro do C&K (nota 4614) e o CNPJ público.
export const EMITENTE_PADRAO = {
  cnpj: '18605962000130',
  razao_social: 'CLASSUL INDUSTRIA E COMERCIO DE PLACAS E BRINDES LTDA ME',
  nome_fantasia: 'BRINDIDEIAS',
  ie: '0963547283',
  logradouro: 'RUA ALVARO CHAVES',
  numero: '214',
  complemento: '',
  bairro: 'FLORESTA',
  cod_municipio: '4314902',
  municipio: 'PORTO ALEGRE',
  uf: 'RS',
  cep: '90220040',
  telefone: '5130623965'
};

export const INF_CPL_PADRAO =
  'EMPRESA ME OPTANTE PELO SIMPLES NACIONAL - NAO GERA DIREITO A CREDITO ICMS - IPI - ISS;';

export const FORMAS_PAGAMENTO = [
  ['17', 'PIX'],
  ['18', 'Transferência bancária / carteira digital'],
  ['16', 'Depósito bancário'],
  ['01', 'Dinheiro'],
  ['03', 'Cartão de crédito'],
  ['04', 'Cartão de débito'],
  ['15', 'Boleto bancário'],
  ['90', 'Sem pagamento'],
  ['99', 'Outros']
];

// ------------------------------------------------------------------ schema

let ready = null;
export function ensureNfeSchema() {
  if (!ready) ready = initSchema().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

async function initSchema() {
  await q(`CREATE TABLE IF NOT EXISTS nfe_config (key TEXT PRIMARY KEY, value TEXT)`);
  await q(`
    CREATE TABLE IF NOT EXISTS nfe_numeracao (
      ambiente INTEGER NOT NULL,
      serie INTEGER NOT NULL,
      proximo INTEGER NOT NULL,
      PRIMARY KEY (ambiente, serie)
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS nfe_produtos (
      id SERIAL PRIMARY KEY,
      codigo TEXT,
      descricao TEXT NOT NULL,
      ncm TEXT NOT NULL,
      cfop_dentro TEXT NOT NULL DEFAULT '5101',
      cfop_fora TEXT NOT NULL DEFAULT '6101',
      unidade TEXT NOT NULL DEFAULT 'UND',
      valor DOUBLE PRECISION NOT NULL DEFAULT 0,
      cest TEXT,
      origem TEXT NOT NULL DEFAULT '0',
      csosn TEXT NOT NULL DEFAULT '102',
      aliq_tributos DOUBLE PRECISION NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS nfe_clientes (
      id SERIAL PRIMARY KEY,
      documento TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      ie TEXT,
      contribuinte INTEGER NOT NULL DEFAULT 0,
      email TEXT,
      telefone TEXT,
      cep TEXT,
      logradouro TEXT,
      numero TEXT,
      complemento TEXT,
      bairro TEXT,
      municipio TEXT,
      cod_municipio TEXT,
      uf TEXT,
      origem TEXT NOT NULL DEFAULT 'sistema',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS nfe_notas (
      id SERIAL PRIMARY KEY,
      ambiente INTEGER NOT NULL,
      serie INTEGER NOT NULL,
      numero INTEGER NOT NULL,
      chave TEXT,
      situacao TEXT NOT NULL,
      cliente_id INTEGER,
      cliente_nome TEXT,
      cliente_doc TEXT,
      cliente_uf TEXT,
      valor_total DOUBLE PRECISION NOT NULL DEFAULT 0,
      nat_op TEXT,
      dh_emissao TIMESTAMPTZ,
      dados TEXT,
      xml TEXT,
      xml_proc TEXT,
      protocolo TEXT,
      recibo TEXT,
      c_stat TEXT,
      motivo TEXT,
      cce_seq INTEGER NOT NULL DEFAULT 0,
      origem TEXT NOT NULL DEFAULT 'sistema',
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (ambiente, serie, numero)
    )`);
  await q(`
    CREATE TABLE IF NOT EXISTS nfe_eventos (
      id SERIAL PRIMARY KEY,
      nota_id INTEGER,
      tipo TEXT NOT NULL,
      seq INTEGER,
      ambiente INTEGER NOT NULL,
      serie INTEGER,
      numero_ini INTEGER,
      numero_fim INTEGER,
      texto TEXT,
      protocolo TEXT,
      c_stat TEXT,
      motivo TEXT,
      xml TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  for (const ddl of [
    // Quantas vezes o produto já saiu em nota: ordena as sugestões da busca.
    'ALTER TABLE nfe_produtos ADD COLUMN IF NOT EXISTS uso INTEGER NOT NULL DEFAULT 0',
    'CREATE INDEX IF NOT EXISTS nfe_notas_chave ON nfe_notas (chave)',
    'CREATE INDEX IF NOT EXISTS nfe_notas_emissao ON nfe_notas (dh_emissao)'
  ]) {
    try {
      await q(ddl);
    } catch {
      // índice já existe (pg-mem não entende IF NOT EXISTS em índice)
    }
  }
}

// ------------------------------------------------------------------ configuração

async function getConfigRaw() {
  const { rows } = await q('SELECT key, value FROM nfe_config');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function setConfig(key, value) {
  await q(
    'INSERT INTO nfe_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value == null ? null : String(value)]
  );
}

export async function getConfig() {
  const raw = await getConfigRaw();
  const ambiente = raw.ambiente === '1' ? 1 : 2;
  const serie = Number(raw.serie || 2);
  return {
    ambiente,
    serie,
    emitente: raw.emitente ? { ...EMITENTE_PADRAO, ...JSON.parse(raw.emitente) } : EMITENTE_PADRAO,
    inf_cpl: raw.inf_cpl ?? INF_CPL_PADRAO,
    pagamento_padrao: raw.pagamento_padrao || '17',
    has_cert: Boolean(raw.cert_blob),
    cert: raw.cert_info ? JSON.parse(raw.cert_info) : null,
    has_pin: Boolean(raw.pin_hash),
    logo: raw.logo === 'nenhuma' ? 'nenhuma' : raw.logo ? 'propria' : 'padrao',
    proximo_numero: await proximoNumero(ambiente, serie)
  };
}

// Logo do DANFE: a que o Lucas enviou, o carimbo padrão do C&K, ou nenhuma.
export async function getLogo() {
  const { rows } = await q("SELECT value FROM nfe_config WHERE key = 'logo'");
  const v = rows[0]?.value;
  if (v === 'nenhuma') return null;
  if (v) return JSON.parse(v);
  return LOGO_PADRAO;
}

export async function saveLogo(dataUrl) {
  if (dataUrl === 'padrao') return setConfig('logo', null);
  if (dataUrl === 'nenhuma') return setConfig('logo', 'nenhuma');
  const m = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new NfeError('Envie a logo em PNG ou JPG.');
  if (m[2].length > 1_400_000) throw new NfeError('Logo muito grande (máximo 1 MB).');
  await setConfig('logo', JSON.stringify({ mime: m[1], base64: m[2] }));
}

export async function getPinHash() {
  const { rows } = await q("SELECT value FROM nfe_config WHERE key = 'pin_hash'");
  return rows[0]?.value || '';
}
export const setPinHash = (hash) => setConfig('pin_hash', hash);

export async function saveConfig(body) {
  if (body.ambiente !== undefined) await setConfig('ambiente', Number(body.ambiente) === 1 ? '1' : '2');
  if (body.serie !== undefined) {
    const s = Number(body.serie);
    if (!(s >= 0 && s <= 889)) throw new NfeError('Série inválida (0 a 889).');
    await setConfig('serie', String(s));
  }
  if (body.inf_cpl !== undefined) await setConfig('inf_cpl', clean(body.inf_cpl, 2000));
  if (body.pagamento_padrao !== undefined) await setConfig('pagamento_padrao', String(body.pagamento_padrao));
  if (body.emitente) {
    const e = { ...EMITENTE_PADRAO, ...body.emitente };
    if (!validarDocumento(e.cnpj)) throw new NfeError('CNPJ do emitente inválido.');
    await setConfig('emitente', JSON.stringify(e));
  }
  if (body.proximo_numero !== undefined) {
    const cfg = await getConfig();
    const n = Number(body.proximo_numero);
    if (!(n >= 1 && n <= 999999999)) throw new NfeError('Número inválido.');
    // Não deixa voltar para trás de uma nota que já existe (evita duplicidade).
    const { rows } = await q('SELECT MAX(numero) AS m FROM nfe_notas WHERE ambiente = $1 AND serie = $2', [cfg.ambiente, cfg.serie]);
    if (rows[0]?.m && n <= Number(rows[0].m)) throw new NfeError(`Já existe a nota ${rows[0].m} nesta série. O próximo número precisa ser maior.`);
    await q(
      `INSERT INTO nfe_numeracao (ambiente, serie, proximo) VALUES ($1, $2, $3)
       ON CONFLICT (ambiente, serie) DO UPDATE SET proximo = EXCLUDED.proximo`,
      [cfg.ambiente, cfg.serie, n]
    );
  }
  return getConfig();
}

export async function saveCertificate(pfxBase64, password) {
  const opened = openPfx(pfxBase64, password); // valida a senha antes de guardar
  const emit = (await getConfig()).emitente;
  if (opened.info.cnpj && digits(opened.info.cnpj).slice(0, 8) !== digits(emit.cnpj).slice(0, 8)) {
    throw new NfeError(`Este certificado é de outro CNPJ (${opened.info.cnpj}).`);
  }
  if (new Date(opened.info.valido_ate) < new Date()) throw new NfeError('Este certificado está vencido.');
  await setConfig('cert_blob', encryptCert(pfxBase64, password));
  await setConfig('cert_info', JSON.stringify(opened.info));
  return opened.info;
}

async function loadCert() {
  const { rows } = await q("SELECT value FROM nfe_config WHERE key = 'cert_blob'");
  if (!rows[0]?.value) throw new NfeError('Envie o certificado digital (.pfx) na aba Configurar antes de emitir.');
  const cert = certFromBlob(rows[0].value);
  if (new Date(cert.info.valido_ate) < new Date()) throw new NfeError('O certificado digital venceu. Envie o novo arquivo .pfx.');
  return cert;
}

export async function sefazStatus() {
  const cfg = await getConfig();
  return { ambiente: cfg.ambiente, ...(await statusServico(cfg.ambiente, await loadCert())) };
}

// ------------------------------------------------------------------ numeração

async function proximoNumero(ambiente, serie) {
  const { rows } = await q('SELECT proximo FROM nfe_numeracao WHERE ambiente = $1 AND serie = $2', [ambiente, serie]);
  if (rows[0]) return Number(rows[0].proximo);
  const { rows: m } = await q('SELECT MAX(numero) AS m FROM nfe_notas WHERE ambiente = $1 AND serie = $2', [ambiente, serie]);
  return Number(m[0]?.m || 0) + 1;
}

// Reserva o próximo número de forma atômica (duas pessoas emitindo ao mesmo tempo
// nunca pegam o mesmo número).
async function reservarNumero(ambiente, serie) {
  const atual = await proximoNumero(ambiente, serie);
  await q(
    `INSERT INTO nfe_numeracao (ambiente, serie, proximo) VALUES ($1, $2, $3) ON CONFLICT (ambiente, serie) DO NOTHING`,
    [ambiente, serie, atual]
  );
  const { rows } = await q(
    'UPDATE nfe_numeracao SET proximo = proximo + 1 WHERE ambiente = $1 AND serie = $2 RETURNING proximo',
    [ambiente, serie]
  );
  return Number(rows[0].proximo) - 1;
}

// ------------------------------------------------------------------ produtos

const PRODUTO_CAMPOS = ['codigo', 'descricao', 'ncm', 'cfop_dentro', 'cfop_fora', 'unidade', 'valor', 'cest', 'origem', 'csosn', 'aliq_tributos', 'ativo'];

function normalizarProduto(b) {
  const p = {
    codigo: clean(b.codigo, 60),
    descricao: clean(b.descricao, 120),
    ncm: digits(b.ncm),
    cfop_dentro: digits(b.cfop_dentro) || '5101',
    cfop_fora: digits(b.cfop_fora) || '6101',
    unidade: clean(b.unidade, 6).toUpperCase() || 'UND',
    valor: round2(b.valor),
    cest: digits(b.cest),
    origem: String(b.origem ?? '0'),
    csosn: ['102', '103', '300', '400'].includes(String(b.csosn)) ? String(b.csosn) : '102',
    aliq_tributos: Math.max(0, Number(b.aliq_tributos) || 0),
    ativo: b.ativo === undefined ? 1 : b.ativo ? 1 : 0
  };
  if (!p.descricao) throw new NfeError('Informe a descrição do produto.');
  if (p.ncm.length !== 8) throw new NfeError('O NCM precisa ter 8 dígitos.');
  if (!/^5\d{3}$/.test(p.cfop_dentro)) throw new NfeError('CFOP dentro do estado precisa começar com 5.');
  if (!/^6\d{3}$/.test(p.cfop_fora)) throw new NfeError('CFOP fora do estado precisa começar com 6.');
  return p;
}

export async function listarProdutos() {
  const { rows } = await q('SELECT * FROM nfe_produtos ORDER BY ativo DESC, uso DESC, descricao ASC');
  return rows;
}

export async function salvarProduto(id, body) {
  const p = normalizarProduto(body);
  const vals = PRODUTO_CAMPOS.map((k) => p[k]);
  if (id) {
    const sets = PRODUTO_CAMPOS.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await q(`UPDATE nfe_produtos SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...vals]);
    if (!rows[0]) throw new NfeError('Produto não encontrado.', 404);
    return rows[0];
  }
  const { rows } = await q(
    `INSERT INTO nfe_produtos (${PRODUTO_CAMPOS.join(', ')}) VALUES (${PRODUTO_CAMPOS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    vals
  );
  return rows[0];
}

// ------------------------------------------------------------------ clientes

const CLIENTE_CAMPOS = ['documento', 'nome', 'ie', 'contribuinte', 'email', 'telefone', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'cod_municipio', 'uf'];

// contribuinte: 0 = não contribuinte, 1 = contribuinte com IE, 2 = isento de IE.
function situacaoIE(b, documento) {
  if (documento.length !== 14) return { contribuinte: 0, ie: '' };
  const isento = /isent/i.test(String(b.ie || ''));
  const ie = isento ? '' : digits(b.ie);
  let c = Number(b.contribuinte || 0);
  if (isento) c = 2;
  if (![0, 1, 2].includes(c)) c = 0;
  if (c === 1 && !ie) throw new NfeError('Contribuinte de ICMS precisa da inscrição estadual.');
  if (ie && (ie.length < 2 || ie.length > 14)) throw new NfeError('Inscrição estadual inválida.');
  return { contribuinte: c, ie: c === 2 ? '' : ie };
}

function normalizarCliente(b) {
  const documento = digits(b.documento);
  const c = {
    documento,
    nome: clean(b.nome, 60),
    ...situacaoIE(b, documento),
    email: clean(b.email, 60),
    telefone: digits(b.telefone),
    cep: digits(b.cep),
    logradouro: clean(b.logradouro, 60),
    numero: clean(b.numero, 60) || 'S/N',
    complemento: clean(b.complemento, 60),
    bairro: clean(b.bairro, 60),
    municipio: clean(b.municipio, 60),
    cod_municipio: digits(b.cod_municipio),
    uf: String(b.uf || '').toUpperCase()
  };
  if (!validarDocumento(c.documento)) throw new NfeError('CPF ou CNPJ inválido.');
  if (!c.nome) throw new NfeError('Informe o nome do cliente.');
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new NfeError('E-mail inválido.');
  if (!c.logradouro || !c.bairro) throw new NfeError('Informe endereço e bairro.');
  if (c.cod_municipio.length !== 7 || !c.municipio) throw new NfeError('Busque o CEP para preencher a cidade com o código IBGE.');
  if (!ufCode(c.uf)) throw new NfeError('UF inválida.');
  return c;
}

// Busca a inscrição estadual do CNPJ no cadastro de contribuintes da SEFAZ.
export async function buscarIE(cnpj, uf) {
  const doc = digits(cnpj);
  if (doc.length !== 14) throw new NfeError('Informe um CNPJ.');
  const u = String(uf || 'RS').toUpperCase();
  if (!ufCode(u)) throw new NfeError('Preencha o CEP antes (para saber o estado).');
  let r;
  try {
    r = await consultarCadastro(u, doc, await loadCert());
  } catch (err) {
    throw new NfeError(`Não deu para consultar a SEFAZ-${u} agora (${err.message}). Preencha a IE à mão.`);
  }
  const ativos = r.cadastros.filter((c) => c.ie && c.situacao === 'habilitado');
  if (r.cStat === '259' || (!r.cadastros.length && /nao|não/i.test(r.xMotivo))) {
    return { encontrado: false, motivo: 'Não é contribuinte de ICMS neste estado.', cStat: r.cStat };
  }
  if (!r.cadastros.length) return { encontrado: false, motivo: `SEFAZ-${u}: ${r.xMotivo || 'sem resposta'}`, cStat: r.cStat };
  const escolhido = ativos[0] || r.cadastros[0];
  return { encontrado: true, ie: escolhido.ie, situacao: escolhido.situacao, nome: escolhido.nome, cStat: r.cStat };
}

export async function listarClientes(busca = '', limit = 50) {
  const b = String(busca || '').trim();
  if (!b) {
    const { rows } = await q('SELECT * FROM nfe_clientes ORDER BY updated_at DESC LIMIT $1', [limit]);
    return rows;
  }
  // Poucos milhares de clientes: filtra em JS, sem acento e com todas as palavras digitadas.
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const palavras = semAcento(b).split(/\s+/).filter(Boolean);
  const d = digits(b);
  const { rows } = await q('SELECT * FROM nfe_clientes');
  return rows
    .map((c) => {
      const nome = semAcento(c.nome);
      const porDoc = d.length >= 3 && c.documento.includes(d);
      const porNome = palavras.every((p) => nome.includes(p) || semAcento(c.municipio).includes(p));
      if (!porDoc && !porNome) return null;
      const score = (porDoc ? 3 : 0) + (nome.startsWith(palavras[0]) ? 2 : 0) + (nome.includes(semAcento(b)) ? 1 : 0);
      return { c, score };
    })
    .filter(Boolean)
    .sort((x, y) => y.score - x.score || x.c.nome.localeCompare(y.c.nome))
    .slice(0, limit)
    .map((x) => x.c);
}

export async function salvarCliente(id, body) {
  const c = normalizarCliente(body);
  const vals = CLIENTE_CAMPOS.map((k) => c[k]);
  if (id) {
    const sets = CLIENTE_CAMPOS.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await q(`UPDATE nfe_clientes SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...vals]);
    if (!rows[0]) throw new NfeError('Cliente não encontrado.', 404);
    return rows[0];
  }
  const { rows: existe } = await q('SELECT id FROM nfe_clientes WHERE documento = $1', [c.documento]);
  if (existe[0]) return salvarCliente(existe[0].id, body);
  const { rows } = await q(
    `INSERT INTO nfe_clientes (${CLIENTE_CAMPOS.join(', ')}) VALUES (${CLIENTE_CAMPOS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    vals
  );
  return rows[0];
}

// ------------------------------------------------------------------ notas

const LISTA_CAMPOS =
  'id, ambiente, serie, numero, chave, situacao, cliente_id, cliente_nome, cliente_doc, cliente_uf, valor_total, nat_op, dh_emissao, protocolo, c_stat, motivo, cce_seq, origem, created_by, created_at';

export async function listarNotas({ busca = '', situacao = '', ambiente, mes = '', limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (ambiente) add('ambiente = ?', Number(ambiente));
  if (situacao) add('situacao = ?', situacao);
  if (/^\d{4}-\d{2}$/.test(mes)) {
    // Mês no fuso de Brasília (-03:00): do dia 1 às 00h até o dia 1 do mês seguinte.
    const [y, m] = mes.split('-').map(Number);
    add('dh_emissao >= ?', new Date(Date.UTC(y, m - 1, 1, 3)).toISOString());
    add('dh_emissao < ?', new Date(Date.UTC(y, m, 1, 3)).toISOString());
  }
  const b = String(busca || '').trim();
  if (b) {
    const d = digits(b);
    params.push(`%${b.toLowerCase()}%`);
    const i = params.length;
    let cond = `LOWER(cliente_nome) LIKE $${i}`;
    if (d) {
      params.push(d);
      cond += ` OR CAST(numero AS TEXT) = $${params.length} OR cliente_doc = $${params.length} OR chave = $${params.length}`;
    }
    where.push(`(${cond})`);
  }
  params.push(Math.min(500, limit), offset);
  const { rows } = await q(
    `SELECT ${LISTA_CAMPOS} FROM nfe_notas ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY dh_emissao DESC NULLS LAST, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

export async function getNota(id) {
  const { rows } = await q('SELECT * FROM nfe_notas WHERE id = $1', [id]);
  if (!rows[0]) throw new NfeError('Nota não encontrada.', 404);
  const nota = rows[0];
  const { rows: eventos } = await q(
    'SELECT id, tipo, seq, texto, protocolo, c_stat, motivo, created_by, created_at FROM nfe_eventos WHERE nota_id = $1 ORDER BY id ASC',
    [id]
  );
  // Telefone do cadastro, para já vir preenchido no envio por WhatsApp.
  const { rows: cli } = await q('SELECT id, telefone, email FROM nfe_clientes WHERE id = $1 OR documento = $2 LIMIT 1', [
    nota.cliente_id || 0,
    nota.cliente_doc || ''
  ]);
  return {
    ...nota,
    dados: nota.dados ? JSON.parse(nota.dados) : null,
    eventos,
    cliente_id: nota.cliente_id || cli[0]?.id || null,
    cliente_telefone: cli[0]?.telefone || '',
    cliente_email: cli[0]?.email || ''
  };
}

// Itens de uma nota no formato da tela de emissão. Para notas importadas do C&K, lê do XML
// e casa com o cadastro de produtos pelo código.
export async function itensDaNota(nota) {
  if (nota.dados?.itens?.length) return nota.dados.itens;
  const xml = nota.xml_proc || nota.xml || '';
  const produtos = await listarProdutos();
  return [...xml.matchAll(/<det nItem="\d+">[\s\S]*?<\/det>/g)].map(([det]) => {
    const prod = pickBlock(det, 'prod');
    const cfop = pick(prod, 'CFOP');
    const codigo = pick(prod, 'cProd');
    const cad = produtos.find((p) => p.codigo === codigo);
    return {
      produto_id: cad?.id || null,
      codigo,
      descricao: pick(prod, 'xProd').replace(/&amp;/g, '&'),
      ncm: cad?.ncm || pick(prod, 'NCM'),
      cest: cad?.cest || '',
      cfop_dentro: cad?.cfop_dentro || `5${cfop.slice(1)}`,
      cfop_fora: cad?.cfop_fora || `6${cfop.slice(1)}`,
      unidade: pick(prod, 'uCom') || 'UND',
      origem: cad?.origem || '0',
      csosn: cad?.csosn || '102',
      aliq_tributos: cad?.aliq_tributos || 0,
      quantidade: Number(pick(prod, 'qCom')) || 1,
      valor_unitario: Number(pick(prod, 'vUnCom')) || 0,
      desconto: Number(pick(prod, 'vDesc')) || 0,
      info_adicional: pick(det, 'infAdProd').replace(/&amp;/g, '&')
    };
  });
}

// Base para "emitir outra igual": cliente + itens da nota.
export async function copiaDaNota(id) {
  const nota = await getNota(id);
  const { rows } = await q('SELECT * FROM nfe_clientes WHERE id = $1', [nota.cliente_id || 0]);
  return {
    cliente: rows[0] || null,
    itens: await itensDaNota(nota),
    pagamento: nota.dados?.pagamento || null,
    frete: nota.dados?.frete || 0
  };
}

// Última nota autorizada do cliente (para "repetir a última compra").
export async function ultimaDoCliente(clienteId) {
  const { rows: c } = await q('SELECT id, documento FROM nfe_clientes WHERE id = $1', [clienteId]);
  if (!c[0]) throw new NfeError('Cliente não encontrado.', 404);
  const { rows } = await q(
    `SELECT id, numero, serie, valor_total, dh_emissao FROM nfe_notas
     WHERE (cliente_id = $1 OR cliente_doc = $2) AND situacao = 'autorizada'
     ORDER BY dh_emissao DESC NULLS LAST, id DESC LIMIT 1`,
    [c[0].id, c[0].documento]
  );
  if (!rows[0]) return null;
  const nota = await getNota(rows[0].id);
  return { ...rows[0], itens: await itensDaNota(nota) };
}

// Monta os itens com o CFOP certo (dentro/fora do estado) a partir do que veio da tela.
function itensDaTela(itens, ufCliente, ufEmit) {
  const fora = String(ufCliente).toUpperCase() !== String(ufEmit).toUpperCase();
  return (itens || []).map((it) => ({
    ...it,
    cfop: digits(it.cfop) || (fora ? it.cfop_fora : it.cfop_dentro) || (fora ? '6101' : '5101')
  }));
}

async function resolverCliente(body) {
  if (body.cliente_id) {
    const { rows } = await q('SELECT * FROM nfe_clientes WHERE id = $1', [body.cliente_id]);
    if (!rows[0]) throw new NfeError('Cliente não encontrado.');
    return rows[0];
  }
  if (body.cliente) return salvarCliente(null, body.cliente);
  throw new NfeError('Escolha o cliente da nota.');
}

/**
 * Emite uma NF-e. body = { cliente_id | cliente, itens: [...], pagamento: {tPag}, frete, inf_cpl, nat_op }
 * Se body.nota_id vier, reenvia uma nota rejeitada usando o MESMO número.
 */
export async function emitir(body, user) {
  const cfg = await getConfig();
  const cert = await loadCert();
  const cliente = await resolverCliente(body);
  const itens = prepareItems(itensDaTela(body.itens, cliente.uf, cfg.emitente.uf));
  const dest = { ...cliente };
  const dados = {
    cliente_id: cliente.id,
    itens: body.itens,
    pagamento: { tPag: String(body.pagamento?.tPag || cfg.pagamento_padrao) },
    frete: round2(body.frete || 0),
    inf_cpl: body.inf_cpl ?? cfg.inf_cpl,
    nat_op: clean(body.nat_op, 60)
  };

  // Valida tudo antes de gastar um número (erro de cadastro não consome numeração).
  buildNFe({
    ambiente: cfg.ambiente, serie: cfg.serie, numero: 1, dataEmissao: new Date(), cNF: '10000000',
    natOp: dados.nat_op, emit: cfg.emitente, dest, itens, frete: dados.frete, pagamento: dados.pagamento, infCpl: dados.inf_cpl
  });

  let nota;
  if (body.nota_id) {
    const { rows } = await q('SELECT * FROM nfe_notas WHERE id = $1', [body.nota_id]);
    nota = rows[0];
    if (!nota) throw new NfeError('Nota não encontrada.', 404);
    if (nota.situacao !== 'rejeitada') throw new NfeError('Só dá para reenviar uma nota rejeitada.');
    if (nota.ambiente !== cfg.ambiente) throw new NfeError('Esta nota é de outro ambiente (homologação/produção).');
  } else {
    const numero = await reservarNumero(cfg.ambiente, cfg.serie);
    const { rows } = await q(
      `INSERT INTO nfe_notas (ambiente, serie, numero, situacao, created_by) VALUES ($1, $2, $3, 'enviando', $4) RETURNING *`,
      [cfg.ambiente, cfg.serie, numero, user || null]
    );
    nota = rows[0];
  }

  const agora = new Date();
  let xml, chave, totais, assinada;
  try {
    ({ xml, chave, totais } = buildNFe({
      ambiente: nota.ambiente, serie: nota.serie, numero: nota.numero, dataEmissao: agora, cNF: randomCNF(nota.numero),
      natOp: dados.nat_op, emit: cfg.emitente, dest, itens, frete: dados.frete, pagamento: dados.pagamento, infCpl: dados.inf_cpl
    }));
    assinada = sign(xml, 'infNFe', cert);
  } catch (err) {
    // O número já foi reservado: a nota fica rejeitada (reenviável) em vez de sumir.
    await q(`UPDATE nfe_notas SET situacao = 'rejeitada', dados = $2, motivo = $3, updated_at = now() WHERE id = $1`, [
      nota.id, JSON.stringify(dados), err.message
    ]);
    throw err;
  }
  const natOp = pick(xml, 'natOp');

  await q(
    `UPDATE nfe_notas SET chave = $2, situacao = 'enviando', cliente_id = $3, cliente_nome = $4, cliente_doc = $5, cliente_uf = $6,
       valor_total = $7, nat_op = $8, dh_emissao = $9, dados = $10, xml = $11, c_stat = NULL, motivo = NULL, updated_at = now()
     WHERE id = $1`,
    [nota.id, chave, cliente.id, cliente.nome, cliente.documento, cliente.uf, totais.vNF, natOp, agora.toISOString(), JSON.stringify(dados), assinada]
  );

  let r;
  try {
    r = await autorizar(nota.ambiente, assinada, cert);
    // Assíncrono (103): tenta o recibo algumas vezes dentro do tempo da requisição.
    for (let i = 0; r.situacao === 'processando' && r.nRec && i < 4; i++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      const rr = await consultarRecibo(nota.ambiente, r.nRec, cert);
      r = { ...rr, nRec: r.nRec };
    }
  } catch (err) {
    if (!(err instanceof SefazError)) throw err;
    if (err.sent) {
      // Pode ter chegado: fica pendente até consultar pela chave (nunca reenvia às cegas).
      await q(`UPDATE nfe_notas SET situacao = 'pendente', motivo = $2, updated_at = now() WHERE id = $1`, [nota.id, err.message]);
    } else {
      await q(`UPDATE nfe_notas SET situacao = 'rejeitada', motivo = $2, updated_at = now() WHERE id = $1`, [nota.id, err.message]);
    }
    return getNota(nota.id);
  }

  // 204/539 = duplicidade: o número já foi autorizado antes (ex.: resposta perdida). Consulta e recupera.
  if (r.situacao === 'rejeitada' && ['204', '539'].includes(r.cStat)) {
    await q(`UPDATE nfe_notas SET situacao = 'pendente', c_stat = $2, motivo = $3, updated_at = now() WHERE id = $1`, [nota.id, r.cStat, r.xMotivo]);
    return getNota(nota.id);
  }

  await gravarResultado(nota.id, assinada, r);
  if (r.situacao === 'autorizada') {
    for (const it of body.itens || []) {
      if (it.produto_id) await q('UPDATE nfe_produtos SET uso = uso + 1 WHERE id = $1', [it.produto_id]);
    }
  }
  return getNota(nota.id);
}

async function gravarResultado(id, assinada, r) {
  if (r.situacao === 'processando') {
    await q(`UPDATE nfe_notas SET situacao = 'pendente', recibo = $2, c_stat = $3, motivo = $4, updated_at = now() WHERE id = $1`, [
      id, r.nRec || null, r.cStat, r.xMotivo || 'Em processamento na SEFAZ'
    ]);
    return;
  }
  const proc = r.protXml ? montarProc(assinada, r.protXml) : null;
  await q(
    `UPDATE nfe_notas SET situacao = $2, c_stat = $3, motivo = $4, protocolo = $5, xml_proc = COALESCE($6, xml_proc), updated_at = now() WHERE id = $1`,
    [id, r.situacao, r.cStat, r.xMotivo, r.nProt || null, r.situacao === 'rejeitada' ? null : proc]
  );
}

// Resolve uma nota pendente perguntando à SEFAZ pela chave.
export async function consultarNota(id) {
  const nota = await getNota(id);
  if (!nota.chave) throw new NfeError('Esta nota ainda não tem chave.');
  const cert = await loadCert();
  const r = await consultarChave(nota.ambiente, nota.chave, cert);
  if (r.situacao === 'inexistente') {
    // A SEFAZ não recebeu: volta a ser rejeitada para poder corrigir/reenviar com o mesmo número.
    if (['pendente', 'enviando'].includes(nota.situacao)) {
      await q(`UPDATE nfe_notas SET situacao = 'rejeitada', c_stat = $2, motivo = $3, updated_at = now() WHERE id = $1`, [
        id, r.cStat, 'A SEFAZ não recebeu esta nota. Pode reenviar.'
      ]);
    }
  } else if (r.protXml && nota.xml) {
    await q(
      `UPDATE nfe_notas SET situacao = $2, c_stat = $3, motivo = $4, protocolo = $5, xml_proc = $6, updated_at = now() WHERE id = $1`,
      [id, r.situacao, r.cStat, r.xMotivo, r.nProt, montarProc(nota.xml, r.protXml)]
    );
  } else if (r.situacao === 'cancelada' && nota.situacao !== 'cancelada') {
    await q(`UPDATE nfe_notas SET situacao = 'cancelada', updated_at = now() WHERE id = $1`, [id]);
  }
  return { consulta: { cStat: r.cStat, xMotivo: r.xMotivo, situacao: r.situacao }, nota: await getNota(id) };
}

// Consulta qualquer chave (ex.: as notas que ficaram "ENVIADA" no C&K).
export async function consultarChaveAvulsa(chave) {
  const c = digits(chave);
  if (c.length !== 44) throw new NfeError('A chave tem 44 números.');
  const ambiente = (await getConfig()).ambiente;
  const r = await consultarChave(ambiente, c, await loadCert());
  return { chave: c, numero: Number(c.slice(25, 34)), serie: Number(c.slice(22, 25)), cStat: r.cStat, xMotivo: r.xMotivo, situacao: r.situacao, protocolo: r.nProt };
}

export async function cancelar(id, justificativa, user) {
  const nota = await getNota(id);
  if (nota.situacao !== 'autorizada') throw new NfeError('Só dá para cancelar uma nota autorizada.');
  if (!nota.protocolo) throw new NfeError('A nota não tem protocolo de autorização.');
  const cfg = await getConfig();
  const cert = await loadCert();
  const evento = sign(
    buildEvento({ ambiente: nota.ambiente, cnpj: cfg.emitente.cnpj, chave: nota.chave, tpEvento: '110111', detalhe: detalheCancelamento(nota.protocolo, justificativa) }),
    'infEvento',
    cert
  );
  const r = await enviarEvento(nota.ambiente, evento, cert);
  await q(
    `INSERT INTO nfe_eventos (nota_id, tipo, seq, ambiente, texto, protocolo, c_stat, motivo, xml, created_by)
     VALUES ($1, 'cancelamento', 1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, nota.ambiente, clean(justificativa), r.nProt || null, r.cStat, r.xMotivo, r.ok ? montarProcEvento(evento, r.retXml) : null, user || null]
  );
  if (!r.ok) throw new NfeError(`SEFAZ: ${r.xMotivo} (${r.cStat})`);
  await q(`UPDATE nfe_notas SET situacao = 'cancelada', updated_at = now() WHERE id = $1`, [id]);
  return getNota(id);
}

export async function cartaCorrecao(id, correcao, user) {
  const nota = await getNota(id);
  if (nota.situacao !== 'autorizada') throw new NfeError('Carta de correção só vale para nota autorizada.');
  const seq = Number(nota.cce_seq || 0) + 1;
  if (seq > 20) throw new NfeError('Limite de 20 cartas de correção atingido.');
  const cfg = await getConfig();
  const cert = await loadCert();
  const evento = sign(
    buildEvento({ ambiente: nota.ambiente, cnpj: cfg.emitente.cnpj, chave: nota.chave, tpEvento: '110110', seq, detalhe: detalheCCe(correcao) }),
    'infEvento',
    cert
  );
  const r = await enviarEvento(nota.ambiente, evento, cert);
  await q(
    `INSERT INTO nfe_eventos (nota_id, tipo, seq, ambiente, texto, protocolo, c_stat, motivo, xml, created_by)
     VALUES ($1, 'cce', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, seq, nota.ambiente, clean(correcao), r.nProt || null, r.cStat, r.xMotivo, r.ok ? montarProcEvento(evento, r.retXml) : null, user || null]
  );
  if (!r.ok) throw new NfeError(`SEFAZ: ${r.xMotivo} (${r.cStat})`);
  await q('UPDATE nfe_notas SET cce_seq = $2, updated_at = now() WHERE id = $1', [id, seq]);
  return getNota(id);
}

/**
 * Inutiliza uma faixa de números que nunca viraram nota autorizada.
 * Serve também para a série 1 do C&K (números que ficaram pulados).
 */
export async function inutilizarFaixa({ serie, inicio, fim, justificativa }, user) {
  const cfg = await getConfig();
  const s = Number(serie ?? cfg.serie);
  const ini = Number(inicio);
  const fin = Number(fim ?? inicio);
  if (fin - ini > 999) throw new NfeError('No máximo 1000 números por vez.');
  const { rows: usadas } = await q(
    `SELECT numero, situacao FROM nfe_notas WHERE ambiente = $1 AND serie = $2 AND numero BETWEEN $3 AND $4
       AND situacao IN ('autorizada', 'cancelada', 'denegada', 'pendente', 'enviando')`,
    [cfg.ambiente, s, ini, fin]
  );
  if (usadas.length) throw new NfeError(`O número ${usadas[0].numero} já é uma nota ${usadas[0].situacao} — não pode ser inutilizado.`);
  const cert = await loadCert();
  const xml = sign(
    buildInutilizacao({ ambiente: cfg.ambiente, cnpj: cfg.emitente.cnpj, uf: cfg.emitente.uf, serie: s, inicio: ini, fim: fin, justificativa }),
    'infInut',
    cert
  );
  const r = await sefazInutilizar(cfg.ambiente, xml, cert);
  await q(
    `INSERT INTO nfe_eventos (tipo, ambiente, serie, numero_ini, numero_fim, texto, protocolo, c_stat, motivo, xml, created_by)
     VALUES ('inutilizacao', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [cfg.ambiente, s, ini, fin, clean(justificativa), r.nProt || null, r.cStat, r.xMotivo, r.ok ? montarProcInut(xml, r.retXml) : null, user || null]
  );
  if (!r.ok) throw new NfeError(`SEFAZ: ${r.xMotivo} (${r.cStat})`);
  await q(
    `UPDATE nfe_notas SET situacao = 'inutilizada', updated_at = now() WHERE ambiente = $1 AND serie = $2 AND numero BETWEEN $3 AND $4 AND situacao = 'rejeitada'`,
    [cfg.ambiente, s, ini, fin]
  );
  // Se inutilizou números à frente da numeração, pula o contador para depois deles.
  const prox = await proximoNumero(cfg.ambiente, s);
  if (fin >= prox) {
    await q(
      `INSERT INTO nfe_numeracao (ambiente, serie, proximo) VALUES ($1, $2, $3) ON CONFLICT (ambiente, serie) DO UPDATE SET proximo = EXCLUDED.proximo`,
      [cfg.ambiente, s, fin + 1]
    );
  }
  return { ok: true, protocolo: r.nProt, cStat: r.cStat, xMotivo: r.xMotivo };
}

export async function listarInutilizacoes() {
  const { rows } = await q(
    `SELECT id, ambiente, serie, numero_ini, numero_fim, texto, protocolo, c_stat, motivo, created_by, created_at
     FROM nfe_eventos WHERE tipo = 'inutilizacao' ORDER BY id DESC LIMIT 100`
  );
  return rows;
}

export async function getEventoXml(eventoId) {
  const { rows } = await q('SELECT tipo, seq, xml, nota_id, numero_ini FROM nfe_eventos WHERE id = $1', [eventoId]);
  if (!rows[0]?.xml) throw new NfeError('Evento sem XML.', 404);
  return rows[0];
}

// ------------------------------------------------------------------ resumo

export async function resumo(ambiente) {
  const amb = Number(ambiente) === 1 ? 1 : 2;
  // Agrega em JS (mês no fuso de Brasília), como o resto do sistema.
  const desde = new Date(Date.now() - 400 * 864e5).toISOString();
  const { rows } = await q(
    `SELECT dh_emissao, valor_total FROM nfe_notas WHERE ambiente = $1 AND situacao = 'autorizada' AND dh_emissao >= $2`,
    [amb, desde]
  );
  const porMes = new Map();
  for (const r of rows) {
    const mes = new Date(new Date(r.dh_emissao).getTime() - 3 * 3600e3).toISOString().slice(0, 7);
    const m = porMes.get(mes) || { mes, qtd: 0, total: 0 };
    m.qtd++;
    m.total = round2(m.total + Number(r.valor_total || 0));
    porMes.set(mes, m);
  }
  const { rows: pend } = await q(
    `SELECT situacao, COUNT(*)::int AS n FROM nfe_notas WHERE ambiente = $1 AND situacao IN ('pendente', 'rejeitada', 'enviando') GROUP BY situacao`,
    [amb]
  );
  return {
    meses: [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, 12),
    pendencias: Object.fromEntries(pend.map((p) => [p.situacao, p.n]))
  };
}

// ------------------------------------------------------------------ importação do C&K

// Recebe lotes gerados pelo script tools/nfe/exportar-cnk.mjs. Idempotente: importar
// duas vezes não duplica nada (clientes por documento, produtos por código, notas por chave).
export async function importar(lote) {
  const out = { clientes: 0, produtos: 0, notas: 0, ignoradas: 0 };
  for (const c of lote.clientes || []) {
    try {
      const doc = digits(c.documento);
      const { rows } = await q('SELECT id FROM nfe_clientes WHERE documento = $1', [doc]);
      if (rows[0]) continue;
      const n = normalizarCliente(c);
      await q(
        `INSERT INTO nfe_clientes (${CLIENTE_CAMPOS.join(', ')}, origem) VALUES (${CLIENTE_CAMPOS.map((_, i) => `$${i + 1}`).join(', ')}, 'cnk')`,
        CLIENTE_CAMPOS.map((k) => n[k])
      );
      out.clientes++;
    } catch {
      out.ignoradas++;
    }
  }
  for (const p of lote.produtos || []) {
    try {
      const { rows } = await q('SELECT id FROM nfe_produtos WHERE codigo = $1', [clean(p.codigo, 60)]);
      if (rows[0]) continue;
      await salvarProduto(null, p);
      out.produtos++;
    } catch {
      out.ignoradas++;
    }
  }
  for (const xmlProc of lote.notas || []) {
    const inf = pickBlock(xmlProc, 'infNFe');
    const chave = (inf.match(/Id="NFe(\d{44})"/) || [])[1];
    const prot = pickBlock(xmlProc, 'infProt');
    if (!chave || !prot || !['100', '150'].includes(pick(prot, 'cStat'))) {
      out.ignoradas++;
      continue;
    }
    const { rows } = await q('SELECT id FROM nfe_notas WHERE chave = $1', [chave]);
    if (rows[0]) continue;
    const ide = pickBlock(inf, 'ide');
    const dest = pickBlock(inf, 'dest');
    const tpAmb = Number(pick(ide, 'tpAmb'));
    const cancelada = (lote.canceladas || []).includes(chave);
    try {
      await q(
        `INSERT INTO nfe_notas (ambiente, serie, numero, chave, situacao, cliente_nome, cliente_doc, cliente_uf, valor_total, nat_op,
           dh_emissao, xml_proc, protocolo, c_stat, motivo, origem)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'cnk')`,
        [
          tpAmb, Number(pick(ide, 'serie')), Number(pick(ide, 'nNF')), chave, cancelada ? 'cancelada' : 'autorizada',
          pick(dest, 'xNome'), pick(dest, 'CNPJ') || pick(dest, 'CPF'), pick(pickBlock(dest, 'enderDest'), 'UF'),
          Number(pick(pickBlock(inf, 'ICMSTot'), 'vNF')), pick(ide, 'natOp'), pick(ide, 'dhEmi') || pick(ide, 'dEmi'),
          xmlProc, pick(prot, 'nProt'), pick(prot, 'cStat'), pick(prot, 'xMotivo')
        ]
      );
      out.notas++;
      // Conta quantas vezes cada produto saiu (ordem das sugestões na emissão).
      for (const [, det] of inf.matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)) {
        const cod = pick(pickBlock(det, 'prod'), 'cProd');
        if (cod) await q('UPDATE nfe_produtos SET uso = uso + 1 WHERE codigo = $1', [cod]);
      }
    } catch {
      out.ignoradas++;
    }
  }
  return out;
}
