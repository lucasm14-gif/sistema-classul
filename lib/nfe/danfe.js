// DANFE (PDF da NF-e) no modelo retrato do Manual de Orientação do Contribuinte.
// Gera a partir do XML autorizado (nfeProc), então serve também para as notas
// importadas do C&K.
import PDFDocument from 'pdfkit';
import { pick, pickBlock } from './sefaz.js';

// ------------------------------------------------------------------ código de barras (Code 128C)

const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

// Larguras (em módulos) de barras e espaços alternados, começando por barra.
export function code128C(numeric) {
  const digitsOnly = String(numeric).replace(/\D/g, '');
  if (digitsOnly.length % 2) throw new Error('Code 128C precisa de quantidade par de dígitos.');
  const values = [105];
  for (let i = 0; i < digitsOnly.length; i += 2) values.push(Number(digitsOnly.slice(i, i + 2)));
  const check = values.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0) % 103;
  values.push(check, 106);
  return values.flatMap((v) => C128[v].split('').map(Number));
}

function drawBarcode(doc, x, y, w, h, numeric) {
  const widths = code128C(numeric);
  const modules = widths.reduce((a, b) => a + b, 0);
  const unit = w / modules;
  let cx = x;
  widths.forEach((wd, i) => {
    if (i % 2 === 0) doc.rect(cx, y, wd * unit, h).fill('#000');
    cx += wd * unit;
  });
}

// ------------------------------------------------------------------ helpers

const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const unesc = (s) =>
  String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const g = (xml, name) => unesc(pick(xml, name));
const fmtChave = (c) => String(c).replace(/(\d{4})(?=\d)/g, '$1 ');
const fmtDoc = (d) => {
  const s = String(d || '');
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return s;
};
const fmtCep = (c) => String(c || '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
const fmtNum = (n) => String(n).padStart(9, '0').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3');
function fmtDh(dh) {
  if (!dh) return { data: '', hora: '' };
  const [d, t] = dh.split('T');
  const [y, m, day] = d.split('-');
  return { data: `${day}/${m}/${y}`, hora: (t || '').slice(0, 8) };
}

const PAG = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja',
  '10': 'Vale alimentação', '11': 'Vale refeição', '12': 'Vale presente', '13': 'Vale combustível',
  '15': 'Boleto bancário', '16': 'Depósito bancário', '17': 'PIX', '18': 'Transferência bancária, carteira digital',
  '19': 'Programa de fidelidade', '20': 'PIX estático', '90': 'Sem pagamento', '99': 'Outros'
};
const FRETE = {
  0: '0-Emitente', 1: '1-Destinatário', 2: '2-Terceiros', 3: '3-Próprio rem.', 4: '4-Próprio dest.', 9: '9-Sem frete'
};

// ------------------------------------------------------------------ desenho

