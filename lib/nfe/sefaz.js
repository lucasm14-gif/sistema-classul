// Comunicação direta com os web services da SEFAZ RS (NF-e 4.00, SOAP 1.2 com
// certificado do cliente no TLS). É exatamente o que o C&K faz no Windows; aqui roda
// no servidor do sistema, então qualquer computador com o navegador emite.
import https from 'https';
import tls from 'tls';
import { ICP_BRASIL_ROOTS } from './icp-roots.js';
import { NS } from './xml.js';

const HOSTS = { 1: 'https://nfe.sefazrs.rs.gov.br', 2: 'https://nfe-homologacao.sefazrs.rs.gov.br' };

const SERVICES = {
  autorizacao: { path: '/ws/NfeAutorizacao/NFeAutorizacao4.asmx', wsdl: 'NFeAutorizacao4' },
  retAutorizacao: { path: '/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx', wsdl: 'NFeRetAutorizacao4' },
  consulta: { path: '/ws/NfeConsulta/NfeConsulta4.asmx', wsdl: 'NFeConsultaProtocolo4' },
  status: { path: '/ws/NfeStatusServico/NfeStatusServico4.asmx', wsdl: 'NFeStatusServico4' },
  inutilizacao: { path: '/ws/nfeinutilizacao/nfeinutilizacao4.asmx', wsdl: 'NFeInutilizacao4' },
  evento: { path: '/ws/recepcaoevento/recepcaoevento4.asmx', wsdl: 'NFeRecepcaoEvento4' }
};

export class SefazError extends Error {
  constructor(message, { sent = false } = {}) {
    super(message);
    // sent = a mensagem pode ter chegado na SEFAZ (timeout depois de enviar). Nesse caso
    // a nota NÃO pode ser reenviada às cegas: tem que consultar pela chave antes.
    this.sent = sent;
  }
}

const CA = [...tls.rootCertificates, ICP_BRASIL_ROOTS];

// Permite trocar o transporte nos testes (sem rede).
let transport = null;
export function _setTransportForTests(fn) {
  transport = fn;
}

function post(url, body, cert, soapAction, timeoutMs) {
  if (transport) return transport({ url, body, soapAction });
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        key: cert.keyPem,
        cert: cert.certPem + (cert.chainPem || ''),
        ca: CA,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 500 && !/<soap/i.test(text)) {
            return reject(new SefazError(`A SEFAZ respondeu com erro ${res.statusCode}. Tente de novo em instantes.`, { sent: true }));
          }
          if (res.statusCode === 403) {
            return reject(new SefazError('A SEFAZ recusou o certificado digital (403). Confira se o certificado é o A1 da empresa e está válido.'));
          }
          resolve(text);
        });
      }
    );
    let wrote = false;
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      const msg = err.message === 'timeout' ? 'A SEFAZ demorou demais para responder.' : `Não foi possível falar com a SEFAZ (${err.code || err.message}).`;
      reject(new SefazError(msg, { sent: wrote }));
    });
    req.write(body, () => {
      wrote = true;
    });
    req.end();
  });
}

function envelope(wsdl, inner) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${wsdl}">${inner}</nfeDadosMsg></soap12:Body>` +
    '</soap12:Envelope>'
  );
}

