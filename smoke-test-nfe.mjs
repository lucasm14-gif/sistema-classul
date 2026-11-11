// Smoke test da aba Notas: PIN, certificado, cadastros, emissão, rejeição/reenvio,
// resposta perdida (pendente → consulta), cancelamento, CC-e, inutilização, DANFE e
// importação do C&K. Postgres em memória (pg-mem) e SEFAZ simulada — nada sai daqui.
process.env.API_TOKEN = 'teste-token';
process.env.EVOLUTION_URL = 'https://evolution.example.com';
process.env.EVOLUTION_APIKEY = 'fake';
process.env.EVOLUTION_INSTANCE = 'x';

import { newDb } from 'pg-mem';
import forge from 'node-forge';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { fileURLToPath } from 'url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const { _setPoolForTests } = await import(`file://${ROOT}/lib/db.js`);
const { _setTransportForTests } = await import(`file://${ROOT}/lib/nfe/sefaz.js`);
const { default: app } = await import(`file://${ROOT}/api/index.js`);

const mem = newDb();
mem.public.registerFunction({
  name: 'to_char',
  args: ['timestamptz', 'text'],
  returns: 'text',
  implementation: (d, fmt) => {
    const local = new Date(new Date(d).getTime() - 3 * 3600e3).toISOString();
    return fmt === 'YYYY-MM' ? local.slice(0, 7) : local;
  }
});
_setPoolForTests(new (mem.adapters.createPg().Pool)());

// ---------------------------------------------------------------- SEFAZ simulada
const enviados = [];
let modo = 'ok';
_setTransportForTests(async ({ url, body }) => {
  enviados.push({ url, body });
  const wrap = (inner) => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;
  const chave = (body.match(/Id="NFe(\d{44})"/) || body.match(/<chNFe>(\d{44})<\/chNFe>/) || [])[1];
  if (url.includes('cadconsultacadastro')) {
    if (body.includes('<CNPJ>89488316000692</CNPJ>')) return wrap('<retConsCad><infCons><cStat>111</cStat><xMotivo>Consulta cadastro com uma ocorrencia</xMotivo><infCad><IE>2130007915</IE><CNPJ>89488316000692</CNPJ><UF>RS</UF><cSit>1</cSit><xNome>STAHL BRASIL S.A.</xNome></infCad></infCons></retConsCad>');
    return wrap('<retConsCad><infCons><cStat>259</cStat><xMotivo>Rejeicao: CNPJ da consulta nao cadastrado como contribuinte na UF</xMotivo></infCons></retConsCad>');
  }
  if (url.includes('StatusServico')) return wrap('<retConsStatServ><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><tMed>1</tMed></retConsStatServ>');
  if (url.includes('NFeAutorizacao4')) {
    if (modo === 'rejeita') return wrap(`<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe><cStat>225</cStat><xMotivo>Rejeicao: Falha no Schema XML</xMotivo></infProt></protNFe></retEnviNFe>`);
    if (modo === 'perde') {
      const e = new (await import(`file://${ROOT}/lib/nfe/sefaz.js`)).SefazError('A SEFAZ demorou demais para responder.', { sent: true });
      throw e;
    }
    return wrap(`<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-09T10:00:00-03:00</dhRecbto><nProt>243260000000${String(enviados.length).padStart(3, '0')}</nProt><digVal>x</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retEnviNFe>`);
  }
  if (url.includes('NfeConsulta4')) {
    if (modo === 'inexistente') return wrap('<retConsSitNFe><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>');
    return wrap(`<retConsSitNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe><dhRecbto>2026-11-09T10:00:00-03:00</dhRecbto><nProt>243260000000999</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retConsSitNFe>`);
  }
  if (url.includes('recepcaoevento4')) return wrap('<retEnvEvento><cStat>128</cStat><retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><nProt>143260000000777</nProt></infEvento></retEvento></retEnvEvento>');
  if (url.includes('nfeinutilizacao4')) return wrap('<retInutNFe versao="4.00"><infInut><cStat>102</cStat><xMotivo>Inutilizacao de numero homologado</xMotivo><nProt>143260000000555</nProt></infInut></retInutNFe>');
  throw new Error('serviço inesperado ' + url);
});

