// Rotas da aba Notas (/api/nfe/*). Ficam atrás do login do sistema (Bearer) e, além
// disso, de um PIN próprio — igual à aba Finanças: quem sabe o PIN recebe um token
// (derivado do hash do PIN) que vai no header X-Nfe-Token.
import crypto from 'crypto';
import * as svc from './service.js';
import { painel, lerFiltros } from './faturamento.js';
import { gerarDanfe } from './danfe.js';
import { sendDocument, normalizePhone } from '../whatsapp.js';

const APP_SECRET = () => process.env.APP_SECRET || process.env.API_TOKEN || 'classul';
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hashPin = (pin) => sha256(`${APP_SECRET()}:nfe-pin:${pin}`);
const tokenFor = (pinHash) => sha256(`${APP_SECRET()}:nfe:${pinHash}`);

function wrap(fn) {
  return (req, res) =>
    Promise.resolve()
      .then(() => svc.ensureNfeSchema())
      .then(() => fn(req, res))
      .catch((err) => {
        const known =
          err instanceof svc.NfeError || err instanceof svc.NfeDataError || err instanceof svc.CertError || err instanceof svc.SefazError;
        if (!known) console.error('nfe:', err);
        if (!res.headersSent) res.status(err.status || (known ? 400 : 500)).json({ error: err.message });
      });
}

