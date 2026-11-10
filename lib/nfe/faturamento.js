// Faturamento a partir das notas fiscais autorizadas (produção).
//
// Os itens de cada nota são lidos do XML autorizado uma única vez e guardados em
// nfe_itens já classificados (categoria, tamanho, material) — assim o painel não
// precisa abrir 2 mil XMLs a cada visita.
import { q } from '../db.js';
import { pick, pickBlock } from './sefaz.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const unesc = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

let pronto = null;
export function ensureFaturamentoSchema() {
  if (!pronto) {
    pronto = (async () => {
      await q(`
        CREATE TABLE IF NOT EXISTS nfe_itens (
          id SERIAL PRIMARY KEY,
          nota_id INTEGER NOT NULL,
          n_item INTEGER NOT NULL,
          codigo TEXT,
          descricao TEXT,
          ncm TEXT,
          cfop TEXT,
          unidade TEXT,
          quantidade DOUBLE PRECISION NOT NULL DEFAULT 0,
          valor DOUBLE PRECISION NOT NULL DEFAULT 0,
          categoria TEXT,
          tamanho TEXT,
          material TEXT
        )`);
      for (const ddl of [
        'ALTER TABLE nfe_notas ADD COLUMN IF NOT EXISTS itens_lidos INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE nfe_notas ADD COLUMN IF NOT EXISTS t_pag TEXT',
        'CREATE INDEX IF NOT EXISTS nfe_itens_nota ON nfe_itens (nota_id)'
      ]) {
        try {
          await q(ddl);
        } catch {
          try {
            await q(ddl.replace(' IF NOT EXISTS', ''));
          } catch {
            // já existe
          }
        }
      }
    })().catch((e) => {
      pronto = null;
      throw e;
    });
  }
  return pronto;
}

// ------------------------------------------------------------------ classificação

// O que é o item, pelo jeito que a Classul escreve as descrições ("PLACA ACO TAM 12X17CM C/ EST").
export function classificar(descricao, ncm = '') {
  const d = semAcento(descricao);
  const n = String(ncm || '');
  let categoria = 'Outros';
  if (/ESTOJO/.test(d) && !/PLACA/.test(d)) categoria = 'Estojos';
  else if (/MEDALH/.test(d)) categoria = 'Medalhas';
  else if (/TROF|ESTATUETA/.test(d)) categoria = 'Troféus';
  else if (/\bPINS?\b|BOTON|BOTTON|BOTOM|BROCHE/.test(d)) categoria = 'Pins e botons';
  else if (/CRACHA/.test(d)) categoria = 'Crachás';
  else if (/MOLDURA|QUADRO/.test(d)) categoria = 'Quadros e molduras';
  else if (/CHAPA/.test(d)) categoria = 'Chapas';
  else if (/ETIQUETA|ADESIVO|ADEVISO/.test(d)) categoria = 'Etiquetas e adesivos';
  else if (/PLACA|PLAQUETA/.test(d) || n.startsWith('8310')) categoria = 'Placas';
  else if (/ESTOJO/.test(d)) categoria = 'Estojos';

  // Medida: "12X17CM", "12 X 17", "14x20" → "12x17". Para pins, o diâmetro em mm.
  const m = d.match(/(\d+(?:[.,]\d+)?)\s*X\s*(\d+(?:[.,]\d+)?)/);
  let tamanho = m ? `${m[1].replace('.', ',')}x${m[2].replace('.', ',')}` : null;
  if (!tamanho) {
    const unico = d.match(/(\d+(?:[.,]\d+)?)\s*(CM|MM)\b/);
    if (unico) tamanho = `${unico[1].replace('.', ',')} ${unico[2].toLowerCase()}`;
  }

  let material = null;
  if (/INOX/.test(d)) material = 'Inox';
  else if (/LATAO|DOUR/.test(d)) material = 'Latão';
  else if (/ALUM/.test(d)) material = 'Alumínio';
  else if (/ACRIL/.test(d)) material = 'Acrílico';
  else if (/\bACO\b/.test(d)) material = 'Aço';
  else if (/MDF|MADEIRA/.test(d)) material = 'MDF';
  else if (/RESINA/.test(d)) material = 'Resina';
  else if (/VEL(UDO)?\b/.test(d)) material = 'Veludo';

  const comEstojo = categoria === 'Placas' && /C\/\s*EST|COM ESTOJO/.test(d);
  return { categoria, tamanho, material, comEstojo };
}