async function call(service, ambiente, inner, cert, { timeoutMs = 20000 } = {}) {
  const s = SERVICES[service];
  const url = HOSTS[Number(ambiente) === 1 ? 1 : 2] + s.path;
  const soapAction = `http://www.portalfiscal.inf.br/nfe/wsdl/${s.wsdl}/nfeResultMsg`;
  const text = await post(url, envelope(s.wsdl, inner), cert, soapAction, timeoutMs);
  const fault = text.match(/<(?:\w+:)?Text[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/);
  if (/<(?:\w+:)?Fault>/.test(text)) throw new SefazError(`SEFAZ: ${fault ? fault[1] : 'erro SOAP'}`, { sent: true });
  return text;
}

// ------------------------------------------------------------------ leitura das respostas

export const pick = (xml, name) => {
  const m = String(xml || '').match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? m[1] : '';
};
export const pickBlock = (xml, name) => {
  const m = String(xml || '').match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>[\\s\\S]*?</(?:\\w+:)?${name}>`));
  return m ? m[0] : '';
};

// Resultado de uma NF-e: autorizada (100/150), denegada (110/301/302/303) ou rejeitada.
export function classify(cStat) {
  const c = Number(cStat);
  if (c === 100 || c === 150) return 'autorizada';
  if ([110, 205, 301, 302, 303].includes(c)) return 'denegada';
  return 'rejeitada';
}

// ------------------------------------------------------------------ serviços

export async function statusServico(ambiente, cert) {
  const xml = await call(
    'status',
    ambiente,
    `<consStatServ xmlns="${NS}" versao="4.00"><tpAmb>${ambiente}</tpAmb><cUF>43</cUF><xServ>STATUS</xServ></consStatServ>`,
    cert,
    { timeoutMs: 12000 }
  );
  return { cStat: pick(xml, 'cStat'), xMotivo: pick(xml, 'xMotivo'), tMed: pick(xml, 'tMed'), online: pick(xml, 'cStat') === '107' };
}

/**
 * Envia a NF-e assinada em modo síncrono. Devolve:
 *  { situacao: 'autorizada'|'denegada'|'rejeitada'|'processando', cStat, xMotivo, protXml, nProt, dhRecbto, nRec }
 */
export async function autorizar(ambiente, nfeAssinada, cert) {
  const idLote = String(Date.now()).slice(-15);
  const inner = `<enviNFe xmlns="${NS}" versao="4.00"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfeAssinada}</enviNFe>`;
  const xml = await call('autorizacao', ambiente, inner, cert, { timeoutMs: 25000 });
  const ret = pickBlock(xml, 'retEnviNFe') || xml;
  const cStatLote = pick(ret, 'cStat');
  // 103 = lote recebido (assíncrono): consulta o recibo.
  if (cStatLote === '103') {
    const nRec = pick(ret, 'nRec');
    return { situacao: 'processando', cStat: cStatLote, xMotivo: pick(ret, 'xMotivo'), nRec };
  }
  const prot = pickBlock(ret, 'protNFe');
  if (!prot) {
    // Rejeição do lote inteiro (ex.: 215 falha no schema, 225, 656 consumo indevido).
    return { situacao: 'rejeitada', cStat: cStatLote, xMotivo: pick(ret, 'xMotivo') };
  }
  const cStat = pick(prot, 'cStat');
  return {
    situacao: classify(cStat),
    cStat,
    xMotivo: pick(prot, 'xMotivo'),
    protXml: prot,
    nProt: pick(prot, 'nProt'),
    dhRecbto: pick(prot, 'dhRecbto')
  };
}

export async function consultarRecibo(ambiente, nRec, cert) {
  const xml = await call(
    'retAutorizacao',
    ambiente,
    `<consReciNFe xmlns="${NS}" versao="4.00"><tpAmb>${ambiente}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`,
    cert
  );
  const prot = pickBlock(xml, 'protNFe');
  if (!prot) return { situacao: pick(xml, 'cStat') === '105' ? 'processando' : 'rejeitada', cStat: pick(xml, 'cStat'), xMotivo: pick(xml, 'xMotivo') };
  const cStat = pick(prot, 'cStat');
  return { situacao: classify(cStat), cStat, xMotivo: pick(prot, 'xMotivo'), protXml: prot, nProt: pick(prot, 'nProt'), dhRecbto: pick(prot, 'dhRecbto') };
}

// Consulta a situação pela chave — resolve notas que ficaram sem resposta
// (como as que ficaram "ENVIADA" no C&K).
export async function consultarChave(ambiente, chave, cert) {
  const xml = await call(
    'consulta',
    ambiente,
    `<consSitNFe xmlns="${NS}" versao="4.00"><tpAmb>${ambiente}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`,
    cert
  );
  const ret = pickBlock(xml, 'retConsSitNFe') || xml;
  const cStat = pick(ret, 'cStat');
  const prot = pickBlock(ret, 'protNFe');
  const eventos = [...String(ret).matchAll(/<procEventoNFe[\s\S]*?<\/procEventoNFe>/g)].map((m) => m[0]);
  const cancelada = cStat === '101' || cStat === '151' || eventos.some((e) => /<tpEvento>110111<\/tpEvento>[\s\S]*<cStat>13[56]<\/cStat>/.test(e));
  return {
    cStat,
    xMotivo: pick(ret, 'xMotivo'),
    // 217 = a SEFAZ não conhece essa chave (a nota nunca foi autorizada).
    existe: cStat !== '217',
    situacao: cancelada ? 'cancelada' : prot ? classify(pick(prot, 'cStat')) : cStat === '217' ? 'inexistente' : 'rejeitada',
    protXml: prot,
    nProt: pick(prot, 'nProt'),
    dhRecbto: pick(prot, 'dhRecbto'),
    eventos
  };
}

export async function enviarEvento(ambiente, eventoAssinado, cert) {
  const idLote = String(Date.now()).slice(-15);
  const xml = await call(
    'evento',
    ambiente,
    `<envEvento xmlns="${NS}" versao="1.00"><idLote>${idLote}</idLote>${eventoAssinado}</envEvento>`,
    cert
  );
  const ret = pickBlock(xml, 'retEvento');
  const cStat = pick(ret, 'cStat') || pick(xml, 'cStat');
  return {
    // 135 = registrado e vinculado; 136 = registrado sem vínculo; 155 = cancelamento fora do prazo aceito.
    ok: ['135', '136', '155'].includes(cStat),
    cStat,
    xMotivo: pick(ret, 'xMotivo') || pick(xml, 'xMotivo'),
    nProt: pick(ret, 'nProt'),
    retXml: ret
  };
}

export async function inutilizar(ambiente, inutAssinada, cert) {
  const xml = await call('inutilizacao', ambiente, inutAssinada, cert);
  const ret = pickBlock(xml, 'retInutNFe');
  const cStat = pick(ret, 'cStat');
  return { ok: cStat === '102', cStat, xMotivo: pick(ret, 'xMotivo'), nProt: pick(ret, 'nProt'), retXml: ret };
}

// Consulta o cadastro de contribuintes do ICMS (descobre a inscrição estadual pelo CNPJ).
// RS tem servidor próprio; outros estados atendidos pela SVRS usam o da SVRS.
const CADASTRO = {
  RS: 'https://cad.sefazrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx',
  SVRS: 'https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx'
};
export async function consultarCadastro(uf, cnpj, cert) {
  const url = CADASTRO[uf] || CADASTRO.SVRS;
  const wsdl = 'CadConsultaCadastro4';
  const inner = `<ConsCad xmlns="${NS}" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>${uf}</UF><CNPJ>${cnpj}</CNPJ></infCons></ConsCad>`;
  const text = transport
    ? await transport({ url, body: inner })
    : await post(url, envelope(wsdl, inner), cert, `http://www.portalfiscal.inf.br/nfe/wsdl/${wsdl}/consultaCadastro`, 15000);
  const ret = pickBlock(text, 'infCons') || text;
  const cStat = pick(ret, 'cStat');
  // 111 = um cadastro; 112 = vários (filiais). 259 = não é contribuinte.
  const cadastros = [...String(text).matchAll(/<infCad>[\s\S]*?<\/infCad>/g)].map(([c]) => ({
    ie: pick(c, 'IE'),
    situacao: pick(c, 'cSit') === '1' ? 'habilitado' : 'não habilitado',
    nome: pick(c, 'xNome').replace(/&amp;/g, '&'),
    uf: pick(c, 'UF')
  }));
  return { cStat, xMotivo: pick(ret, 'xMotivo'), cadastros };
}

// Junta NF-e assinada + protocolo no arquivo que se guarda (e que o cliente recebe).
export function montarProc(nfeAssinada, protXml) {
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS}" versao="4.00">${nfeAssinada}${protXml}</nfeProc>`;
}

export function montarProcEvento(eventoAssinado, retEvento) {
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NS}" versao="1.00">${eventoAssinado}${retEvento}</procEventoNFe>`;
}

export function montarProcInut(inutAssinada, retInut) {
  return `<?xml version="1.0" encoding="UTF-8"?><ProcInutNFe xmlns="${NS}" versao="4.00">${inutAssinada}${retInut}</ProcInutNFe>`;
}
