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

const mesSP = (iso) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 7);

function somar(map, chave, valor, extra = {}) {
  const k = chave || '—';
  const cur = map.get(k) || { chave: k, total: 0, qtd: 0, ...extra };
  cur.total = round2(cur.total + valor);
  cur.qtd += extra.qtdInc ?? 1;
  map.set(k, cur);
  return cur;
}
const ordenar = (map, n = 50) =>
  [...map.values()].map(({ qtdInc, ...r }) => r).sort((a, b) => b.total - a.total).slice(0, n);

/**
 * periodo: 'YYYY-MM' (um mês) ou 'YYYY' (o ano todo). Só produção (ambiente 1).
 */
export async function painel(periodo) {
  await ensureFaturamentoSchema();
  const pendentes = await lerItensPendentes({ tempoMs: 12000 });

  const { rows: notas } = await q(
    `SELECT id, numero, serie, situacao, cliente_nome, cliente_doc, cliente_uf, valor_total, dh_emissao, t_pag, origem
     FROM nfe_notas WHERE ambiente = 1 AND situacao IN ('autorizada', 'cancelada') AND dh_emissao IS NOT NULL`
  );
  const autorizadas = notas.filter((n) => n.situacao === 'autorizada');

  // Série mensal (últimos 24 meses com dados).
  const porMes = new Map();
  for (const n of autorizadas) somar(porMes, mesSP(n.dh_emissao), Number(n.valor_total));
  const meses = [...porMes.values()].sort((a, b) => a.chave.localeCompare(b.chave)).slice(-24).map((m) => ({ mes: m.chave, total: m.total, qtd: m.qtd }));
  const anos = [...new Set(autorizadas.map((n) => mesSP(n.dh_emissao).slice(0, 4)))].sort().reverse();

  const p = String(periodo || mesSP(new Date().toISOString()));
  const noPeriodo = (n) => mesSP(n.dh_emissao).startsWith(p);
  const doPeriodo = autorizadas.filter(noPeriodo);
  const canceladas = notas.filter((n) => n.situacao === 'cancelada' && noPeriodo(n));
  const total = round2(doPeriodo.reduce((s, n) => s + Number(n.valor_total), 0));

  // Comparação: mês anterior (ou ano anterior) e o mesmo período do ano passado.
  const anterior = (() => {
    if (/^\d{4}$/.test(p)) return String(Number(p) - 1);
    const [y, m] = p.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 15));
    return d.toISOString().slice(0, 7);
  })();
  const anoPassado = /^\d{4}-\d{2}$/.test(p) ? `${Number(p.slice(0, 4)) - 1}${p.slice(4)}` : null;
  const totalDe = (per) => round2(autorizadas.filter((n) => mesSP(n.dh_emissao).startsWith(per)).reduce((s, n) => s + Number(n.valor_total), 0));

  // Itens das notas do período.
  const ids = doPeriodo.map((n) => n.id);
  let itens = [];
  if (ids.length) {
    const { rows } = await q('SELECT * FROM nfe_itens');
    const set = new Set(ids);
    itens = rows.filter((r) => set.has(r.nota_id));
  }
  const porCategoria = new Map();
  const porProduto = new Map();
  const porTamanho = new Map();
  const porMaterial = new Map();
  for (const it of itens) {
    const v = Number(it.valor);
    const u = Number(it.quantidade);
    const cat = somar(porCategoria, it.categoria, v, { unidades: 0 });
    cat.unidades = round2(cat.unidades + u);
    const prod = somar(porProduto, it.descricao, v, { unidades: 0, categoria: it.categoria });
    prod.unidades = round2(prod.unidades + u);
    if (it.categoria === 'Placas' && it.tamanho) {
      const t = somar(porTamanho, `${it.tamanho} cm`.replace(' cm cm', ' cm'), v, { unidades: 0 });
      t.unidades = round2(t.unidades + u);
    }
    if (it.material) {
      const mt = somar(porMaterial, it.material, v, { unidades: 0 });
      mt.unidades = round2(mt.unidades + u);
    }
  }

  const porCliente = new Map();
  const porUF = new Map();
  const porTipo = new Map();
  const porPagamento = new Map();
  for (const n of doPeriodo) {
    const v = Number(n.valor_total);
    somar(porCliente, n.cliente_doc || n.cliente_nome, v, { nome: n.cliente_nome, documento: n.cliente_doc });
    somar(porUF, n.cliente_uf || '—', v);
    somar(porTipo, String(n.cliente_doc || '').length === 11 ? 'Pessoa física' : 'Empresa', v);
    somar(porPagamento, PAGAMENTO[n.t_pag] || (n.t_pag ? `Código ${n.t_pag}` : 'Não informado'), v);
  }

  return {
    periodo: p,
    pendentes,
    anos,
    meses,
    resumo: {
      total,
      notas: doPeriodo.length,
      ticket_medio: doPeriodo.length ? round2(total / doPeriodo.length) : 0,
      canceladas: canceladas.length,
      valor_cancelado: round2(canceladas.reduce((s, n) => s + Number(n.valor_total), 0)),
      unidades: round2(itens.reduce((s, i) => s + Number(i.quantidade), 0)),
      clientes: porCliente.size,
      anterior: { periodo: anterior, total: totalDe(anterior) },
      ano_passado: anoPassado ? { periodo: anoPassado, total: totalDe(anoPassado) } : null
    },
    categorias: ordenar(porCategoria),
    produtos: ordenar(porProduto, 30),
    tamanhos: ordenar(porTamanho, 20),
    materiais: ordenar(porMaterial, 10),
    clientes: ordenar(porCliente, 15).map((c) => ({ nome: c.nome, documento: c.documento, total: c.total, notas: c.qtd })),
    ufs: ordenar(porUF, 30),
    tipos: ordenar(porTipo),
    pagamentos: ordenar(porPagamento),
    ultimas: doPeriodo
      .sort((a, b) => String(b.dh_emissao).localeCompare(String(a.dh_emissao)))
      .slice(0, 40)
      .map((n) => ({
        id: n.id,
        numero: n.numero,
        serie: n.serie,
        cliente: n.cliente_nome,
        valor: Number(n.valor_total),
        dh_emissao: n.dh_emissao,
        itens: itens.filter((i) => i.nota_id === n.id).map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade), valor: Number(i.valor), categoria: i.categoria }))
      }))
  };
}