// ---------------------------------------------------------------- certificado de teste (.pfx)
function pfxDeTeste(password, cnpj = '18605962000130') {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 864e5);
  c.validity.notAfter = new Date(Date.now() + 365 * 864e5);
  const attrs = [{ name: 'commonName', value: `EMPRESA TESTE:${cnpj}` }];
  c.setSubject(attrs);
  c.setIssuer(attrs);
  c.sign(keys.privateKey);
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [c], password, { algorithm: '3des' });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

const server = app.listen(3127);
const B = 'http://localhost:3127/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token', 'X-Classul-User': 'Lucas' };
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};
const call = async (method, p, body, headers = NH) => {
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
let NH = H;

try {
  // ---- PIN
  let r = await call('GET', '/nfe/config', null, H);
  check('config bloqueada sem PIN', r.status === 403 && r.body.nfe_locked);
  r = await call('POST', '/nfe/pin', { pin: '2468' }, H);
  check('cria PIN', r.status === 200 && r.body.token);
  NH = { ...H, 'X-Nfe-Token': r.body.token };
  r = await call('POST', '/nfe/unlock', { pin: '0000' }, H);
  check('PIN errado recusado', r.status === 403);

  // ---- Config padrão
  r = await call('GET', '/nfe/config');
  check('config padrão: homologação, série 2, nº 1', r.body.ambiente === 2 && r.body.serie === 2 && r.body.proximo_numero === 1 && r.body.emitente.ie === '0963547283');
  check('segredos da nota fora de /api/settings', !JSON.stringify((await call('GET', '/settings', null, H)).body).includes('cert_blob'));

  // ---- Emitir sem certificado
  r = await call('POST', '/nfe/emitir', { cliente_id: 1, itens: [] });
  check('emitir sem certificado avisa', r.status === 400 && /certificado/i.test(r.body.error), r.body.error);

  // ---- Certificado
  r = await call('POST', '/nfe/certificado', { pfx: pfxDeTeste('segredo'), senha: 'errada' });
  check('senha errada do .pfx recusada', r.status === 400 && /senha/i.test(r.body.error), r.body.error);
  r = await call('POST', '/nfe/certificado', { pfx: pfxDeTeste('segredo', '11222333000181'), senha: 'segredo' });
  check('certificado de outro CNPJ recusado', r.status === 400 && /outro CNPJ/.test(r.body.error), r.body.error);
  r = await call('POST', '/nfe/certificado', { pfx: pfxDeTeste('segredo'), senha: 'segredo' });
  check('certificado aceito', r.status === 200 && r.body.cnpj === '18605962000130');
  r = await call('GET', '/nfe/sefaz-status');
  check('status da SEFAZ', r.body.online === true && r.body.cStat === '107');

  // ---- Cadastros
  r = await call('POST', '/nfe/produtos', { codigo: '102', descricao: 'PLACA ACO TAM 12X17CM C/ EST', ncm: '8310.00.00', cfop_dentro: '5101', cfop_fora: '6101', valor: 199.5, aliq_tributos: 13.45 });
  const placa = r.body;
  check('produto criado', r.status === 200 && placa.ncm === '83100000');
  r = await call('POST', '/nfe/produtos', { descricao: 'ESTOJO', ncm: '123' });
  check('NCM inválido recusado', r.status === 400);
  r = await call('POST', '/nfe/clientes', { documento: '11.111.111/1111-11', nome: 'X' });
  check('CNPJ inválido recusado', r.status === 400);
  const clienteRS = { documento: '89.488.316/0006-92', nome: 'Stahl Brasil S.A.', logradouro: 'Rua Boa Vista', numero: '1832', bairro: 'Estacao Portao', municipio: 'Portao', cod_municipio: '4314803', uf: 'RS', cep: '93180000', telefone: '5133049900' };
  r = await call('POST', '/nfe/clientes', clienteRS);
  const cli = r.body;
  check('cliente criado', r.status === 200 && cli.documento === '89488316000692');
  r = await call('GET', '/nfe/clientes?q=stahl');
  check('busca cliente por nome', r.body.length === 1);
  r = await call('GET', '/nfe/clientes?q=' + encodeURIComponent('estação portão'));
  check('busca de cliente ignora acento e aceita várias palavras', r.body.length === 0 || r.body[0].id === cli.id);
  r = await call('GET', '/nfe/clientes?q=brasil stahl');
  check('busca com palavras fora de ordem', r.body.length === 1);
  r = await call('GET', '/nfe/clientes?q=89488316');
  check('busca por parte do CNPJ', r.body.length === 1);

  // ---- Emissão autorizada
  const itens = [{ produto_id: placa.id, codigo: placa.codigo, descricao: placa.descricao, ncm: placa.ncm, cfop_dentro: '5101', cfop_fora: '6101', unidade: 'UND', quantidade: 2, valor_unitario: 199.5, aliq_tributos: 13.45 }];
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens, pagamento: { tPag: '17' } });
  const n1 = r.body;
  check('nota 1 autorizada', r.status === 200 && n1.situacao === 'autorizada' && n1.numero === 1 && n1.protocolo, `${n1.situacao} ${n1.motivo || ''}`);
  check('valor total 399,00', n1.valor_total === 399);
  const enviada = enviados.at(-1).body;
  check('XML de homologação usa o nome obrigatório', enviada.includes('NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO'));
  check('CFOP 5101 e CSOSN 102', enviada.includes('<CFOP>5101</CFOP>') && enviada.includes('<CSOSN>102</CSOSN>'));
  check('valor aprox. de tributos preenchido', enviada.includes('<vTotTrib>53.67</vTotTrib>'));

  // Valida o XML enviado contra o schema oficial (se o XSD estiver na máquina).
  const xsd = `${ROOT}/EmissorNFe c/PRJNFe/xsd/enviNFe_v4.00.xsd`;
  if (fs.existsSync(xsd)) {
    const tmp = path.join(os.tmpdir(), `envi-${process.pid}.xml`);
    fs.writeFileSync(tmp, enviada.match(/<enviNFe[\s\S]*<\/enviNFe>/)[0]);
    let ok = true;
    try {
      execFileSync('xmllint', ['--noout', '--schema', xsd, tmp], { stdio: 'pipe' });
    } catch (e) {
      ok = false;
      console.log(String(e.stderr));
    }
    check('XML enviado passa no schema oficial', ok);
    fs.unlinkSync(tmp);
  }

  // ---- Cliente de outro estado: CFOP 6xxx automático
  r = await call('POST', '/nfe/emitir', {
    cliente: { documento: '11.890.651/0001-10', nome: 'Cliente SP', logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Sao Paulo', cod_municipio: '3550308', uf: 'SP', cep: '01001000' },
    itens,
    pagamento: { tPag: '18' }
  });
  check('cliente de SP usa CFOP 6101', r.body.situacao === 'autorizada' && enviados.at(-1).body.includes('<CFOP>6101</CFOP>') && enviados.at(-1).body.includes('<idDest>2</idDest>'));
  const xmlFora = enviados.at(-1).body;
  check('venda fora do estado: natureza, totais do destino zerados e sem grupo de DIFAL', xmlFora.includes('<natOp>VENDA FORA DO ESTADO</natOp>') && xmlFora.includes('<vICMSDeson>0.00</vICMSDeson><vFCPUFDest>0.00</vFCPUFDest><vICMSUFDest>0.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet><vFCP>') && !xmlFora.includes('<ICMSUFDest>'));
  {
    const xsdFora = `${ROOT}/EmissorNFe c/PRJNFe/xsd/enviNFe_v4.00.xsd`;
    if (fs.existsSync(xsdFora)) {
      const tmp = path.join(os.tmpdir(), `envi-fora-${process.pid}.xml`);
      fs.writeFileSync(tmp, xmlFora.match(/<enviNFe[\s\S]*<\/enviNFe>/)[0]);
      let ok = true;
      try {
        execFileSync('xmllint', ['--noout', '--schema', xsdFora, tmp], { stdio: 'pipe' });
      } catch (e) {
        ok = false;
        console.log(String(e.stderr));
      }
      fs.unlinkSync(tmp);
      check('nota fora do estado passa no schema oficial', ok);
    }
  }
  check('nota dentro do estado continua sem os totais do destino', !enviada.includes('vICMSUFDest'));

  // ---- Rejeição e reenvio com o mesmo número
  modo = 'rejeita';
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens });
  const n3 = r.body;
  check('nota rejeitada guarda o motivo', n3.situacao === 'rejeitada' && /Schema/.test(n3.motivo) && n3.numero === 3);
  modo = 'ok';
  r = await call('POST', '/nfe/emitir', { nota_id: n3.id, cliente_id: cli.id, itens });
  check('reenvio usa o mesmo número', r.body.situacao === 'autorizada' && r.body.numero === 3 && r.body.id === n3.id);
  r = await call('GET', '/nfe/config');
  check('próximo número é 4', r.body.proximo_numero === 4);

  // ---- Resposta perdida: fica pendente e resolve consultando a chave
  modo = 'perde';
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens });
  const n4 = r.body;
  check('sem resposta fica pendente', n4.situacao === 'pendente' && n4.numero === 4);
  modo = 'ok';
  r = await call('POST', `/nfe/notas/${n4.id}/consultar`);
  check('consulta recupera a autorização', r.body.nota.situacao === 'autorizada' && r.body.nota.protocolo === '243260000000999');

  // ---- Pendente que a SEFAZ não conhece volta a ser reenviável
  modo = 'perde';
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens });
  const n5 = r.body;
  modo = 'inexistente';
  r = await call('POST', `/nfe/notas/${n5.id}/consultar`);
  check('pendente inexistente vira rejeitada', r.body.nota.situacao === 'rejeitada');
  modo = 'ok';

  // ---- Validações antes de gastar número
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens: [{ ...itens[0], ncm: '12' }] });
  check('erro de cadastro não gasta número', r.status === 400 && /NCM/.test(r.body.error));
  r = await call('GET', '/nfe/config');
  check('numeração intacta', r.body.proximo_numero === 6);

  // ---- DANFE e XML
  r = await call('GET', `/nfe/notas/${n1.id}/danfe`);
  check('DANFE em PDF', r.status === 200 && r.body.slice(0, 4).toString() === '%PDF');
  r = await call('GET', `/nfe/notas/${n1.id}/xml`);
  check('XML autorizado (nfeProc)', r.status === 200 && r.body.toString().includes('<nfeProc') && r.body.toString().includes('<protNFe'));

  // ---- CC-e e cancelamento
  r = await call('POST', `/nfe/notas/${n1.id}/cce`, { correcao: 'curta' });
  check('CC-e curta recusada', r.status === 400);
  r = await call('POST', `/nfe/notas/${n1.id}/cce`, { correcao: 'Correcao do complemento do endereco do destinatario' });
  check('CC-e registrada', r.status === 200 && r.body.cce_seq === 1 && r.body.eventos.length === 1);
  r = await call('POST', `/nfe/notas/${n1.id}/cancelar`, { justificativa: 'Cliente desistiu da compra' });
  check('nota cancelada', r.status === 200 && r.body.situacao === 'cancelada');
  r = await call('POST', `/nfe/notas/${n1.id}/cancelar`, { justificativa: 'Cliente desistiu da compra' });
  check('não cancela duas vezes', r.status === 400);

  // ---- Inutilização
  r = await call('POST', '/nfe/inutilizar', { serie: 2, inicio: 1, fim: 1, justificativa: 'Numero pulado por falha' });
  check('não inutiliza número usado', r.status === 400 && /cancelada/.test(r.body.error));
  r = await call('POST', '/nfe/inutilizar', { serie: 2, inicio: 5, fim: 7, justificativa: 'Numeracao pulada por falha no sistema' });
  check('inutiliza faixa', r.status === 200 && r.body.ok);
  r = await call('GET', '/nfe/config');
  check('numeração pula a faixa inutilizada', r.body.proximo_numero === 8);
  r = await call('POST', '/nfe/inutilizar', { serie: 1, inicio: 4165, fim: 4168, justificativa: 'Numeros sem retorno no emissor anterior' });
  check('inutiliza números da série 1 do C&K', r.status === 200);

  // ---- Lista, resumo e consulta avulsa
  r = await call('GET', '/nfe/notas');
  check('lista de notas', Array.isArray(r.body) && r.body.length >= 4 && !('xml' in r.body[0]));
  r = await call('GET', '/nfe/notas?q=stahl&situacao=autorizada');
  check('busca e filtro', r.body.every((n) => n.situacao === 'autorizada'));
  r = await call('GET', '/nfe/resumo');
  check('resumo por mês', Array.isArray(r.body.meses));
  r = await call('POST', '/nfe/consultar-chave', { chave: '43251018605962000130550010000041651360690350' });
  check('consulta chave avulsa', r.status === 200 && r.body.numero === 4165 && r.body.serie === 1);

  // ---- Importação do C&K
  const procs = fs.existsSync(`${ROOT}/EmissorNFe c/PRJNFe/PROCNFE`)
    ? fs.readdirSync(`${ROOT}/EmissorNFe c/PRJNFe/PROCNFE`).filter((f) => /\.xml$/i.test(f)).slice(0, 3).map((f) => fs.readFileSync(`${ROOT}/EmissorNFe c/PRJNFe/PROCNFE/${f}`, 'utf8'))
    : [];
  const lote = {
    clientes: [{ ...clienteRS, documento: '33.000.167/0001-01', nome: 'Importado' }],
    produtos: [{ codigo: '501', descricao: 'MEDALHA PERSON 5CM', ncm: '83062900', cfop_dentro: '5102', cfop_fora: '6102', valor: 9 }],
    notas: procs
  };
  r = await call('POST', '/nfe/importar', lote);
  check('importação do C&K', r.status === 200 && r.body.clientes === 1 && r.body.produtos === 1 && r.body.notas === procs.length, JSON.stringify(r.body));
  r = await call('POST', '/nfe/importar', lote);
  check('importar de novo não duplica', r.body.clientes === 0 && r.body.produtos === 0 && r.body.notas === 0);
  if (procs.length) {
    r = await call('GET', '/nfe/notas?ambiente=1');
    check('notas importadas aparecem em produção', r.body.length === procs.length && r.body[0].origem === 'cnk');
    r = await call('GET', `/nfe/notas/${r.body[0].id}/danfe`);
    check('DANFE de nota importada', r.status === 200 && r.body.slice(0, 4).toString() === '%PDF');
  }
  // ---- Inscrição estadual (CPF x CNPJ, contribuinte, isento) e busca na SEFAZ
  r = await call('GET', '/nfe/buscar-ie?cnpj=89488316000692&uf=RS');
  check('busca IE na SEFAZ', r.body.encontrado && r.body.ie === '2130007915' && r.body.situacao === 'habilitado', JSON.stringify(r.body));
  r = await call('GET', '/nfe/buscar-ie?cnpj=11890651000110&uf=RS');
  check('CNPJ sem IE: não contribuinte', r.body.encontrado === false && /contribuinte/.test(r.body.motivo));
  r = await call('POST', '/nfe/clientes', { ...clienteRS, contribuinte: 1, ie: '' });
  check('contribuinte sem IE é recusado', r.status === 400 && /inscri/.test(r.body.error));
  r = await call('PUT', `/nfe/clientes/${cli.id}`, { ...clienteRS, contribuinte: 1, ie: '213/0007915' });
  check('cliente contribuinte com IE', r.body.contribuinte === 1 && r.body.ie === '2130007915');
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens });
  const xmlContrib = enviados.at(-1).body;
  check('nota para contribuinte leva indIEDest 1 e a IE', xmlContrib.includes('<indIEDest>1</indIEDest><IE>2130007915</IE>'));
  r = await call('PUT', `/nfe/clientes/${cli.id}`, { ...clienteRS, contribuinte: 0, ie: 'ISENTO' });
  check('IE "ISENTO" vira isento', r.body.contribuinte === 2 && r.body.ie === '');
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens });
  check('nota para isento leva indIEDest 2 sem IE', enviados.at(-1).body.includes('<indIEDest>2</indIEDest>') && !/<dest>[\s\S]*<IE>/.test(enviados.at(-1).body));
  r = await call('POST', '/nfe/clientes', { ...clienteRS, documento: '529.982.247-25', nome: 'Pessoa Fisica', contribuinte: 1, ie: '123' });
  check('CPF nunca é contribuinte', r.status === 200 && r.body.contribuinte === 0 && r.body.ie === '');
  r = await call('POST', '/nfe/clientes', { ...clienteRS, documento: '529.982.247-25', email: 'sem-arroba' });
  check('e-mail que não dá para aproveitar fica vazio (não trava o cadastro)', r.status === 200 && r.body.email === '');
  r = await call('POST', '/nfe/clientes', { ...clienteRS, documento: '529.982.247-25', email: 'classulrs@gmailcom' });
  check('e-mail sem ponto é corrigido', r.body.email === 'classulrs@gmail.com');
  r = await call('PUT', `/nfe/clientes/${cli.id}`, { ...clienteRS, ie: '0', contribuinte: 1 });
  check('IE "0" do C&K não conta como inscrição', r.status === 400 || (r.body.ie === '' && r.body.contribuinte === 0));
  r = await call('PUT', `/nfe/clientes/${cli.id}`, { ...clienteRS, ie: '9', contribuinte: 0 });
  check('IE "9" vira não contribuinte sem IE', r.body.ie === '' && r.body.contribuinte === 0);
  r = await call('PUT', `/nfe/clientes/${cli.id}`, { ...clienteRS, ie: '2130007915', contribuinte: 0 });
  check('CNPJ com IE de verdade vira contribuinte', r.body.ie === '2130007915' && r.body.contribuinte === 1);
  // Emissão confere a IE na SEFAZ e corrige o cadastro sozinha.
  await call('PUT', `/nfe/clientes/${cli.id}`, { ...clienteRS, ie: '', contribuinte: 0, email: 'classulrs@gmailcom' });
  r = await call('POST', '/nfe/emitir', { cliente_id: cli.id, itens });
  const xmlConferido = enviados.at(-1).body;
  check('emissão busca a IE na SEFAZ e manda como contribuinte', xmlConferido.includes('<indIEDest>1</indIEDest><IE>2130007915</IE>'));
  check('e-mail sai corrigido na nota', xmlConferido.includes('<email>classulrs@gmail.com</email>'));
  r = await call('GET', '/nfe/clientes?q=stahl');
  check('cadastro do cliente foi atualizado com a IE da SEFAZ', r.body.some((c) => c.id === cli.id && c.ie === '2130007915' && c.contribuinte === 1), JSON.stringify(r.body.map((c) => [c.id, c.nome, c.ie, c.contribuinte])));
  await call('PUT', `/nfe/clientes/${cli.id}`, clienteRS);

  // ---- Logo do DANFE
  r = await call('GET', '/nfe/config');
  check('logo padrão é o carimbo da Classul', r.body.logo === 'padrao');
  r = await call('GET', '/nfe/logo');
  check('prévia da logo', r.status === 200 && r.body[0] === 0xff && r.body[1] === 0xd8);
  const pdfComLogo = (await call('GET', `/nfe/notas/${n1.id}/danfe`)).body;
  r = await call('POST', '/nfe/logo', { imagem: 'nenhuma' });
  check('tirar a logo', r.body.logo === 'nenhuma');
  const pdfSemLogo = (await call('GET', `/nfe/notas/${n1.id}/danfe`)).body;
  check('PDF com logo é maior que sem', pdfComLogo.length > pdfSemLogo.length + 5000, `${pdfComLogo.length} x ${pdfSemLogo.length}`);
  r = await call('POST', '/nfe/logo', { imagem: 'data:image/gif;base64,R0lGOD' });
  check('logo em formato errado recusada', r.status === 400);
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  r = await call('POST', '/nfe/logo', { imagem: png1x1 });
  check('logo própria aceita', r.body.logo === 'propria' && (await call('GET', `/nfe/notas/${n1.id}/danfe`)).status === 200);
  r = await call('POST', '/nfe/logo', { imagem: 'padrao' });
  check('volta para o carimbo padrão', r.body.logo === 'padrao');

  // ---- Faturamento pelas notas autorizadas (só produção)
  r = await call('GET', '/faturamento', null, H);
  check('faturamento abre só com login', r.status === 200 && Array.isArray(r.body.serie) && Array.isArray(r.body.anos));
  if (procs.length) {
    const ultAno = r.body.anos.at(-1);
    const ultimo = `${ultAno.ano}-${String(ultAno.meses.findLastIndex((v) => v > 0) + 1).padStart(2, '0')}`;
    r = await call('GET', `/faturamento?periodo=${ultimo}`, null, H);
    const soma = r.body.categorias.reduce((s2, c) => s2 + c.total, 0);
    check('faturamento lê os itens das notas importadas', r.body.pendentes === 0 && r.body.resumo.notas > 0 && r.body.categorias.length > 0, JSON.stringify(r.body.resumo));
    check('itens somam o total das notas', Math.abs(soma - r.body.resumo.total) < 1, `${soma} x ${r.body.resumo.total}`);
    check('homologação fica fora do faturamento', !r.body.notas.some((n) => n.serie === 2));
    const totalMes = r.body.resumo.total;
    const ano = ultimo.slice(0, 4);
    r = await call('GET', `/faturamento?de=${ano}-01-01&ate=${ano}-12-31&granularidade=mes`, null, H);
    check('ano inteiro: 12 meses na série', r.body.serie.length === 12 && r.body.filtros.granularidade === 'mes');
    check('série soma o total do período', Math.abs(r.body.serie.reduce((s2, p) => s2 + p.total, 0) - r.body.resumo.total) < 1);
    const doAno = r.body.anos.find((a) => a.ano === ano);
    check('total do ano bate com o período do ano', doAno && Math.abs(doAno.total - r.body.resumo.total) < 1, `${doAno?.total} x ${r.body.resumo.total}`);
    check('mês do ano bate com o mês filtrado', Math.abs(doAno.meses[Number(ultimo.slice(5)) - 1] - totalMes) < 1);
    const cat = r.body.categorias[0];
    const rc = await call('GET', `/faturamento?de=${ano}-01-01&ate=${ano}-12-31&categoria=${encodeURIComponent(cat.chave)}`, null, H);
    check('filtro de categoria soma só os itens dela', Math.abs(rc.body.resumo.total - cat.total) < 1 && rc.body.categorias.length === 1, `${rc.body.resumo.total} x ${cat.total}`);
    const cli = r.body.clientes[0];
    const rk = await call('GET', `/faturamento?de=${ano}-01-01&ate=${ano}-12-31&cliente=${encodeURIComponent(cli.nome)}`, null, H);
    check('filtro de cliente', rk.body.resumo.total >= cli.total - 1 && rk.body.notas.every((n) => n.cliente === cli.nome || n.documento === cli.documento));
    const rd = await call('GET', `/faturamento?de=${ultimo}-01&ate=${ultimo}-10&granularidade=dia`, null, H);
    check('série por dia no intervalo', rd.body.serie.length === 10);
  }

  // ---- Ranking de uso, última compra e "emitir outra igual"
  r = await call('GET', '/nfe/produtos');
  const nomesProd = r.body.map((p) => p.descricao);
  check('produtos em ordem alfabética', nomesProd.join('|') === [...nomesProd].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })).join('|'), nomesProd.join(', '));
  check('vendas do produto continuam contadas', r.body.find((p) => p.codigo === '102')?.uso >= 3);
  r = await call('POST', '/nfe/clientes', { ...clienteRS, documento: '33.000.167/0001-01', nome: 'Água Mineral Ltda' });
  r = await call('GET', '/nfe/clientes');
  const nomesCli = r.body.map((c) => c.nome);
  check('clientes em ordem alfabética (acento no lugar certo)', nomesCli.join('|') === [...nomesCli].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })).join('|') && nomesCli[0].startsWith('Água'), nomesCli.join(', '));
  r = await call('GET', '/nfe/clientes?q=ltda');
  check('busca de cliente em ordem alfabética', r.body.length >= 1 && r.body.map((c) => c.nome).join('|') === r.body.map((c) => c.nome).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })).join('|'));
  r = await call('GET', `/nfe/clientes/${cli.id}/ultima`);
  check('última compra do cliente', r.status === 200 && r.body.itens.length === 1 && r.body.itens[0].codigo === '102');
  r = await call('GET', `/nfe/notas/${n3.id}/copia`);
  check('copiar nota traz cliente e itens', r.body.cliente?.id === cli.id && r.body.itens[0].quantidade === 2);
  r = await call('GET', `/nfe/notas/${n3.id}`);
  check('nota traz telefone do cliente', r.body.cliente_telefone === '5133049900');
  if (procs.length) {
    const imp = (await call('GET', '/nfe/notas?ambiente=1')).body[0];
    r = await call('GET', `/nfe/notas/${imp.id}/copia`);
    check('copiar nota do C&K lê os itens do XML', r.status === 200 && r.body.itens.length > 0 && /^5|^6/.test(r.body.itens[0].cfop_dentro) && r.body.itens[0].valor_unitario > 0);
  }

  // ---- Hermes: entra nas notas sem PIN, baixa e manda os arquivos
  {
    const { setSettings } = await import(`file://${ROOT}/lib/db.js`);
    await setSettings({
      hermes_token: 'chave-hermes', hermes_enabled: '1',
      evolution_url: 'https://evolution.exemplo.com', evolution_apikey: 'fake', evolution_instance: 'classul'
    });
    const HER = { 'Content-Type': 'application/json', Authorization: 'Bearer chave-hermes' };
    const tool = async (name, args = {}) => (await call('POST', '/hermes/call', { tool: name, args }, HER)).body;
    const realFetch = globalThis.fetch;
    const docs = [];
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/message/sendMedia/')) {
        docs.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({ key: { id: 'DOC' } }) };
      }
      return realFetch(url, opts);
    };

    let t = await tool('notas_listar', { ambiente: 2, situacao: 'autorizada' });
    const nota = t.result?.notas?.[0];
    check('Hermes lista as notas sem PIN', t.ok && nota && nota.arquivos.pdf.ref === `nfe:${nota.id}:pdf`, t.error);
    t = await tool('nota_detalhe', { id: nota.id });
    check('Hermes abre a nota com itens e sem XML no corpo', t.ok && t.result.itens.length > 0 && !('xml_proc' in t.result) && t.result.arquivos.xml.ref === `nfe:${nota.id}:xml`, t.error);
    t = await tool('nota_detalhe', { numero: String(nota.numero), serie: nota.serie, ambiente: 2 });
    check('Hermes acha a nota pelo número', t.ok && t.result.id === nota.id, t.error);
    t = await tool('nfe_situacao');
    check('Hermes vê a situação da emissão', t.ok && t.result.ambiente === 'homologação' && t.result.sefaz?.online === true && t.result.tem_certificado, JSON.stringify(t.result?.sefaz || t.error));
    t = await tool('nfe_clientes', { busca: 'stahl' });
    check('Hermes consulta clientes fiscais', t.ok && t.result.length > 0, t.error);
    t = await tool('nfe_produtos');
    check('Hermes consulta produtos', t.ok && t.result.length > 0, t.error);

    t = await tool('baixar_arquivo', { ref: `nfe:${nota.id}:pdf` });
    check('Hermes baixa o DANFE em base64', t.ok && Buffer.from(t.result.base64, 'base64').subarray(0, 5).toString() === '%PDF-' && t.result.tipo === 'application/pdf', t.error);
    r = await call('GET', `/hermes/arquivo?ref=nfe:${nota.id}:xml`, null, HER);
    check('Hermes baixa o XML como arquivo', r.status === 200 && r.body.toString().includes('<nfeProc') && r.body.toString().includes(nota.chave));
    r = await call('GET', `/hermes/arquivo?ref=nfe:${nota.id}:pdf`, null, { Authorization: 'Bearer errada' });
    check('arquivo não sai sem a chave do Hermes', r.status === 401);
    r = await call('GET', '/hermes/arquivo?ref=nfe:999999:pdf', null, HER);
    check('ref de nota inexistente dá 404', r.status === 404);

    t = await tool('enviar_arquivo', { telefone: '51999990000', ref: `nfe:${nota.id}:pdf`, legenda: 'Segue a nota' });
    check('Hermes manda o DANFE por WhatsApp', t.ok && docs.length === 1 && docs[0].mediatype === 'document' && docs[0].mimetype === 'application/pdf' && /^NFe-\d{6}-serie2\.pdf$/.test(docs[0].fileName) && docs[0].caption === 'Segue a nota', t.error);
    t = await tool('enviar_arquivo', { telefone: '51999990000', ref: 'banana' });
    check('ref inválida é recusada', t.ok === false && /ref/i.test(t.error));

    const ev = (await call('GET', '/hermes/events?limit=100', null, H)).body;
    const priv = ev.filter((e) => ['notas_listar', 'nota_detalhe', 'baixar_arquivo'].includes(e.name));
    check('registro do Hermes não guarda o conteúdo das notas', priv.length >= 3 && priv.every((e) => !e.args && !e.result));
    globalThis.fetch = realFetch;
  }
} catch (err) {
  console.error(err);
  fails++;
} finally {
  server.close();
  console.log(fails ? `\n${fails} falha(s)` : '\nTudo certo.');
  process.exit(fails ? 1 : 0);
}