// ------------------------------------------------------------------ leitura dos itens

function itensDoXml(xml) {
  return [...String(xml || '').matchAll(/<det nItem="(\d+)">([\s\S]*?)<\/det>/g)].map(([, n, det]) => {
    const prod = pickBlock(det, 'prod');
    const descricao = unesc(pick(prod, 'xProd'));
    const ncm = pick(prod, 'NCM');
    const bruto = Number(pick(prod, 'vProd')) || 0;
    const desconto = Number(pick(prod, 'vDesc')) || 0;
    return {
      n_item: Number(n),
      codigo: pick(prod, 'cProd'),
      descricao,
      ncm,
      cfop: pick(prod, 'CFOP'),
      unidade: pick(prod, 'uCom'),
      quantidade: Number(pick(prod, 'qCom')) || 0,
      valor: round2(bruto - desconto),
      ...classificar(descricao, ncm)
    };
  });
}

// Lê os itens das notas que ainda não foram lidas, em lotes, até o tempo acabar.
// Devolve quantas ainda faltam (o painel chama de novo se faltar).
export async function lerItensPendentes({ tempoMs = 15000, lote = 150 } = {}) {
  await ensureFaturamentoSchema();
  const fim = Date.now() + tempoMs;
  while (Date.now() < fim) {
    const { rows } = await q(
      `SELECT id, COALESCE(xml_proc, xml) AS xml FROM nfe_notas
       WHERE itens_lidos = 0 AND (xml_proc IS NOT NULL OR xml IS NOT NULL) ORDER BY id LIMIT $1`,
      [lote]
    );
    if (!rows.length) break;
    // Um lote = poucas consultas (apaga, insere tudo de uma vez, marca como lidas).
    const ids = rows.map((r) => r.id);
    const lista = ids.map((_, i) => `$${i + 1}`).join(', ');
    await q(`DELETE FROM nfe_itens WHERE nota_id IN (${lista})`, ids);
    const linhas = [];
    const porPag = new Map();
    for (const nota of rows) {
      for (const it of itensDoXml(nota.xml)) {
        linhas.push([nota.id, it.n_item, it.codigo, it.descricao, it.ncm, it.cfop, it.unidade, it.quantidade, it.valor, it.categoria, it.tamanho, it.material]);
      }
      const tPag = (String(nota.xml).match(/<tPag>(\d+)<\/tPag>/) || [])[1] || '';
      porPag.set(tPag, [...(porPag.get(tPag) || []), nota.id]);
    }
    for (let i = 0; i < linhas.length; i += 400) {
      const fatia = linhas.slice(i, i + 400);
      const marcas = fatia.map((_, j) => `(${Array.from({ length: 12 }, (__, k) => `$${j * 12 + k + 1}`).join(', ')})`);
      await q(
        `INSERT INTO nfe_itens (nota_id, n_item, codigo, descricao, ncm, cfop, unidade, quantidade, valor, categoria, tamanho, material)
         VALUES ${marcas.join(', ')}`,
        fatia.flat()
      );
    }
    for (const [tPag, idsPag] of porPag) {
      const l = idsPag.map((_, i) => `$${i + 2}`).join(', ');
      await q(`UPDATE nfe_notas SET itens_lidos = 1, t_pag = $1 WHERE id IN (${l})`, [tPag || null, ...idsPag]);
    }
  }
  const { rows } = await q(
    'SELECT COUNT(*)::int AS n FROM nfe_notas WHERE itens_lidos = 0 AND (xml_proc IS NOT NULL OR xml IS NOT NULL)'
  );
  return rows[0].n;
}

// Marca a nota para ser lida de novo (depois de emitir/reenviar).
export async function marcarParaLer(notaId) {
  await ensureFaturamentoSchema();
  await q('UPDATE nfe_notas SET itens_lidos = 0 WHERE id = $1', [notaId]);
}

// ------------------------------------------------------------------ painel

const PAGAMENTO = {
  '01': 'Dinheiro', '03': 'Cartão de crédito', '04': 'Cartão de débito', '15': 'Boleto', '16': 'Depósito bancário',
  '17': 'PIX', '18': 'Transferência / carteira digital', '20': 'PIX', '90': 'Sem pagamento', '99': 'Outros'
};
const pagamentoDe = (t) => PAGAMENTO[t] || (t ? `Código ${t}` : 'Não informado');
const tipoDe = (doc) => (String(doc || '').length === 11 ? 'Pessoa física' : 'Empresa');
const tamanhoDe = (t) => (t ? `${t} cm`.replace(' cm cm', ' cm').replace(/ (mm|cm) cm$/, ' $1') : null);

