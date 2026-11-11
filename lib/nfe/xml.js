// Monta e assina os XMLs da NF-e modelo 55, layout 4.00, no formato que a
// SEFAZ RS já aceita das notas da Classul emitidas pelo C&K (mesmos grupos de imposto
// do Simples Nacional: CSOSN 102/101, IPI não tributado 53, PIS/COFINS CST 08).
import crypto from 'crypto';
import { SignedXml } from 'xml-crypto';
import { corrigirEmail, ieDeVerdade } from './cadastro.js';

export const NS = 'http://www.portalfiscal.inf.br/nfe';
export const VER_PROC = 'Classul 1.0';
export const HOMOLOG_NOME = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export const CONDICAO_USO_CCE =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

const UF_CODES = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25,
  PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50,
  MT: 51, GO: 52, DF: 53
};
export const UFS = Object.keys(UF_CODES);
export const ufCode = (uf) => UF_CODES[String(uf || '').toUpperCase()];

export class NfeDataError extends Error {}

// ------------------------------------------------------------------ texto

// O XSD da NF-e só aceita caracteres até U+00FF, sem espaço no começo/fim e sem quebra
// de linha. Troca o que dá (aspas curvas, travessões) e remove o resto.
export function clean(value, max) {
  let s = String(value ?? '')
    .normalize('NFC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (max && s.length > max) s = s.slice(0, max).trim();
  return s;
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Padrão da Classul: todo texto em maiúsculas (menos e-mail).
export const caixaAlta = (value, max) => clean(value, max).toLocaleUpperCase('pt-BR');

// <tag>valor</tag>, ou nada quando o valor é vazio e o campo é opcional.
// Texto sai em maiúsculas; manterCaixa só para o e-mail.
function tag(name, value, { optional = false, max, manterCaixa = false } = {}) {
  const v = typeof value === 'number' ? String(value) : manterCaixa ? clean(value, max) : caixaAlta(value, max);
  if (v === '' && optional) return '';
  return `<${name}>${esc(v)}</${name}>`;
}

export const digits = (s) => String(s ?? '').replace(/\D/g, '');
export const dec = (n, places = 2) => (Math.round((Number(n) || 0) * 10 ** places) / 10 ** places).toFixed(places);
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Data/hora no fuso de Brasília (sem horário de verão desde 2019) no formato da NF-e.
export function dhBrasil(date = new Date()) {
  const local = new Date(date.getTime() - 3 * 3600 * 1000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

// ------------------------------------------------------------------ chave de acesso

export function mod11(numbers) {
  let weight = 2;
  let sum = 0;
  for (let i = numbers.length - 1; i >= 0; i--) {
    sum += Number(numbers[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv >= 10 ? 0 : dv;
}

export function buildChave({ cUF, dataEmissao, cnpj, mod = 55, serie, numero, tpEmis = 1, cNF }) {
  const aamm = dhBrasil(dataEmissao).slice(2, 7).replace('-', '');
  const base =
    String(cUF).padStart(2, '0') +
    aamm +
    digits(cnpj).padStart(14, '0') +
    String(mod).padStart(2, '0') +
    String(serie).padStart(3, '0') +
    String(numero).padStart(9, '0') +
    String(tpEmis) +
    String(cNF).padStart(8, '0');
  return { chave: base + mod11(base), cDV: mod11(base) };
}

// Código numérico aleatório da chave: 8 dígitos, diferente do número da nota.
export function randomCNF(numero) {
  let c;
  do c = String(crypto.randomInt(10000000, 99999999));
  while (c === String(numero).padStart(8, '0'));
  return c;
}

// ------------------------------------------------------------------ NF-e

// Calcula totais e valida o essencial antes de montar o XML (erros em português,
// para a tela mostrar sem precisar ir até a SEFAZ).
export function prepareItems(itens) {
  if (!Array.isArray(itens) || !itens.length) throw new NfeDataError('Adicione pelo menos um produto.');
  if (itens.length > 990) throw new NfeDataError('Máximo de 990 itens por nota.');
  return itens.map((it, i) => {
    const n = i + 1;
    const qtd = Number(it.quantidade);
    const unit = Number(it.valor_unitario);
    if (!clean(it.descricao)) throw new NfeDataError(`Item ${n}: falta a descrição.`);
    if (!(qtd > 0)) throw new NfeDataError(`Item ${n}: quantidade inválida.`);
    if (!(unit > 0)) throw new NfeDataError(`Item ${n}: valor unitário inválido.`);
    const ncm = digits(it.ncm);
    if (ncm.length !== 8) throw new NfeDataError(`Item ${n} (${clean(it.descricao, 40)}): NCM precisa ter 8 dígitos.`);
    const cfop = digits(it.cfop);
    if (!/^[5-7]\d{3}$/.test(cfop)) throw new NfeDataError(`Item ${n}: CFOP inválido.`);
    const bruto = round2(qtd * unit);
    const desconto = round2(it.desconto || 0);
    if (desconto < 0 || desconto >= bruto) throw new NfeDataError(`Item ${n}: desconto inválido.`);
    const liquido = round2(bruto - desconto);
    const aliqTrib = Number(it.aliq_tributos || 0);
    return {
      codigo: caixaAlta(it.codigo || String(n), 60) || String(n),
      descricao: caixaAlta(it.descricao, 120),
      ncm,
      cest: digits(it.cest).length === 7 && digits(it.cest) !== '0000000' ? digits(it.cest) : '',
      cfop,
      unidade: caixaAlta(it.unidade || 'UND', 6) || 'UND',
      quantidade: qtd,
      valor_unitario: unit,
      valor_bruto: bruto,
      desconto,
      origem: String(it.origem ?? '0'),
      csosn: String(it.csosn || '102'),
      info_adicional: caixaAlta(it.info_adicional, 500),
      aliq_tributos: aliqTrib,
      // Lei 12.741 (valor aproximado dos tributos): % sobre o valor líquido do item.
      valor_tributos: round2((liquido * aliqTrib) / 100)
    };
  });
}

export function totals(itens, { frete = 0 } = {}) {
  const vProd = round2(itens.reduce((s, i) => s + i.valor_bruto, 0));
  const vDesc = round2(itens.reduce((s, i) => s + i.desconto, 0));
  const vTotTrib = round2(itens.reduce((s, i) => s + i.valor_tributos, 0));
  const vFrete = round2(frete);
  return { vProd, vDesc, vFrete, vTotTrib, vNF: round2(vProd - vDesc + vFrete) };
}

// Divide o frete entre os itens proporcionalmente (a soma tem que bater no total).
function rateioFrete(itens, frete) {
  if (!frete) return itens.map(() => 0);
  const base = itens.reduce((s, i) => s + i.valor_bruto, 0);
  let resto = round2(frete);
  return itens.map((it, idx) => {
    if (idx === itens.length - 1) return round2(resto);
    const parte = round2((frete * it.valor_bruto) / base);
    resto = round2(resto - parte);
    return parte;
  });
}

function enderecoXml(tagName, e, { comPais = true } = {}) {
  return (
    `<${tagName}>` +
    tag('xLgr', e.logradouro, { max: 60 }) +
    tag('nro', e.numero || 'S/N', { max: 60 }) +
    tag('xCpl', e.complemento, { optional: true, max: 60 }) +
    tag('xBairro', e.bairro, { max: 60 }) +
    tag('cMun', digits(e.cod_municipio)) +
    tag('xMun', e.municipio, { max: 60 }) +
    tag('UF', String(e.uf || '').toUpperCase()) +
    tag('CEP', digits(e.cep), { optional: true }) +
    (comPais ? '<cPais>1058</cPais><xPais>Brasil</xPais>' : '') +
    // O XSD aceita telefone de 6 a 14 dígitos; fora disso, omite em vez de rejeitar a nota.
    (/^\d{6,14}$/.test(digits(e.telefone)) ? `<fone>${digits(e.telefone)}</fone>` : '') +
    `</${tagName}>`
  );
}

function validarEndereco(quem, e) {
  if (!clean(e.logradouro)) throw new NfeDataError(`${quem}: falta o endereço.`);
  if (!clean(e.bairro)) throw new NfeDataError(`${quem}: falta o bairro.`);
  if (digits(e.cod_municipio).length !== 7) throw new NfeDataError(`${quem}: falta o código IBGE da cidade (preencha pelo CEP).`);
  if (!clean(e.municipio)) throw new NfeDataError(`${quem}: falta a cidade.`);
  if (!ufCode(e.uf)) throw new NfeDataError(`${quem}: UF inválida.`);
  if (e.cep && digits(e.cep).length !== 8) throw new NfeDataError(`${quem}: CEP inválido.`);
}

export function validarDocumento(doc) {
  const d = digits(doc);
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (len) => {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
      const r = (sum * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (len) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = w.reduce((s, wi, i) => s + wi * Number(d[i]), 0);
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

/**
 * Monta o XML <NFe> (ainda sem assinatura).
 * nota = { ambiente, serie, numero, dataEmissao, cNF, natOp, emit, dest, itens (já preparados),
 *          frete, pagamento: { tPag, valor }, infCpl, contingencia? }
 */
export function buildNFe(nota) {
  const { emit, dest } = nota;
  const ambiente = Number(nota.ambiente) === 1 ? 1 : 2;
  const cUF = ufCode(emit.uf);
  if (!cUF) throw new NfeDataError('UF do emitente inválida.');
  validarEndereco('Emitente', emit);
  if (!validarDocumento(emit.cnpj)) throw new NfeDataError('CNPJ do emitente inválido.');

  const docDest = digits(dest.documento);
  if (!validarDocumento(docDest)) throw new NfeDataError('CPF/CNPJ do cliente inválido.');
  if (!clean(dest.nome)) throw new NfeDataError('Falta o nome do cliente.');
  validarEndereco('Cliente', dest);

  const ufDest = String(dest.uf).toUpperCase();
  const idDest = ufDest === String(emit.uf).toUpperCase() ? 1 : 2;
  // 1 = contribuinte com IE; 2 = isento de IE; 9 = não contribuinte (o padrão da Classul).
  // CPF é sempre 9.
  const ie = ieDeVerdade(dest.ie);
  const situacaoIE = Number(dest.contribuinte || 0);
  const indIEDest = docDest.length !== 14 ? 9 : situacaoIE === 1 && ie ? 1 : situacaoIE === 2 ? 2 : 9;

  const itens = nota.itens;
  for (const it of itens) {
    if ((idDest === 1 && it.cfop[0] !== '5') || (idDest === 2 && it.cfop[0] !== '6')) {
      throw new NfeDataError(
        `O CFOP ${it.cfop} de "${it.descricao}" não combina com cliente ${idDest === 1 ? 'do mesmo estado (use 5xxx)' : 'de outro estado (use 6xxx)'}.`
      );
    }
  }
  const tot = totals(itens, { frete: nota.frete });
  const fretes = rateioFrete(itens, tot.vFrete);
  const tpEmis = nota.contingencia ? Number(nota.contingencia.tpEmis) : 1;

  const { chave, cDV } = buildChave({
    cUF, dataEmissao: nota.dataEmissao, cnpj: emit.cnpj, serie: nota.serie, numero: nota.numero, tpEmis, cNF: nota.cNF
  });
  const dh = dhBrasil(nota.dataEmissao);

  const ide =
    '<ide>' +
    `<cUF>${cUF}</cUF><cNF>${nota.cNF}</cNF>` +
    tag('natOp', nota.natOp || (idDest === 1 ? 'VENDA DENTRO DO ESTADO' : 'VENDA FORA DO ESTADO'), { max: 60 }) +
    `<mod>55</mod><serie>${Number(nota.serie)}</serie><nNF>${Number(nota.numero)}</nNF>` +
    `<dhEmi>${dh}</dhEmi><dhSaiEnt>${dh}</dhSaiEnt><tpNF>1</tpNF><idDest>${idDest}</idDest>` +
    `<cMunFG>${digits(emit.cod_municipio)}</cMunFG><tpImp>1</tpImp><tpEmis>${tpEmis}</tpEmis><cDV>${cDV}</cDV>` +
    `<tpAmb>${ambiente}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres>` +
    `<procEmi>0</procEmi><verProc>${VER_PROC}</verProc>` +
    (nota.contingencia
      ? `<dhCont>${dhBrasil(new Date(nota.contingencia.desde))}</dhCont>` + tag('xJust', nota.contingencia.justificativa, { max: 256 })
      : '') +
    '</ide>';

  const emitXml =
    '<emit>' +
    tag('CNPJ', digits(emit.cnpj)) +
    tag('xNome', emit.razao_social, { max: 60 }) +
    tag('xFant', emit.nome_fantasia, { optional: true, max: 60 }) +
    enderecoXml('enderEmit', emit) +
    tag('IE', digits(emit.ie)) +
    '<CRT>1</CRT>' +
    '</emit>';

  const destXml =
    '<dest>' +
    (docDest.length === 14 ? tag('CNPJ', docDest) : tag('CPF', docDest)) +
    tag('xNome', ambiente === 2 ? HOMOLOG_NOME : dest.nome, { max: 60 }) +
    enderecoXml('enderDest', dest) +
    `<indIEDest>${indIEDest}</indIEDest>` +
    (indIEDest === 1 ? tag('IE', ie) : '') +
    tag('email', corrigirEmail(dest.email), { optional: true, max: 60, manterCaixa: true }) +
    '</dest>';

  const det = itens
    .map((it, i) => {
      const icms =
        it.csosn === '101'
          ? // 101 exige alíquota/valor do crédito; sem esses dados, a tela só oferece 102.
            `<ICMSSN101><orig>${it.origem}</orig><CSOSN>101</CSOSN><pCredSN>${dec(it.p_cred_sn || 0, 4)}</pCredSN><vCredICMSSN>${dec(((it.valor_bruto - it.desconto) * (it.p_cred_sn || 0)) / 100)}</vCredICMSSN></ICMSSN101>`
          : `<ICMSSN102><orig>${it.origem}</orig><CSOSN>${it.csosn === '103' || it.csosn === '300' || it.csosn === '400' ? it.csosn : '102'}</CSOSN></ICMSSN102>`;
      return (
        `<det nItem="${i + 1}"><prod>` +
        tag('cProd', it.codigo, { max: 60 }) +
        '<cEAN>SEM GTIN</cEAN>' +
        tag('xProd', it.descricao, { max: 120 }) +
        `<NCM>${it.ncm}</NCM>` +
        (it.cest ? `<CEST>${it.cest}</CEST>` : '') +
        `<CFOP>${it.cfop}</CFOP>` +
        tag('uCom', it.unidade) +
        `<qCom>${dec(it.quantidade, 4)}</qCom><vUnCom>${dec(it.valor_unitario, 4)}</vUnCom><vProd>${dec(it.valor_bruto)}</vProd>` +
        '<cEANTrib>SEM GTIN</cEANTrib>' +
        tag('uTrib', it.unidade) +
        `<qTrib>${dec(it.quantidade, 4)}</qTrib><vUnTrib>${dec(it.valor_unitario, 4)}</vUnTrib>` +
        (fretes[i] ? `<vFrete>${dec(fretes[i])}</vFrete>` : '') +
        (it.desconto ? `<vDesc>${dec(it.desconto)}</vDesc>` : '') +
        '<indTot>1</indTot></prod>' +
        `<imposto><vTotTrib>${dec(it.valor_tributos)}</vTotTrib>` +
        `<ICMS>${icms}</ICMS>` +
        '<IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>' +
        '<PIS><PISNT><CST>08</CST></PISNT></PIS><COFINS><COFINSNT><CST>08</CST></COFINSNT></COFINS>' +
        '</imposto>' +
        tag('infAdProd', it.info_adicional, { optional: true, max: 500 }) +
        '</det>'
      );
    })
    .join('');

  const zero = '0.00';
  const total =
    '<total><ICMSTot>' +
    `<vBC>${zero}</vBC><vICMS>${zero}</vICMS><vICMSDeson>${zero}</vICMSDeson>` +
    // Venda para outro estado: os totais do ICMS do destino (DIFAL) vão zerados, como nas 63
    // notas interestaduais do C&K autorizadas. No Simples Nacional não há DIFAL a recolher
    // para consumidor final (cláusula nona do Convênio 93/2015 suspensa pelo STF, ADI 5464).
    (idDest === 2 ? `<vFCPUFDest>${zero}</vFCPUFDest><vICMSUFDest>${zero}</vICMSUFDest><vICMSUFRemet>${zero}</vICMSUFRemet>` : '') +
    `<vFCP>${zero}</vFCP>` +
    `<vBCST>${zero}</vBCST><vST>${zero}</vST><vFCPST>${zero}</vFCPST><vFCPSTRet>${zero}</vFCPSTRet>` +
    `<vProd>${dec(tot.vProd)}</vProd><vFrete>${dec(tot.vFrete)}</vFrete><vSeg>${zero}</vSeg><vDesc>${dec(tot.vDesc)}</vDesc>` +
    `<vII>${zero}</vII><vIPI>${zero}</vIPI><vIPIDevol>${zero}</vIPIDevol><vPIS>${zero}</vPIS><vCOFINS>${zero}</vCOFINS>` +
    `<vOutro>${zero}</vOutro><vNF>${dec(tot.vNF)}</vNF><vTotTrib>${dec(tot.vTotTrib)}</vTotTrib>` +
    '</ICMSTot></total>';

  // 0 = frete por conta do emitente; 9 = sem frete (o padrão da Classul).
  const transp = `<transp><modFrete>${tot.vFrete ? 0 : 9}</modFrete></transp>`;

  const tPag = String(nota.pagamento?.tPag || '17').padStart(2, '0');
  const semPagamento = tPag === '90';
  const pag =
    '<pag><detPag>' +
    `<tPag>${tPag}</tPag>` +
    (tPag === '99' ? tag('xPag', nota.pagamento?.descricao || 'Outros', { max: 60 }) : '') +
    `<vPag>${semPagamento ? zero : dec(tot.vNF)}</vPag>` +
    '</detPag></pag>';

  const infAdic = clean(nota.infCpl) ? `<infAdic>${tag('infCpl', nota.infCpl, { max: 5000 })}</infAdic>` : '';

  const xml =
    `<NFe xmlns="${NS}"><infNFe versao="4.00" Id="NFe${chave}">` +
    ide + emitXml + destXml + det + total + transp + pag + infAdic +
    '</infNFe></NFe>';
  return { xml, chave, totais: tot, idDest, indIEDest, dhEmi: dh };
}

// ------------------------------------------------------------------ assinatura

// Assina o elemento com Id (infNFe, infEvento ou infInut) no padrão da NF-e:
// RSA-SHA1, C14N, referência ao Id e o certificado em X509Data.
export function sign(xml, elementName, cert) {
  const sig = new SignedXml({
    privateKey: cert.keyPem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    getKeyInfoContent: () => `<X509Data><X509Certificate>${cert.certB64}</X509Certificate></X509Data>`
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${elementName}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
  });
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='${elementName}']`, action: 'after' } });
  return sig.getSignedXml();
}

// ------------------------------------------------------------------ eventos e inutilização

export function buildEvento({ ambiente, cnpj, chave, tpEvento, seq = 1, detalhe }) {
  const cOrgao = chave.slice(0, 2);
  const id = `ID${tpEvento}${chave}${String(seq).padStart(2, '0')}`;
  return (
    `<evento xmlns="${NS}" versao="1.00"><infEvento Id="${id}">` +
    `<cOrgao>${cOrgao}</cOrgao><tpAmb>${ambiente}</tpAmb><CNPJ>${digits(cnpj)}</CNPJ><chNFe>${chave}</chNFe>` +
    `<dhEvento>${dhBrasil()}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${seq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento><detEvento versao="1.00">${detalhe}</detEvento>` +
    '</infEvento></evento>'
  );
}

export function detalheCancelamento(nProt, justificativa) {
  const j = clean(justificativa, 255);
  if (j.length < 15) throw new NfeDataError('A justificativa precisa ter pelo menos 15 letras.');
  return `<descEvento>Cancelamento</descEvento><nProt>${digits(nProt)}</nProt>${tag('xJust', j)}`;
}

export function detalheCCe(correcao) {
  const c = clean(correcao, 1000);
  if (c.length < 15) throw new NfeDataError('A correção precisa ter pelo menos 15 letras.');
  return `<descEvento>Carta de Correcao</descEvento>${tag('xCorrecao', c)}<xCondUso>${CONDICAO_USO_CCE}</xCondUso>`;
}

export function buildInutilizacao({ ambiente, cnpj, uf, serie, inicio, fim, justificativa, ano }) {
  const j = clean(justificativa, 255);
  if (j.length < 15) throw new NfeDataError('A justificativa precisa ter pelo menos 15 letras.');
  const ini = Number(inicio);
  const fin = Number(fim);
  if (!(ini > 0) || !(fin >= ini)) throw new NfeDataError('Faixa de números inválida.');
  const cUF = ufCode(uf);
  const aa = String(ano ?? dhBrasil().slice(2, 4)).padStart(2, '0');
  const id =
    `ID${cUF}${aa}${digits(cnpj)}55${String(serie).padStart(3, '0')}` +
    `${String(ini).padStart(9, '0')}${String(fin).padStart(9, '0')}`;
  return (
    `<inutNFe xmlns="${NS}" versao="4.00"><infInut Id="${id}">` +
    `<tpAmb>${ambiente}</tpAmb><xServ>INUTILIZAR</xServ><cUF>${cUF}</cUF><ano>${aa}</ano>` +
    `<CNPJ>${digits(cnpj)}</CNPJ><mod>55</mod><serie>${Number(serie)}</serie>` +
    `<nNFIni>${ini}</nNFIni><nNFFin>${fin}</nNFFin>${tag('xJust', j)}` +
    '</infInut></inutNFe>'
  );
}
