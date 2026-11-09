// Gera o arquivo de importação da aba Notas a partir da pasta do C&K
// (clientes e produtos do banco bdNFe.db + todos os XMLs autorizados).
//
// Uso: node tools/nfe/exportar-cnk.mjs "<pasta do EmissorNFe>" [arquivo de saída]
// Depois, na aba Notas → Configurar → "Importar do C&K", escolha o arquivo gerado.
// O arquivo tem dados de clientes: não coloque dentro do projeto nem mande por aí.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';

const pasta = process.argv[2];
const saida = process.argv[3] || path.join(os.homedir(), 'Documents', 'classul-importacao-cnk.json');
if (!pasta || !fs.existsSync(path.join(pasta, 'bdNFe.db'))) {
  console.error('Informe a pasta do C&K (a que tem o bdNFe.db).');
  process.exit(1);
}

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const pick = (xml, name) => (String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)) || [])[1] || '';
const block = (xml, name) => (String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`)) || [])[0] || '';
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Copia o banco para não travar/alterar o arquivo que o C&K usa.
const tmpDb = path.join(os.tmpdir(), `cnk-${process.pid}.db`);
fs.copyFileSync(path.join(pasta, 'bdNFe.db'), tmpDb);
const db = new DatabaseSync(tmpDb, { readOnly: true });

// ---- produtos
const produtos = db
  .prepare('SELECT codigo, produto, un, cfop, ncm, origem, csosn, cest, vrvista FROM produtos')
  .all()
  .map((p) => {
    const cfop = digits(p.cfop) || '5101';
    return {
      codigo: String(p.codigo).trim(),
      descricao: String(p.produto || '').trim(),
      ncm: digits(p.ncm),
      cfop_dentro: cfop,
      cfop_fora: '6' + cfop.slice(1),
      unidade: (p.un || 'UND').trim(),
      valor: Number(p.vrvista) || 0,
      cest: digits(p.cest) === '0000000' ? '' : digits(p.cest),
      origem: String(p.origem ?? '0'),
      csosn: '102'
    };
  });

// ---- clientes: banco do C&K, depois sobrescritos pelo destinatário da nota mais recente
// (o que a SEFAZ já aceitou é o dado mais confiável).
const clientes = new Map();
for (const c of db
  .prepare('SELECT cliente, cnpj_cpf, insc_rg, cidade, endereco, numero, bairro, cep, uf, codcidade, fone, celular, email, indiedest FROM clientes')
  .all()) {
  const doc = digits(c.cnpj_cpf);
  if (doc.length !== 11 && doc.length !== 14) continue;
  clientes.set(doc, {
    documento: doc,
    nome: String(c.cliente || '').trim(),
    ie: doc.length === 14 ? digits(c.insc_rg) : '',
    contribuinte: String(c.indiedest) === '1' && digits(c.insc_rg) ? 1 : 0,
    email: String(c.email || '').trim(),
    telefone: digits(c.celular) || digits(c.fone),
    cep: digits(c.cep),
    logradouro: String(c.endereco || '').trim(),
    numero: String(c.numero || '').trim(),
    bairro: String(c.bairro || '').trim(),
    municipio: String(c.cidade || '').trim(),
    cod_municipio: digits(c.codcidade),
    uf: String(c.uf || '').trim().toUpperCase()
  });
}

// ---- notas autorizadas (PROCNFE) e canceladas (pasta CANCELADA)
const notas = new Map();
const canceladas = new Set();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^xsd|^PL_|Utilitarios/i.test(e.name)) continue;
      walk(f);
      continue;
    }
    if (/CANCELADA/i.test(dir)) {
      const m = e.name.match(/^(\d{44})/);
      if (m) canceladas.add(m[1]);
    }
    if (!/\.xml$/i.test(e.name)) continue;
    const xml = fs.readFileSync(f, 'utf8');
    if (!xml.includes('<nfeProc')) continue;
    const prot = block(xml, 'infProt');
    if (!['100', '150'].includes(pick(prot, 'cStat'))) continue;
    const chave = (xml.match(/Id="NFe(\d{44})"/) || [])[1];
    if (chave) notas.set(chave, xml.replace(/^﻿/, '').trim());
  }
}
walk(pasta);

const ordenadas = [...notas.values()].sort((a, b) => pick(a, 'dhEmi').localeCompare(pick(b, 'dhEmi')));
for (const xml of ordenadas) {
  const dest = block(xml, 'dest');
  const end = block(dest, 'enderDest');
  const doc = pick(dest, 'CNPJ') || pick(dest, 'CPF');
  if (!doc) continue;
  const antigo = clientes.get(doc) || {};
  clientes.set(doc, {
    ...antigo,
    documento: doc,
    nome: unesc(pick(dest, 'xNome')),
    ie: pick(dest, 'IE'),
    contribuinte: pick(dest, 'indIEDest') === '1' ? 1 : 0,
    email: unesc(pick(dest, 'email')) || antigo.email || '',
    telefone: pick(end, 'fone') || antigo.telefone || '',
    cep: pick(end, 'CEP'),
    logradouro: unesc(pick(end, 'xLgr')),
    numero: unesc(pick(end, 'nro')),
    complemento: unesc(pick(end, 'xCpl')),
    bairro: unesc(pick(end, 'xBairro')),
    municipio: unesc(pick(end, 'xMun')),
    cod_municipio: pick(end, 'cMun'),
    uf: pick(end, 'UF')
  });
}

const out = {
  gerado_em: new Date().toISOString(),
  origem: 'C&K',
  clientes: [...clientes.values()],
  produtos,
  notas: ordenadas,
  canceladas: [...canceladas]
};
fs.writeFileSync(saida, JSON.stringify(out));
fs.rmSync(tmpDb, { force: true });
console.log(
  `Pronto: ${out.clientes.length} clientes, ${out.produtos.length} produtos, ${out.notas.length} notas (${out.canceladas.length} canceladas).\n` +
    `Arquivo: ${saida} (${(fs.statSync(saida).size / 1024 / 1024).toFixed(1)} MB)`
);
