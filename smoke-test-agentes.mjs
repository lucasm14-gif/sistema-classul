// Testa os agentes (aba Agentes) e as ferramentas novas do atendente:
// subir arquivo, anexar ao pedido, orçamento em PDF e rascunho de NF-e com
// aprovação do Lucas. Banco em memória (pg-mem), Google Drive, Evolution e SEFAZ
// falsos, e um "Hermes" local que guarda os eventos. Nada sai para a internet.
process.env.API_TOKEN = 'teste-token';

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import forge from 'node-forge';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const { _setPoolForTests, setSettings, ensureSchema } = await import(`file://${ROOT}/lib/db.js`);
const { _setTransportForTests } = await import(`file://${ROOT}/lib/nfe/sefaz.js`);

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
const { default: app } = await import(`file://${ROOT}/api/index.js`);

// ---- Google Drive, Evolution falsos
const drive = new Map(); // id -> { name, mimeType, buffer, parents }
let driveSeq = 0;
const midias = [];
const realFetch = globalThis.fetch;
const resp = (obj, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => null },
  json: async () => obj,
  text: async () => JSON.stringify(obj),
  arrayBuffer: async () => new ArrayBuffer(0)
});
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) return resp({ access_token: 'tok', expires_in: 3600 });
  if (u.startsWith('https://www.googleapis.com/drive/v3/files?fields=id,name')) {
    const meta = JSON.parse(opts.body);
    const id = `pasta${++driveSeq}`;
    drive.set(id, { name: meta.name, mimeType: meta.mimeType, buffer: Buffer.alloc(0), parents: meta.parents || [] });
    return resp({ id, name: meta.name });
  }
  if (u.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart')) {
    const body = Buffer.from(opts.body);
    const boundary = /boundary=(.+)$/.exec(opts.headers['Content-Type'])[1];
    const partes = body.toString('latin1').split(`--${boundary}`);
    const meta = JSON.parse(partes[1].split('\r\n\r\n')[1]);
    const mime = /Content-Type: ([^\r]+)/.exec(partes[2])[1];
    const conteudo = Buffer.from(partes[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1');
    const id = `arq${++driveSeq}`;
    drive.set(id, { name: meta.name, mimeType: mime, buffer: conteudo, parents: meta.parents });
    return resp({ id, name: meta.name, mimeType: mime, size: String(conteudo.length), webViewLink: `https://drive/${id}` });
  }
  const m = /drive\/v3\/files\/([^?/]+)(\?alt=media)?/.exec(u);
  if (m && u.startsWith('https://www.googleapis.com/')) {
    const f = drive.get(decodeURIComponent(m[1]));
    if (!f) return resp({ error: 'not found' }, 404);
    if (m[2]) return { ...resp({}), arrayBuffer: async () => f.buffer.buffer.slice(f.buffer.byteOffset, f.buffer.byteOffset + f.buffer.length) };
    return resp({ id: m[1], name: f.name, mimeType: f.mimeType, size: String(f.buffer.length) });
  }
  if (u.includes('/message/sendMedia/')) {
    midias.push(JSON.parse(opts.body));
    return resp({ key: { id: 'WA' + midias.length } });
  }
  if (u.includes('evolution.exemplo.com')) return resp({});
  return realFetch(url, opts);
};

// ---- SEFAZ falsa (só autoriza)
_setTransportForTests(async ({ url, body }) => {
  const wrap = (inner) => `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;
  const chave = (body.match(/Id="NFe(\d{44})"/) || [])[1];
  if (url.includes('cadconsultacadastro')) return wrap('<retConsCad><infCons><cStat>259</cStat><xMotivo>nao contribuinte</xMotivo></infCons></retConsCad>');
  if (url.includes('NFeAutorizacao4')) {
    return wrap(`<retEnviNFe><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>2026-11-24T10:00:00-03:00</dhRecbto><nProt>243260000000001</nProt><digVal>x</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retEnviNFe>`);
  }
  throw new Error('serviço inesperado ' + url);
});

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

// ---- Hermes falso
const eventos = [];
const hermes = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    eventos.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => hermes.listen(3141, r));

const server = app.listen(3140);
const B = 'http://localhost:3140/api';
const ADMIN = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token', 'X-Classul-User': 'Lucas' };
const CHAVE = 'chave-hermes-agentes';
const HER = { 'Content-Type': 'application/json', Authorization: `Bearer ${CHAVE}` };

let falhas = 0;
const check = (nome, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nome}${extra ? ' — ' + extra : ''}`);
  if (!cond) falhas++;
};
const call = async (tool, args = {}) => {
  const r = await fetch(`${B}/hermes/call`, { method: 'POST', headers: HER, body: JSON.stringify({ tool, args }) });
  return (await r.json());
};
const api = async (method, p, body, headers = ADMIN) => {
  const r = await fetch(B + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), ct };
};
const esperaEvento = async (nome) => {
  for (let i = 0; i < 40; i++) {
    const e = eventos.find((x) => x.event === nome || x.evento === nome || x.name === nome);
    if (e) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

try {
  await ensureSchema();
  await setSettings({
    hermes_token: CHAVE,
    hermes_enabled: '1',
    hermes_webhook_url: 'http://localhost:3141/webhook',
    evolution_url: 'https://evolution.exemplo.com',
    evolution_apikey: 'fake',
    evolution_instance: 'classul',
    google_client_id: 'cid',
    google_client_secret: 'csec',
    google_refresh_token: 'rtok'
  });

  // ---------------------------------------------------------------- agentes
  let r = await call('agentes_listar');
  const slugs = r.result?.agentes?.map((a) => a.slug) || [];
  check('6 agentes padrão', ['artes', 'notas', 'duvidas', 'pendencias', 'orcamentos', 'descontos'].every((s) => slugs.includes(s)), slugs.join(','));
  check('arte automática começa desligada', r.result.arte_automatica === false);

  r = await call('agente_criar', { nome: 'Entregas do dia', descricao: 'O que sai hoje' });
  check('Hermes cria agente novo', r.ok && r.result.slug === 'entregas-do-dia', r.error);
  r = await call('agente_criar', { nome: 'Entregas do dia' });
  check('criar de novo devolve o mesmo', r.ok && r.result.ja_existia === true);

  // ---------------------------------------------------------------- arte para aprovar
  const jpg = Buffer.from('ffd8ffe000104a46494600', 'hex');
  r = await call('subir_arquivo', { base64: jpg.toString('base64'), nome: 'arte-maria-16x25.jpg' });
  const refArte = r.result?.ref;
  check('sobe a arte e devolve ref drive:', r.ok && /^drive:arq\d+$/.test(refArte), r.error);
  check('arte cai na pasta Classul - Agentes', [...drive.values()].some((f) => f.name === 'Classul - Agentes'));

  r = await call('subir_arquivo', { base64: Buffer.alloc(3.2 * 1024 * 1024).toString('base64'), nome: 'grande.jpg' });
  check('arquivo acima de 3 MB recusado', !r.ok && /3 MB/.test(r.error));

  r = await call('agente_postar', {
    agente: 'artes',
    tipo: 'aprovacao',
    texto: 'Maria Souza (5551999990000): placa 16x25, estojo preto, 1 unidade, R$ 378,00',
    anexos: [{ ref: refArte, nome: 'arte.jpg' }],
    referencia: '5551999990000'
  });
  const msgArte = r.result;
  check('arte vai para aprovação com código', r.ok && msgArte.estado === 'pendente' && /^ART\d+$/.test(msgArte.codigo), r.error);

  r = await call('agente_postar', { agente: 'nao-existe', texto: 'oi' });
  check('agente que não existe dá erro claro', !r.ok && /não existe/.test(r.error));

  let t = await api('GET', '/agentes');
  const artes = t.body.agentes.find((a) => a.slug === 'artes');
  check('tela mostra 1 esperando e 1 não lida em Artes', artes.esperando_lucas === 1 && artes.nao_lidas === 1);

  t = await api('GET', `/agentes/arquivo?ref=${encodeURIComponent(refArte)}`);
  check('tela abre a imagem da arte', t.status === 200 && t.ct.startsWith('image/jpeg') && t.body.equals(jpg));
  t = await api('GET', '/agentes/arquivo?ref=nfe:1:pdf');
  check('tela só abre arquivo do Drive por aqui', t.status === 400);

  t = await api('GET', '/agentes/artes/mensagens');
  check('abrir o chat marca como lida', t.body.mensagens.length === 1 && (await api('GET', '/agentes')).body.agentes.find((a) => a.slug === 'artes').nao_lidas === 0);

  t = await api('POST', `/agentes/mensagens/${msgArte.id}/decidir`, { decisao: 'corrigir' });
  check('corrigir sem dizer o quê é recusado', t.status === 400);
  t = await api('POST', `/agentes/mensagens/${msgArte.id}/decidir`, { decisao: 'aprovado' });
  check('Lucas aprova a arte', t.status === 200 && t.body.estado === 'aprovado' && t.body.respondido_por === 'Lucas');
  let ev = await esperaEvento('agente.resposta');
  check('Hermes recebe agente.resposta com o código', ev && JSON.stringify(ev).includes(msgArte.codigo) && JSON.stringify(ev).includes('aprovado'), JSON.stringify(ev || {}).slice(0, 200));
  t = await api('POST', `/agentes/mensagens/${msgArte.id}/decidir`, { decisao: 'aprovado' });
  check('não decide duas vezes', t.status === 400);

  r = await call('agente_respostas');
  check('agente_respostas entrega a decisão', r.ok && r.result.some((x) => x.codigo === msgArte.codigo));
  r = await call('agente_respostas');
  check('e não entrega duas vezes', r.ok && !r.result.some((x) => x.codigo === msgArte.codigo));

  // ---------------------------------------------------------------- dúvida
  r = await call('agente_postar', { agente: 'duvidas', tipo: 'pergunta', texto: 'Cliente quer 30 placas 9x14 para sábado. Dá?' });
  t = await api('POST', `/agentes/mensagens/${r.result.id}/decidir`, { decisao: 'respondido' });
  check('pergunta exige resposta escrita', t.status === 400);
  t = await api('POST', `/agentes/mensagens/${r.result.id}/decidir`, { resposta: 'Dá, mas só na segunda.' });
  check('Lucas responde a dúvida', t.status === 200 && t.body.estado === 'respondido');

  t = await api('POST', '/agentes/pendencias/mensagens', { texto: 'Me avisa quando o vermelho chegar' });
  check('Lucas escreve livre no chat', t.status === 201 && t.body.autor === 'lucas');
  ev = await esperaEvento('agente.mensagem');
  check('Hermes recebe agente.mensagem', Boolean(ev));

  t = await api('PUT', '/agentes/arte-automatica', { ligado: true });
  r = await call('agentes_listar');
  check('Lucas libera arte automática e o Hermes vê', t.body.arte_automatica === true && r.result.arte_automatica === true);

  // ---------------------------------------------------------------- pedido + anexo
  r = await call('criar_pedido', { customer_name: 'Maria Souza', phone: '5551999990000', product: 'Placa de homenagem', size: '16x25', case_color: 'preto', description: 'Quantidade: 1', value: '378,00' });
  const pedido = r.result?.order_number || r.result?.numero || String(r.result?.id || '');
  check('cria pedido', r.ok && pedido, r.error);
  r = await call('anexar_arquivo_pedido', { pedido, ref: refArte, nome: 'arte aprovada.jpg', categoria: 'arte' });
  check('anexa a arte aprovada ao pedido', r.ok && r.result.categoria === 'arte' && r.result.ref.startsWith('drive:'), r.error);
  r = await call('anexar_arquivo_pedido', { pedido, base64: Buffer.from('%PDF-1.4 vetor').toString('base64'), nome: 'vetor CMYK.pdf' });
  check('anexa o vetor em base64', r.ok && r.result.nome === 'vetor CMYK.pdf', r.error);
  r = await call('arquivos_do_pedido', { numero: pedido });
  check('pedido lista os 2 anexos', r.ok && JSON.stringify(r.result).includes('vetor CMYK.pdf') && JSON.stringify(r.result).includes('arte aprovada.jpg'), r.error);
  r = await call('anexar_arquivo_pedido', { pedido: '9999', ref: refArte });
  check('pedido inexistente dá erro', !r.ok);

  r = await call('enviar_arquivo', { telefone: '5551999990000', ref: refArte, como_imagem: true, legenda: 'Segue a arte' });
  check('manda a arte ao cliente como foto', r.ok && r.result.como === 'imagem' && midias.at(-1).mediatype === 'image', r.error);

  // ---------------------------------------------------------------- orçamento
  r = await call('gerar_orcamento', { destinatario: 'Escola Teste', itens: [{ descricao: 'Placa de homenagem 16x25 com estojo', quantidade: 5, valor_unitario: 378 }], enviar_para: '5551999990000' });
  check('gera orçamento, manda PDF e guarda', r.ok && r.result.total === 1890 && r.result.enviado_para === '5551999990000' && midias.at(-1).mediatype === 'document', r.error);
  const pdf = drive.get(r.result.ref.slice(6));
  check('PDF de verdade', pdf && pdf.buffer.slice(0, 4).toString() === '%PDF');
  t = await api('GET', '/agentes/orcamentos/mensagens');
  check('agente Orçamentos recebeu o aviso com o PDF', t.body.mensagens.some((m) => m.anexos[0]?.ref === r.result.ref && /1\.890/.test(m.texto)));
  r = await call('gerar_orcamento', { destinatario: '', itens: [] });
  check('orçamento sem dados diz o que falta', !r.ok && /Falta/.test(r.error));

  // ---------------------------------------------------------------- nota fiscal
  t = await api('POST', '/nfe/pin', { pin: '2468' });
  const NH = { ...ADMIN, 'X-Nfe-Token': t.body.token };
  await api('POST', '/nfe/certificado', { pfx: pfxDeTeste('segredo'), senha: 'segredo' }, NH);
  t = await api('POST', '/nfe/produtos', { codigo: '102', descricao: 'PLACA ACO TAM 16X25CM C/ EST', ncm: '8310.00.00', cfop_dentro: '5101', cfop_fora: '6101', valor: 378 }, NH);
  const produto = t.body;

  const cliente = { documento: '529.982.247-25', nome: 'Maria Souza', email: 'maria@exemplo.com', cep: '90540-031', logradouro: 'Rua Teste', numero: '10', bairro: 'Centro', municipio: 'Porto Alegre', cod_municipio: '4314902', uf: 'RS' };
  r = await call('nf_rascunho', { cliente: { ...cliente, cep: '' }, itens: [{ produto_id: produto.id, quantidade: 1, valor_unitario: 378 }] });
  check('rascunho sem CEP diz o que falta', !r.ok && /CEP/.test(r.error), r.error);
  r = await call('nf_rascunho', { cliente, itens: [{ produto_id: 999, quantidade: 1, valor_unitario: 378 }] });
  check('produto inexistente recusado', !r.ok && /produto_id/.test(r.error));
  r = await call('nf_rascunho', { cliente, itens: [{ produto_id: produto.id, quantidade: 1, valor_unitario: 378 }], pedido, telefone_cliente: '5551999990000' });
  const rasc = r.result;
  check('Hermes monta o rascunho da nota', r.ok && rasc.estado === 'aguardando' && rasc.total === 378 && /^NOT\d+$/.test(rasc.codigo), r.error);
  check('rascunho mostra CFOP e ambiente', /CFOP 5101/.test(rasc.resumo) && /HOMOLOGAÇÃO/.test(rasc.resumo));

  const toolsNomes = (await (await fetch(`${B}/hermes/tools`, { headers: HER })).json()).tools.map((x) => x.name);
  check('não existe ferramenta do Hermes que aprove ou emita nota', !toolsNomes.some((n) => /aprov|emit/.test(n) && n !== 'nfe_situacao'), toolsNomes.filter((n) => /nf/.test(n)).join(','));
  const atend = (await (await fetch(`${B}/hermes/tools?perfil=atendimento`, { headers: HER })).json()).tools.map((x) => x.name);
  check('perfil atendimento vê os agentes mas não a nota', atend.includes('agente_postar') && !atend.includes('nf_rascunho'));

  t = await api('GET', '/agentes/notas/mensagens');
  const msgNf = t.body.mensagens.find((m) => m.tipo === 'nf');
  t = await api('POST', `/agentes/mensagens/${msgNf.id}/decidir`, { decisao: 'aprovado' });
  check('nota não se aprova pelo botão comum', t.status === 400);
  t = await api('POST', `/agentes/mensagens/${msgNf.id}/aprovar-nf`, {});
  check('aprovar nota sem PIN das Notas é bloqueado', t.status === 403 && t.body.nfe_locked);

  t = await api('POST', `/agentes/mensagens/${msgNf.id}/aprovar-nf`, {}, NH);
  check('Lucas aprova com PIN e a nota sai', t.status === 200 && t.body.estado === 'emitida', JSON.stringify(t.body).slice(0, 200));
  ev = await esperaEvento('nf.emitida');
  check('Hermes recebe nf.emitida com a ref do PDF e o telefone', ev && /nfe:\d+:pdf/.test(JSON.stringify(ev)) && JSON.stringify(ev).includes('5551999990000'), JSON.stringify(ev || {}).slice(0, 200));
  r = await call('nf_rascunhos', {});
  check('rascunho fica como emitida', r.ok && r.result[0].estado === 'emitida' && r.result[0].ref_pdf);
  t = await api('POST', `/agentes/mensagens/${msgNf.id}/aprovar-nf`, {}, NH);
  check('não emite a mesma nota duas vezes', t.status === 400);

  r = await call('nf_rascunho', { cliente, itens: [{ produto_id: produto.id, quantidade: 2, valor_unitario: 378 }] });
  t = await api('GET', '/agentes/notas/mensagens');
  const msgNf2 = t.body.mensagens.filter((m) => m.tipo === 'nf').at(-1);
  t = await api('POST', `/agentes/mensagens/${msgNf2.id}/decidir`, { decisao: 'corrigir', resposta: 'É 1 unidade só' });
  check('Lucas pede correção da nota', t.status === 200 && t.body.estado === 'corrigir');
  r = await call('nf_rascunhos', { estado: 'corrigir' });
  check('rascunho marcado para corrigir', r.ok && r.result.length === 1);

  // ---------------------------------------------------------------- testar atendente
  const evolutionAntes = midias.length;
  t = await api('POST', '/testes', { nome: 'Maria (escola)' });
  const tel = t.body.telefone;
  check('cria cliente de teste com telefone falso', t.status === 201 && /^5500000\d{6}$/.test(tel));
  t = await api('POST', `/testes/${tel}/mensagens`, { texto: 'Boa tarde, quero uma placa de homenagem' });
  check('mensagem do teste chega ao Hermes', t.status === 201 && t.body.entregue_ao_hermes === true, JSON.stringify(t.body));
  ev = eventos.filter((e) => e.event === 'mensagem.recebida').at(-1);
  check('evento vem marcado como teste, igual ao do WhatsApp', ev?.data?.teste === true && ev.data.telefone === tel && ev.data.atender === true);

  r = await call('enviar_mensagem', { telefone: tel, texto: 'Boa tarde, segue a tabela.' });
  check('Hermes responde o cliente de teste com a ferramenta de sempre', r.ok, r.error);
  r = await call('enviar_foto', { telefone: tel, url: 'https://sistema-classul.vercel.app/bot-fotos/tabela-homenagem.jpg' });
  r = await call('enviar_arquivo', { telefone: tel, ref: refArte, como_imagem: true, legenda: 'Arte para aprovar' });
  check('arte vai para o teste como foto', r.ok && r.result.como === 'imagem', r.error);
  check('nada saiu pela Evolution', midias.length === evolutionAntes);
  t = await api('GET', `/testes/${tel}`);
  const tipos = t.body.mensagens.map((m) => `${m.de}:${m.tipo}`);
  check('conversa de teste mostra tudo em ordem', JSON.stringify(tipos) === JSON.stringify(['cliente:texto', 'atendente:texto', 'atendente:imagem', 'atendente:imagem']), tipos.join(','));
  const fotoArte = t.body.mensagens.at(-1).arquivo;
  t = await api('GET', `/testes/arquivo/${fotoArte.ref.split(':')[1]}`);
  check('tela abre a arte mandada no teste', t.status === 200 && t.body.equals(jpg));
  r = await call('historico_conversa', { telefone: tel });
  check('historico_conversa funciona no teste', r.ok && r.result.mensagens.length === 2 && r.result.mensagens[0].role === 'user');

  const logo = Buffer.from('89504e470d0a1a0a', 'hex');
  t = await api('POST', `/testes/${tel}/mensagens`, { texto: 'segue a logo', imagem_base64: logo.toString('base64'), arquivo_nome: 'logo.png', arquivo_mime: 'image/png' });
  ev = eventos.filter((e) => e.event === 'mensagem.recebida').at(-1);
  check('logo do cliente de teste vai com ref', /^teste:\d+$/.test(ev?.data?.arquivo?.ref || ''));
  r = await call('baixar_arquivo', { ref: ev.data.arquivo.ref });
  check('Hermes baixa a logo do teste', r.ok && Buffer.from(r.result.base64, 'base64').equals(logo), r.error);

  r = await call('agente_postar', { agente: 'artes', tipo: 'aprovacao', texto: 'Teste: arte da Maria', referencia: tel, anexos: [{ ref: refArte }] });
  r = await call('criar_pedido', { customer_name: 'Maria (escola)', phone: tel, product: 'Placa de homenagem' });
  const pedidoTeste = r.result?.id;
  r = await call('nf_rascunho', { cliente, itens: [{ produto_id: produto.id, quantidade: 1, valor_unitario: 378 }], telefone_cliente: tel });
  check('rascunho de teste avisa que não emite', r.ok && /CONVERSA DE TESTE/.test(r.result.resumo), r.error);
  t = await api('GET', '/agentes/notas/mensagens');
  const msgNfTeste = t.body.mensagens.filter((m) => m.tipo === 'nf').at(-1);
  const notasAntes = (await call('notas_listar', {})).result;
  t = await api('POST', `/agentes/mensagens/${msgNfTeste.id}/aprovar-nf`, {}, NH);
  const notasDepois = (await call('notas_listar', {})).result;
  check('aprovar nota de teste não emite nada', t.status === 200 && JSON.stringify(notasAntes) === JSON.stringify(notasDepois), JSON.stringify(t.body).slice(0, 150));
  ev = eventos.filter((e) => e.event === 'nf.emitida').at(-1);
  check('Hermes recebe nf.emitida marcado como teste', ev?.data?.teste === true && ev.data.ref_pdf === null);

  t = await api('DELETE', `/testes/${tel}`);
  check('apaga a conversa de teste', t.status === 200 && t.body.pedidos_arquivados === 1, JSON.stringify(t.body));
  t = await api('GET', '/testes');
  check('conversa some da lista', !t.body.some((c) => c.telefone === tel));
  t = await api('GET', '/agentes/artes/mensagens');
  check('avisos do teste somem dos agentes', !t.body.mensagens.some((m) => m.referencia === tel));
  r = await call('buscar_pedido', { id: pedidoTeste });
  check('pedido do teste foi arquivado, não apagado', r.ok && Number(r.result.archived) === 1, JSON.stringify(r.result || r.error).slice(0, 100));
  r = await call('enviar_mensagem', { telefone: tel, texto: 'oi' });
  check('mandar para conversa apagada dá erro', !r.ok);

  // ---------------------------------------------------------------- só o atendente novo
  await setSettings({ bot_webhook_secret: 'seg', bot_engine: 'interno' });
  const upsert = (num, texto) => ({ event: 'messages.upsert', data: { key: { remoteJid: `${num}@s.whatsapp.net`, fromMe: false, id: 'X' + Math.random() }, pushName: 'Cliente', message: { conversation: texto } } });
  let w = await (await fetch(`${B}/bot/webhook?secret=seg`, { method: 'POST', headers: ADMIN, body: JSON.stringify(upsert('5551977776666', 'oi')) })).json();
  check('"interno" antigo no banco vale como desligado', w.bot?.ignored === 'pré-atendimento desligado');
  await setSettings({ bot_engine: 'hermes', bot_test_number: '5551900001111' });
  w = await (await fetch(`${B}/bot/webhook?secret=seg`, { method: 'POST', headers: ADMIN, body: JSON.stringify(upsert('5551977776666', 'oi')) })).json();
  check('com número de teste, cliente real vai como não atender', w.bot?.atender === false && /fase de teste/.test(w.bot?.motivo));
  w = await (await fetch(`${B}/bot/webhook?secret=seg`, { method: 'POST', headers: ADMIN, body: JSON.stringify(upsert('5551900001111', 'oi')) })).json();
  check('o número de teste é atendido', w.bot?.atender === true);
  t = await api('PUT', '/hermes/config', { engine: 'interno' });
  check('não dá mais para escolher o bot antigo', t.status === 400);
} catch (err) {
  console.error(err);
  falhas++;
} finally {
  server.close();
  hermes.close();
  console.log(falhas ? `\n${falhas} falha(s).` : '\nTudo certo nos agentes.');
  process.exit(falhas ? 1 : 0);
}