// Data local (São Paulo, UTC-3) da emissão: 'YYYY-MM-DD'.
const diaSP = (iso) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const hojeSP = () => diaSP(new Date().toISOString());
const ehDia = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const addDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fimDoMes = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5);
// Mesmo dia no ano anterior (29/02 vira 28/02).
const menosUmAno = (dia) => {
  const [y, m, d] = dia.split('-');
  const alvo = `${Number(y) - 1}-${m}-${d}`;
  return m === '02' && d === '29' ? `${Number(y) - 1}-02-28` : alvo;
};
// Segunda-feira da semana do dia.
const inicioSemana = (dia) => {
  const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return addDias(dia, -((dow + 6) % 7));
};

function somar(map, chave, valor, extra = {}) {
  const k = chave || '—';
  const cur = map.get(k) || { chave: k, total: 0, qtd: 0, ...extra };
  cur.total = round2(cur.total + valor);
  cur.qtd += 1;
  map.set(k, cur);
  return cur;
}
const ordenar = (map, n = 50) => [...map.values()].sort((a, b) => b.total - a.total).slice(0, n);

// Filtros que chegam da tela (tudo opcional). 'periodo' (YYYY ou YYYY-MM) é o formato antigo.
export function lerFiltros(query = {}) {
  const txt = (v, max = 80) => String(v || '').trim().slice(0, max);
  const f = {
    de: ehDia(query.de) ? query.de : '',
    ate: ehDia(query.ate) ? query.ate : '',
    granularidade: ['dia', 'semana', 'mes', 'ano'].includes(query.granularidade) ? query.granularidade : '',
    categoria: txt(query.categoria),
    tamanho: txt(query.tamanho),
    material: txt(query.material),
    produto: txt(query.produto),
    uf: txt(query.uf, 2).toUpperCase(),
    tipo: ['pf', 'pj'].includes(query.tipo) ? query.tipo : '',
    pagamento: txt(query.pagamento),
    cliente: txt(query.cliente)
  };
  const p = String(query.periodo || '');
  if (!f.de && /^\d{4}$/.test(p)) Object.assign(f, { de: `${p}-01-01`, ate: `${p}-12-31` });
  else if (!f.de && /^\d{4}-\d{2}$/.test(p)) Object.assign(f, { de: `${p}-01`, ate: fimDoMes(p) });
  return f;
}

// Período anterior de mesmo tamanho: mês inteiro → mês anterior inteiro; ano → ano anterior.
function periodoAnterior(de, ate) {
  if (de.endsWith('-01-01') && ate.endsWith('-12-31') && de.slice(0, 4) === ate.slice(0, 4)) {
    const y = Number(de.slice(0, 4)) - 1;
    return { de: `${y}-01-01`, ate: `${y}-12-31` };
  }
  if (de.endsWith('-01') && ate === fimDoMes(de.slice(0, 7))) {
    const ini = addDias(de, -1).slice(0, 7);
    return { de: `${ini}-01`, ate: fimDoMes(ini) };
  }
  const n = diasEntre(de, ate) + 1;
  return { de: addDias(de, -n), ate: addDias(de, -1) };
}

function chaveDe(dia, g) {
  if (g === 'dia') return dia;
  if (g === 'semana') return inicioSemana(dia);
  if (g === 'mes') return dia.slice(0, 7);
  return dia.slice(0, 4);
}
// Todas as chaves do intervalo (para os buracos aparecerem como zero).
function chavesDoIntervalo(de, ate, g) {
  const out = [];
  let d = g === 'semana' ? inicioSemana(de) : de;
  while (d <= ate && out.length < 800) {
    const k = chaveDe(d, g);
    if (out.at(-1) !== k) out.push(k);
    if (g === 'dia') d = addDias(d, 1);
    else if (g === 'semana') d = addDias(d, 7);
    else if (g === 'mes') d = addDias(fimDoMes(d.slice(0, 7)), 1);
    else d = `${Number(d.slice(0, 4)) + 1}-01-01`;
  }
  return out;
}