// logo: { mime, base64 } (JPG ou PNG) — o carimbo que aparece no quadro do emitente.
export function gerarDanfe(xmlProc, { cancelada = false, logo = null } = {}) {
  const inf = pickBlock(xmlProc, 'infNFe');
  const ide = pickBlock(inf, 'ide');
  const emit = pickBlock(inf, 'emit');
  const enderEmit = pickBlock(emit, 'enderEmit');
  const dest = pickBlock(inf, 'dest');
  const enderDest = pickBlock(dest, 'enderDest');
  const tot = pickBlock(inf, 'ICMSTot');
  const prot = pickBlock(xmlProc, 'infProt');
  const chave = (inf.match(/Id="NFe(\d{44})"/) || [])[1] || '';
  const ambiente = g(ide, 'tpAmb');
  const dets = [...inf.matchAll(/<det nItem="\d+">[\s\S]*?<\/det>/g)].map((m) => m[0]);
  const pags = [...inf.matchAll(/<detPag>[\s\S]*?<\/detPag>/g)].map((m) => m[0]);

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `NF-e ${g(ide, 'nNF')}`, Author: g(emit, 'xNome') } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const M = 20; // margem
  const W = 595.28 - 2 * M;
  const line = 0.6;

  // Caixa com rótulo pequeno em cima e valor embaixo.
  function box(x, y, w, h, label, value, { align = 'left', size = 8, bold = false } = {}) {
    doc.lineWidth(line).rect(x, y, w, h).stroke('#000');
    doc.font('Helvetica').fontSize(5.5).fillColor('#000').text(label.toUpperCase(), x + 2, y + 1.5, { width: w - 4, lineBreak: false });
    if (value !== undefined && value !== null && value !== '') {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
        .text(String(value), x + 2, y + h - size - 3, { width: w - 4, align, lineBreak: false, ellipsis: true });
    }
  }
  function sectionTitle(y, text) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#000').text(text.toUpperCase(), M, y, { lineBreak: false });
    return y + 8;
  }

  const nNF = g(ide, 'nNF');
  const serie = g(ide, 'serie');
  const emissao = fmtDh(g(ide, 'dhEmi'));
  const saida = fmtDh(g(ide, 'dhSaiEnt'));

  function cabecalho(pageNo, pages) {
    let y = M;
    // Canhoto (só na primeira folha).
    if (pageNo === 1) {
      doc.lineWidth(line).rect(M, y, W - 90, 22).stroke();
      doc.font('Helvetica').fontSize(6).text(
        `RECEBEMOS DE ${g(emit, 'xNome')} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,
        M + 2, y + 2, { width: W - 94 }
      );
      box(M, y + 22, 110, 22, 'Data de recebimento');
      box(M + 110, y + 22, W - 200, 22, 'Identificação e assinatura do recebedor');
      doc.rect(M + W - 90, y, 90, 44).stroke();
      doc.font('Helvetica-Bold').fontSize(11).text('NF-e', M + W - 90, y + 4, { width: 90, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8).text(`Nº ${fmtNum(nNF)}`, M + W - 90, y + 19, { width: 90, align: 'center' });
      doc.text(`SÉRIE ${serie}`, M + W - 90, y + 30, { width: 90, align: 'center' });
      doc.moveTo(M, y + 50).lineTo(M + W, y + 50).dash(2, { space: 2 }).stroke().undash();
      y += 56;
    }

    // Emitente | DANFE | chave
    const hH = 92;
    const wEmit = 230;
    const wDanfe = 95;
    const wChave = W - wEmit - wDanfe;
    doc.rect(M, y, wEmit, hH).stroke();
    // Com logo: carimbo à esquerda e os dados à direita (como no DANFE do C&K).
    let tx = M + 6;
    let tw = wEmit - 12;
    if (logo?.base64) {
      try {
        const img = Buffer.from(logo.base64, 'base64');
        doc.image(img, M + 5, y + 6, { fit: [68, hH - 12], align: 'center', valign: 'center' });
        tx = M + 78;
        tw = wEmit - 82;
      } catch {
        // imagem inválida: segue sem logo
      }
    }
    doc.font('Helvetica-Bold').fontSize(logo?.base64 ? 8.5 : 9);
    const alturaNome = doc.heightOfString(g(emit, 'xNome'), { width: tw, align: 'center' });
    doc.text(g(emit, 'xNome'), tx, y + 8, { width: tw, align: 'center' });
    const yEnd = y + 8 + alturaNome + 5;
    doc.font('Helvetica').fontSize(7.5).text(
      [
        `${g(enderEmit, 'xLgr')}, ${g(enderEmit, 'nro')}${g(enderEmit, 'xCpl') ? ' ' + g(enderEmit, 'xCpl') : ''}`,
        `${g(enderEmit, 'xBairro')} - CEP ${fmtCep(g(enderEmit, 'CEP'))}`,
        `${g(enderEmit, 'xMun')} - ${g(enderEmit, 'UF')}`,
        g(enderEmit, 'fone') ? `Fone: ${g(enderEmit, 'fone')}` : ''
      ].filter(Boolean).join('\n'),
      tx, Math.max(yEnd, y + 30), { width: tw, align: 'center' }
    );

    const xD = M + wEmit;
    doc.rect(xD, y, wDanfe, hH).stroke();
    doc.font('Helvetica-Bold').fontSize(12).text('DANFE', xD, y + 4, { width: wDanfe, align: 'center' });
    doc.font('Helvetica').fontSize(6.5).text('Documento Auxiliar da\nNota Fiscal Eletrônica', xD, y + 18, { width: wDanfe, align: 'center' });
    doc.fontSize(7).text('0 - ENTRADA\n1 - SAÍDA', xD + 8, y + 38);
    doc.rect(xD + 62, y + 38, 18, 16).stroke();
    doc.font('Helvetica-Bold').fontSize(11).text(g(ide, 'tpNF'), xD + 62, y + 41, { width: 18, align: 'center' });
    doc.fontSize(8).text(`Nº ${fmtNum(nNF)}`, xD, y + 60, { width: wDanfe, align: 'center' });
    doc.text(`SÉRIE ${serie}`, xD, y + 70, { width: wDanfe, align: 'center' });
    doc.font('Helvetica').fontSize(7).text(`FOLHA ${pageNo}/${pages}`, xD, y + 80, { width: wDanfe, align: 'center' });

    const xC = xD + wDanfe;
    doc.rect(xC, y, wChave, hH).stroke();
    if (chave) drawBarcode(doc, xC + 8, y + 5, wChave - 16, 30, chave);
    box(xC, y + 40, wChave, 20, 'Chave de acesso', fmtChave(chave), { align: 'center', bold: true, size: 7.5 });
    doc.font('Helvetica').fontSize(7).text(
      'Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora',
      xC + 4, y + 64, { width: wChave - 8, align: 'center' }
    );
    y += hH;

    box(M, y, wEmit + wDanfe, 20, 'Natureza da operação', g(ide, 'natOp'));
    const protTxt = prot ? `${g(prot, 'nProt')} - ${fmtDh(g(prot, 'dhRecbto')).data} ${fmtDh(g(prot, 'dhRecbto')).hora}` : '';
    box(xC, y, wChave, 20, 'Protocolo de autorização de uso', protTxt, { align: 'center' });
    y += 20;
    const w3 = W / 3;
    box(M, y, w3, 20, 'Inscrição estadual', g(emit, 'IE'));
    box(M + w3, y, w3, 20, 'Inscr. estadual do subst. tributário', g(emit, 'IEST'));
    box(M + 2 * w3, y, w3, 20, 'CNPJ', fmtDoc(g(emit, 'CNPJ')));
    return y + 24;
  }

  function destinatario(y) {
    y = sectionTitle(y, 'Destinatário / remetente');
    const docDest = g(dest, 'CNPJ') || g(dest, 'CPF');
    box(M, y, W - 190, 20, 'Nome / razão social', g(dest, 'xNome'));
    box(M + W - 190, y, 110, 20, 'CNPJ / CPF', fmtDoc(docDest));
    box(M + W - 80, y, 80, 20, 'Data da emissão', emissao.data, { align: 'center' });
    y += 20;
    box(M, y, W - 290, 20, 'Endereço', `${g(enderDest, 'xLgr')}, ${g(enderDest, 'nro')}${g(enderDest, 'xCpl') ? ' ' + g(enderDest, 'xCpl') : ''}`);
    box(M + W - 290, y, 140, 20, 'Bairro / distrito', g(enderDest, 'xBairro'));
    box(M + W - 150, y, 70, 20, 'CEP', fmtCep(g(enderDest, 'CEP')), { align: 'center' });
    box(M + W - 80, y, 80, 20, 'Data da saída', saida.data, { align: 'center' });
    y += 20;
    box(M, y, W - 330, 20, 'Município', g(enderDest, 'xMun'));
    box(M + W - 330, y, 110, 20, 'Fone / fax', g(enderDest, 'fone'));
    box(M + W - 220, y, 30, 20, 'UF', g(enderDest, 'UF'), { align: 'center' });
    box(M + W - 190, y, 110, 20, 'Inscrição estadual', g(dest, 'IE'));
    box(M + W - 80, y, 80, 20, 'Hora da saída', saida.hora, { align: 'center' });
    y += 24;

    y = sectionTitle(y, 'Pagamento');
    const pagTxt = pags.map((p) => `${PAG[g(p, 'tPag')] || g(p, 'xPag') || g(p, 'tPag')}: R$ ${brl(g(p, 'vPag'))}`).join('   ·   ');
    box(M, y, W, 16, '', pagTxt);
    y += 20;

    y = sectionTitle(y, 'Cálculo do imposto');
    const c = W / 6;
    const linha1 = [
      ['Base de cálc. do ICMS', 'vBC'], ['Valor do ICMS', 'vICMS'], ['Base de cálc. ICMS ST', 'vBCST'],
      ['Valor do ICMS ST', 'vST'], ['Valor aprox. tributos', 'vTotTrib'], ['Valor total dos produtos', 'vProd']
    ];
    linha1.forEach(([l, k], i) => box(M + i * c, y, c, 20, l, brl(g(tot, k)), { align: 'right' }));
    y += 20;
    const linha2 = [
      ['Valor do frete', 'vFrete'], ['Valor do seguro', 'vSeg'], ['Desconto', 'vDesc'],
      ['Outras despesas', 'vOutro'], ['Valor do IPI', 'vIPI'], ['Valor total da nota', 'vNF']
    ];
    linha2.forEach(([l, k], i) => box(M + i * c, y, c, 20, l, brl(g(tot, k)), { align: 'right', bold: k === 'vNF' }));
    y += 24;

    y = sectionTitle(y, 'Transportador / volumes transportados');
    const transp = pickBlock(inf, 'transp');
    box(M, y, W - 200, 20, 'Razão social', g(transp, 'xNome'));
    box(M + W - 200, y, 90, 20, 'Frete por conta', FRETE[g(transp, 'modFrete')] || g(transp, 'modFrete'));
    box(M + W - 110, y, 110, 20, 'CNPJ / CPF', fmtDoc(g(transp, 'CNPJ') || g(transp, 'CPF')));
    return y + 24;
  }

  const cols = [
    ['Código', 46, 'left'], ['Descrição do produto / serviço', 170, 'left'], ['NCM', 40, 'center'],
    ['CSOSN', 28, 'center'], ['CFOP', 26, 'center'], ['Un', 22, 'center'], ['Qtde', 40, 'right'],
    ['Vlr. unit.', 50, 'right'], ['Vlr. total', 50, 'right'], ['Desc.', 34, 'right'], ['Vlr. ICMS', 49.28, 'right']
  ];

  function tabelaCabecalho(y) {
    y = sectionTitle(y, 'Dados dos produtos / serviços');
    let x = M;
    doc.lineWidth(line);
    for (const [l, w] of cols) {
      doc.rect(x, y, w, 14).stroke();
      doc.font('Helvetica-Bold').fontSize(5.5).text(l.toUpperCase(), x + 1, y + 4, { width: w - 2, align: 'center', lineBreak: false });
      x += w;
    }
    return y + 14;
  }

  function linhaItem(y, det) {
    const prod = pickBlock(det, 'prod');
    const icms = pickBlock(det, 'ICMS');
    const desc = g(prod, 'xProd') + (g(det, 'infAdProd') ? ` - ${g(det, 'infAdProd')}` : '');
    const values = [
      g(prod, 'cProd'), desc, g(prod, 'NCM'), `${g(icms, 'orig')}${g(icms, 'CSOSN') || g(icms, 'CST')}`, g(prod, 'CFOP'),
      g(prod, 'uCom'), qtd(g(prod, 'qCom')), brl(g(prod, 'vUnCom')), brl(g(prod, 'vProd')), brl(g(prod, 'vDesc')), brl(g(icms, 'vICMS'))
    ];
    doc.font('Helvetica').fontSize(6.5);
    const h = Math.max(12, doc.heightOfString(desc, { width: cols[1][1] - 4 }) + 4);
    let x = M;
    cols.forEach(([, w, align], i) => {
      doc.rect(x, y, w, h).stroke();
      doc.text(values[i], x + 2, y + 3, { width: w - 4, align, lineBreak: i === 1 });
      x += w;
    });
    return y + h;
  }

  function dadosAdicionais(y) {
    y = sectionTitle(y, 'Dados adicionais');
    const infCpl = g(inf, 'infCpl');
    const h = 70;
    doc.rect(M, y, W * 0.65, h).stroke();
    doc.font('Helvetica').fontSize(5.5).text('INFORMAÇÕES COMPLEMENTARES', M + 2, y + 1.5);
    doc.fontSize(7).text(infCpl, M + 3, y + 10, { width: W * 0.65 - 6, height: h - 12 });
    doc.rect(M + W * 0.65, y, W * 0.35, h).stroke();
    doc.fontSize(5.5).text('RESERVADO AO FISCO', M + W * 0.65 + 2, y + 1.5);
    return y + h;
  }

  function marcaDagua() {
    const textos = [];
    if (ambiente === '2') textos.push('SEM VALOR FISCAL');
    if (cancelada) textos.push('NF-e CANCELADA');
    if (!prot) textos.push('SEM AUTORIZAÇÃO');
    textos.forEach((t, i) => {
      doc.save();
      doc.rotate(-35, { origin: [297, 520 + i * 70] });
      doc.font('Helvetica-Bold').fontSize(46).fillColor('#d33', 0.18).text(t, 0, 500 + i * 70, { width: 595, align: 'center' });
      doc.restore();
      doc.fillColor('#000', 1);
    });
  }

  // Paginação simples: estima quantas linhas cabem; a 1ª folha tem os quadros do destinatário.
  const pages = [];
  let current = [];
  let budget = 270; // altura livre para itens na 1ª folha
  doc.font('Helvetica').fontSize(6.5);
  for (const det of dets) {
    const desc = g(pickBlock(det, 'prod'), 'xProd') + (g(det, 'infAdProd') ? ` - ${g(det, 'infAdProd')}` : '');
    const h = Math.max(12, doc.heightOfString(desc, { width: cols[1][1] - 4 }) + 4);
    if (h > budget && current.length) {
      pages.push(current);
      current = [];
      budget = 560;
    }
    current.push(det);
    budget -= h;
  }
  pages.push(current);

  pages.forEach((items, idx) => {
    if (idx > 0) doc.addPage();
    let y = cabecalho(idx + 1, pages.length);
    if (idx === 0) y = destinatario(y);
    y = tabelaCabecalho(y);
    for (const det of items) y = linhaItem(y, det);
    if (idx === pages.length - 1) dadosAdicionais(Math.max(y + 6, 842 - M - 80));
    marcaDagua();
  });

  doc.end();
  return done;
}