async function requireNfe(req, res, next) {
  try {
    await svc.ensureNfeSchema();
    const pinHash = await svc.getPinHash();
    if (!pinHash) return res.status(403).json({ error: 'Defina um PIN para a aba Notas.', nfe_locked: true });
    if ((req.headers['x-nfe-token'] || '') !== tokenFor(pinHash)) {
      return res.status(403).json({ error: 'Notas bloqueadas.', nfe_locked: true });
    }
    next();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

const userOf = (req) => {
  const u = req.headers['x-classul-user'];
  return u ? String(u).trim().slice(0, 60) || null : null;
};

const nomeArquivo = (nota) => `NFe-${String(nota.numero).padStart(6, '0')}-serie${nota.serie}`;

export function registerNfeRoutes(app) {
  // ---- Faturamento (só login, como a aba Faturamento sempre foi): notas autorizadas em produção.
  app.get('/api/faturamento', wrap(async (req, res) => {
    res.json(await painel(lerFiltros(req.query)));
  }));

  // ---- PIN (só login)
  app.get('/api/nfe/status', wrap(async (req, res) => {
    res.json({ has_pin: Boolean(await svc.getPinHash()) });
  }));

  app.post('/api/nfe/pin', wrap(async (req, res) => {
    const pin = String(req.body?.pin || '').trim();
    if (pin.length < 4) return res.status(400).json({ error: 'O PIN precisa ter pelo menos 4 dígitos.' });
    const current = await svc.getPinHash();
    if (current && hashPin(String(req.body?.current_pin || '').trim()) !== current) {
      return res.status(403).json({ error: 'PIN atual incorreto.' });
    }
    const h = hashPin(pin);
    await svc.setPinHash(h);
    res.json({ ok: true, token: tokenFor(h) });
  }));

  app.post('/api/nfe/unlock', wrap(async (req, res) => {
    const h = await svc.getPinHash();
    if (!h) return res.status(400).json({ error: 'Nenhum PIN configurado ainda.', no_pin: true });
    if (hashPin(String(req.body?.pin || '').trim()) !== h) return res.status(403).json({ error: 'PIN incorreto.' });
    res.json({ ok: true, token: tokenFor(h) });
  }));

  // ---- Configuração
  app.get('/api/nfe/config', requireNfe, wrap(async (req, res) => {
    res.json({ ...(await svc.getConfig()), formas_pagamento: svc.FORMAS_PAGAMENTO });
  }));
  app.put('/api/nfe/config', requireNfe, wrap(async (req, res) => res.json(await svc.saveConfig(req.body || {}))));

  app.post('/api/nfe/certificado', requireNfe, wrap(async (req, res) => {
    const { pfx, senha } = req.body || {};
    if (!pfx || !senha) return res.status(400).json({ error: 'Envie o arquivo .pfx e a senha.' });
    res.json(await svc.saveCertificate(String(pfx), String(senha)));
  }));

  app.post('/api/nfe/logo', requireNfe, wrap(async (req, res) => {
    await svc.saveLogo(req.body?.imagem);
    res.json(await svc.getConfig());
  }));
  // Prévia da logo como imagem (para a tela de Configurar).
  app.get('/api/nfe/logo', requireNfe, wrap(async (req, res) => {
    const logo = await svc.getLogo();
    if (!logo) return res.status(404).json({ error: 'Sem logo.' });
    res.setHeader('Content-Type', logo.mime);
    res.send(Buffer.from(logo.base64, 'base64'));
  }));
  app.get('/api/nfe/sefaz-status', requireNfe, wrap(async (req, res) => res.json(await svc.sefazStatus())));

  // ---- Cadastros
  app.get('/api/nfe/produtos', requireNfe, wrap(async (req, res) => res.json(await svc.listarProdutos())));
  app.post('/api/nfe/produtos', requireNfe, wrap(async (req, res) => res.json(await svc.salvarProduto(null, req.body || {}))));
  app.put('/api/nfe/produtos/:id', requireNfe, wrap(async (req, res) => res.json(await svc.salvarProduto(Number(req.params.id), req.body || {}))));

  app.get('/api/nfe/clientes', requireNfe, wrap(async (req, res) => res.json(await svc.listarClientes(req.query.q, req.query.q ? 100 : 2000))));
  app.post('/api/nfe/clientes', requireNfe, wrap(async (req, res) => res.json(await svc.salvarCliente(null, req.body || {}))));
  app.get('/api/nfe/buscar-ie', requireNfe, wrap(async (req, res) => res.json(await svc.buscarIE(req.query.cnpj, req.query.uf))));
  app.get('/api/nfe/clientes/:id/ultima', requireNfe, wrap(async (req, res) => res.json(await svc.ultimaDoCliente(Number(req.params.id)))));
  app.get('/api/nfe/notas/:id/copia', requireNfe, wrap(async (req, res) => res.json(await svc.copiaDaNota(Number(req.params.id)))));
  app.put('/api/nfe/clientes/:id', requireNfe, wrap(async (req, res) => res.json(await svc.salvarCliente(Number(req.params.id), req.body || {}))));

  // ---- Notas
  app.get('/api/nfe/resumo', requireNfe, wrap(async (req, res) => {
    const cfg = await svc.getConfig();
    res.json(await svc.resumo(req.query.ambiente || cfg.ambiente));
  }));
  app.get('/api/nfe/notas', requireNfe, wrap(async (req, res) => {
    const cfg = await svc.getConfig();
    res.json(
      await svc.listarNotas({
        busca: req.query.q,
        situacao: req.query.situacao,
        mes: req.query.mes,
        ambiente: req.query.ambiente || cfg.ambiente,
        limit: Number(req.query.limit) || 100,
        offset: Number(req.query.offset) || 0
      })
    );
  }));
  app.get('/api/nfe/notas/:id', requireNfe, wrap(async (req, res) => {
    const n = await svc.getNota(Number(req.params.id));
    delete n.xml;
    delete n.xml_proc;
    res.json(n);
  }));
  app.post('/api/nfe/emitir', requireNfe, wrap(async (req, res) => {
    const n = await svc.emitir(req.body || {}, userOf(req));
    delete n.xml;
    delete n.xml_proc;
    res.json(n);
  }));
  app.post('/api/nfe/notas/:id/consultar', requireNfe, wrap(async (req, res) => {
    const r = await svc.consultarNota(Number(req.params.id));
    delete r.nota.xml;
    delete r.nota.xml_proc;
    res.json(r);
  }));
  app.post('/api/nfe/notas/:id/cancelar', requireNfe, wrap(async (req, res) => {
    const n = await svc.cancelar(Number(req.params.id), req.body?.justificativa, userOf(req));
    delete n.xml;
    delete n.xml_proc;
    res.json(n);
  }));
  app.post('/api/nfe/notas/:id/cce', requireNfe, wrap(async (req, res) => {
    const n = await svc.cartaCorrecao(Number(req.params.id), req.body?.correcao, userOf(req));
    delete n.xml;
    delete n.xml_proc;
    res.json(n);
  }));

  app.get('/api/nfe/notas/:id/danfe', requireNfe, wrap(async (req, res) => {
    const n = await svc.getNota(Number(req.params.id));
    const xml = n.xml_proc || n.xml;
    if (!xml) return res.status(404).json({ error: 'Nota sem XML.' });
    const pdf = await gerarDanfe(xml, { cancelada: n.situacao === 'cancelada', logo: await svc.getLogo() });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo(n)}.pdf"`);
    res.send(pdf);
  }));

  app.get('/api/nfe/notas/:id/xml', requireNfe, wrap(async (req, res) => {
    const n = await svc.getNota(Number(req.params.id));
    if (!n.xml_proc) return res.status(404).json({ error: 'Esta nota não tem XML autorizado.' });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${n.chave}-procNFe.xml"`);
    res.send(n.xml_proc);
  }));

  app.get('/api/nfe/eventos/:id/xml', requireNfe, wrap(async (req, res) => {
    const e = await svc.getEventoXml(Number(req.params.id));
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="evento-${e.tipo}-${req.params.id}.xml"`);
    res.send(e.xml);
  }));

  // Manda PDF (e o XML) para o WhatsApp do cliente pela Evolution do sistema.
  app.post('/api/nfe/notas/:id/whatsapp', requireNfe, wrap(async (req, res) => {
    const n = await svc.getNota(Number(req.params.id));
    if (!['autorizada', 'cancelada'].includes(n.situacao) || !n.xml_proc) {
      return res.status(400).json({ error: 'Só dá para enviar nota autorizada.' });
    }
    const phone = normalizePhone(req.body?.telefone);
    if (!phone) return res.status(400).json({ error: 'Informe um telefone válido.' });
    const pdf = await gerarDanfe(n.xml_proc, { cancelada: n.situacao === 'cancelada', logo: await svc.getLogo() });
    const legenda = req.body?.mensagem || `Segue a nota fiscal nº ${n.numero}. Obrigado pela compra!`;
    await sendDocument(phone, pdf.toString('base64'), `${nomeArquivo(n)}.pdf`, 'application/pdf', legenda);
    if (req.body?.com_xml !== false) {
      await sendDocument(phone, Buffer.from(n.xml_proc).toString('base64'), `${n.chave}.xml`, 'application/xml', '');
    }
    res.json({ ok: true, phone });
  }));

  // ---- Numeração
  app.post('/api/nfe/inutilizar', requireNfe, wrap(async (req, res) => res.json(await svc.inutilizarFaixa(req.body || {}, userOf(req)))));
  app.get('/api/nfe/inutilizacoes', requireNfe, wrap(async (req, res) => res.json(await svc.listarInutilizacoes())));
  app.post('/api/nfe/consultar-chave', requireNfe, wrap(async (req, res) => res.json(await svc.consultarChaveAvulsa(req.body?.chave))));

  // ---- Importação do C&K (lotes pequenos para caber no limite da Vercel)
  app.post('/api/nfe/importar', requireNfe, wrap(async (req, res) => res.json(await svc.importar(req.body || {}))));
}