/**
 * Painel de faturamento pelas notas autorizadas em produção (ambiente 1).
 * filtros: ver lerFiltros. Aceita também a string 'YYYY' / 'YYYY-MM' (formato antigo).
 */
export async function painel(filtrosOuPeriodo = {}) {
  const f = typeof filtrosOuPeriodo === 'string' ? lerFiltros({ periodo: filtrosOuPeriodo }) : { ...lerFiltros({}), ...filtrosOuPeriodo };
  await ensureFaturamentoSchema();
  const pendentes = await lerItensPendentes({ tempoMs: 12000 });

  const { rows: todasNotas } = await q(
    `SELECT id, numero, serie, situacao, cliente_nome, cliente_doc, cliente_uf, valor_total, dh_emissao, t_pag, origem
     FROM nfe_notas WHERE ambiente = 1 AND situacao IN ('autorizada', 'cancelada') AND dh_emissao IS NOT NULL`
  );
  const { rows: todosItens } = await q(
    'SELECT nota_id, descricao, quantidade, valor, categoria, tamanho, material FROM nfe_itens'
  );
  const itensDa = new Map();
  for (const it of todosItens) {
    const l = itensDa.get(it.nota_id) || [];
    l.push({
      descricao: it.descricao,
      quantidade: Number(it.quantidade) || 0,
      valor: Number(it.valor) || 0,
      categoria: it.categoria || 'Outros',
      tamanho: it.categoria === 'Placas' ? tamanhoDe(it.tamanho) : null,
      material: it.material || null
    });
    itensDa.set(it.nota_id, l);
  }

  const hoje = hojeSP();
  const de = f.de || `${hoje.slice(0, 7)}-01`;
  const ate = f.ate && f.ate >= de ? f.ate : f.ate ? de : hoje;

  // ---- filtros da nota (cliente, estado, tipo, pagamento) e dos itens (categoria, tamanho, material, produto)
  const busca = semAcento(f.cliente);
  const buscaDoc = f.cliente.replace(/\D/g, '');
  const filtroItem = Boolean(f.categoria || f.tamanho || f.material || f.produto);
  const buscaProduto = semAcento(f.produto);
  const itemPassa = (it) =>
    (!f.categoria || it.categoria === f.categoria) &&
    (!f.tamanho || it.tamanho === f.tamanho) &&
    (!f.material || it.material === f.material) &&
    (!buscaProduto || semAcento(it.descricao).includes(buscaProduto));
  const notaPassa = (n) =>
    (!f.uf || (n.cliente_uf || '—') === f.uf) &&
    (!f.tipo || (f.tipo === 'pf') === (String(n.cliente_doc || '').length === 11)) &&
    (!f.pagamento || pagamentoDe(n.t_pag) === f.pagamento) &&
    (!busca || semAcento(n.cliente_nome).includes(busca) || (buscaDoc.length >= 3 && String(n.cliente_doc || '').includes(buscaDoc)));

  // Cada nota com o valor que conta para o filtro: a nota inteira ou só os itens que batem.
  const base = [];
  const canceladasBase = [];
  for (const n of todasNotas) {
    if (!notaPassa(n)) continue;
    const todos = itensDa.get(n.id) || [];
    const itens = filtroItem ? todos.filter(itemPassa) : todos;
    if (filtroItem && !itens.length) continue;
    const valor = filtroItem ? round2(itens.reduce((s, i) => s + i.valor, 0)) : Number(n.valor_total) || 0;
    const reg = { ...n, dia: diaSP(n.dh_emissao), valor, itens, todos, cliente: n.cliente_doc || semAcento(n.cliente_nome) };
    if (n.situacao === 'autorizada') base.push(reg);
    else canceladasBase.push(reg);
  }
  base.sort((a, b) => String(a.dh_emissao).localeCompare(String(b.dh_emissao)));

  const entre = (a, b) => (n) => n.dia >= a && n.dia <= b;
  const noPeriodo = base.filter(entre(de, ate));
  const soma = (l) => round2(l.reduce((s, n) => s + n.valor, 0));
  const total = soma(noPeriodo);

  // Primeira compra de cada cliente (dentro do filtro) → clientes novos x que voltaram.
  const primeira = new Map();
  for (const n of base) if (!primeira.has(n.cliente)) primeira.set(n.cliente, n.dia);

  // Período que ainda não terminou (ex.: "este ano") compara só até hoje nos dois lados.
  const ant = periodoAnterior(de, ate);
  const pas = { de: menosUmAno(de), ate: menosUmAno(ate) };
  const corteHoje = ate > hoje && de <= hoje;
  if (corteHoje) {
    ant.ate = addDias(ant.de, diasEntre(de, hoje));
    pas.ate = menosUmAno(hoje);
  }
  const resumoDe = (l) => {
    const t = soma(l);
    return { total: t, notas: l.length, ticket_medio: l.length ? round2(t / l.length) : 0, clientes: new Set(l.map((n) => n.cliente)).size };
  };

  // ---- série no tempo (com o mesmo período do ano passado ao lado)
  const nDias = diasEntre(de, ate) + 1;
  let g = f.granularidade || (nDias <= 45 ? 'dia' : nDias <= 190 ? 'semana' : nDias <= 1100 ? 'mes' : 'ano');
  if (g === 'dia' && nDias > 400) g = 'semana';
  if (g === 'semana' && nDias > 1100) g = 'mes';
  const chaves = chavesDoIntervalo(de, ate, g);
  const pontos = new Map(chaves.map((k) => [k, { chave: k, total: 0, notas: 0, unidades: 0, clientes_novos: 0, categorias: {}, ano_passado: 0, notas_ano_passado: 0 }]));
  for (const n of noPeriodo) {
    const p = pontos.get(chaveDe(n.dia, g));
    if (!p) continue;
    p.total = round2(p.total + n.valor);
    p.notas += 1;
    if (primeira.get(n.cliente) === n.dia) p.clientes_novos += 1;
    for (const it of n.itens) {
      p.unidades = round2(p.unidades + it.quantidade);
      p.categorias[it.categoria] = round2((p.categorias[it.categoria] || 0) + it.valor);
    }
  }
  // Ano passado: desloca o dia um ano para frente e cai no mesmo balde.
  for (const n of base.filter(entre(pas.de, pas.ate))) {
    const [y, m, d] = n.dia.split('-');
    let dia = `${Number(y) + 1}-${m}-${d}`;
    if (g === 'semana') dia = addDias(n.dia, 364); // mesma semana do ano, mesmo dia da semana
    const p = pontos.get(chaveDe(dia, g));
    if (!p) continue;
    p.ano_passado = round2(p.ano_passado + n.valor);
    p.notas_ano_passado += 1;
  }
  const serie = [...pontos.values()].map((p) => ({ ...p, ticket_medio: p.notas ? round2(p.total / p.notas) : 0 }));

  // ---- anos: total de cada ano, mês a mês e "até hoje" (mesmo dia/mês em todos os anos)
  const mmdd = hoje.slice(5);
  const porAno = new Map();
  for (const n of base) {
    const y = n.dia.slice(0, 4);
    const a = porAno.get(y) || { ano: y, total: 0, notas: 0, clientes: new Set(), meses: Array(12).fill(0), notas_mes: Array(12).fill(0), ate_hoje: 0 };
    a.total = round2(a.total + n.valor);
    a.notas += 1;
    a.clientes.add(n.cliente);
    const m = Number(n.dia.slice(5, 7)) - 1;
    a.meses[m] = round2(a.meses[m] + n.valor);
    a.notas_mes[m] += 1;
    if (n.dia.slice(5) <= mmdd) a.ate_hoje = round2(a.ate_hoje + n.valor);
    porAno.set(y, a);
  }
  const anos = [...porAno.values()]
    .sort((a, b) => a.ano.localeCompare(b.ano))
    .map((a) => ({ ...a, clientes: a.clientes.size, ticket_medio: a.notas ? round2(a.total / a.notas) : 0, ano_corrente: a.ano === hoje.slice(0, 4) }));

  // ---- rankings do período
  const porCategoria = new Map();
  const porProduto = new Map();
  const porTamanho = new Map();
  const porMaterial = new Map();
  let unidades = 0;
  for (const n of noPeriodo) {
    for (const it of n.itens) {
      unidades += it.quantidade;
      const add = (map, k, extra) => {
        const r = somar(map, k, it.valor, { unidades: 0, ...extra });
        r.unidades = round2(r.unidades + it.quantidade);
      };
      add(porCategoria, it.categoria);
      add(porProduto, it.descricao, { categoria: it.categoria });
      if (it.tamanho) add(porTamanho, it.tamanho);
      if (it.material) add(porMaterial, it.material);
    }
  }
  const porCliente = new Map();
  const porUF = new Map();
  const porTipo = new Map();
  const porPagamento = new Map();
  const semana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((d) => ({ chave: d, total: 0, qtd: 0 }));
  let novos = 0;
  const vistos = new Set();
  for (const n of noPeriodo) {
    const c = somar(porCliente, n.cliente, n.valor, { nome: n.cliente_nome, documento: n.cliente_doc, ultima: n.dia, primeira: primeira.get(n.cliente) });
    c.ultima = n.dia;
    somar(porUF, n.cliente_uf || '—', n.valor);
    somar(porTipo, tipoDe(n.cliente_doc), n.valor);
    somar(porPagamento, pagamentoDe(n.t_pag), n.valor);
    const s = semana[new Date(`${n.dia}T12:00:00Z`).getUTCDay()];
    s.total = round2(s.total + n.valor);
    s.qtd += 1;
    if (!vistos.has(n.cliente)) {
      vistos.add(n.cliente);
      if (primeira.get(n.cliente) >= de) novos += 1;
    }
  }
  const canceladas = canceladasBase.filter(entre(de, ate));
  const topClientes = ordenar(porCliente, 300);
  const top10 = topClientes.slice(0, 10).reduce((s, c) => s + c.total, 0);

  // Opções dos filtros (de tudo que já foi faturado, sem filtro).
  const contar = (vals) => {
    const m = new Map();
    for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const autorizadasTodas = todasNotas.filter((n) => n.situacao === 'autorizada');
  const itensTodos = autorizadasTodas.flatMap((n) => itensDa.get(n.id) || []);

  return {
    pendentes,
    filtros: { ...f, de, ate, granularidade: g },
    hoje,
    primeira_nota: autorizadasTodas.length ? autorizadasTodas.reduce((m, n) => (diaSP(n.dh_emissao) < m ? diaSP(n.dh_emissao) : m), hoje) : hoje,
    opcoes: {
      categorias: contar(itensTodos.map((i) => i.categoria)),
      tamanhos: contar(itensTodos.map((i) => i.tamanho)).slice(0, 40),
      materiais: contar(itensTodos.map((i) => i.material)),
      ufs: contar(autorizadasTodas.map((n) => n.cliente_uf || '—')),
      pagamentos: contar(autorizadasTodas.map((n) => pagamentoDe(n.t_pag)))
    },
    resumo: {
      ...resumoDe(noPeriodo),
      unidades: round2(unidades),
      clientes_novos: novos,
      canceladas: canceladas.length,
      valor_cancelado: round2(canceladas.reduce((s, n) => s + (Number(n.valor_total) || 0), 0)),
      concentracao_top10: total ? round2((top10 / total) * 100) : 0,
      maior_nota: noPeriodo.reduce((m, n) => (n.valor > m ? n.valor : m), 0),
      ate_hoje: corteHoje,
      anterior: { ...ant, ...resumoDe(base.filter(entre(ant.de, ant.ate))) },
      ano_passado: { ...pas, ...resumoDe(base.filter(entre(pas.de, pas.ate))) }
    },
    serie,
    anos,
    semana,
    categorias: ordenar(porCategoria),
    produtos: ordenar(porProduto, 100),
    tamanhos: ordenar(porTamanho, 40),
    materiais: ordenar(porMaterial, 15),
    clientes: topClientes.map((c) => ({ chave: c.chave, nome: c.nome, documento: c.documento, total: c.total, notas: c.qtd, ultima: c.ultima, novo: c.primeira >= de })),
    total_clientes: porCliente.size,
    ufs: ordenar(porUF, 30),
    tipos: ordenar(porTipo),
    pagamentos: ordenar(porPagamento),
    notas_total: noPeriodo.length,
    notas: noPeriodo
      .slice()
      .reverse()
      .slice(0, 600)
      .map((n) => ({
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        cliente: n.cliente_nome,
        documento: n.cliente_doc,
        uf: n.cliente_uf,
        valor: n.valor,
        valor_nota: Number(n.valor_total) || 0,
        dh_emissao: n.dh_emissao,
        pagamento: pagamentoDe(n.t_pag),
        itens: n.todos.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade, valor: i.valor, categoria: i.categoria, conta: !filtroItem || itemPassa(i) }))
      }))
  };
}
