// Placas montadas pelo cliente na landing page: guarda JPG e SVG no Drive, mostra o
// histórico no sistema e devolve a imagem na conversa quando o cliente envia a mensagem.
import crypto from 'node:crypto';
import { q, getSettings } from './db.js';
import { ensurePlatesFolder, uploadBufferToFolder } from './google.js';
import { sendImageUrl } from './whatsapp.js';

export const PLATE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const LIMITS = { jpg: 1.5 * 1024 * 1024, svg: 2.5 * 1024 * 1024, logo: 1.6 * 1024 * 1024 };
const PER_IP_PER_HOUR = 30;
const ALL_PER_HOUR = 300;
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const FIELD_MAX = { name: 34, title: 50, body: 320, line: 40, from: 70, size: 8, frame: 12, color: 12, occ: 12, date: 10 };

export class PlateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const decode = (b64) => Buffer.from(String(b64 || ''), 'base64');

function cleanData(data) {
  const out = {};
  for (const [k, max] of Object.entries(FIELD_MAX)) out[k] = String(data?.[k] ?? '').slice(0, max);
  return out;
}

// O SVG só sai do sistema como download, mas não guardamos nada que possa executar código.
export function isSafeSvg(svg) {
  return /^<\?xml[^>]*\?>\s*<svg[\s>]/.test(svg)
    && !/<script|<foreignObject|<iframe|\son\w+\s*=|javascript:/i.test(svg);
}

function hashIp(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  return crypto.createHash('sha256').update(`${process.env.API_TOKEN || ''}:${ip}`).digest('hex').slice(0, 32);
}

async function checkRate(ipHash) {
  const since = new Date(Date.now() - 3600 * 1000);
  const { rows } = await q(
    `SELECT COUNT(*)::int AS total, COALESCE(SUM(CASE WHEN ip_hash = $1 THEN 1 ELSE 0 END), 0)::int AS mine
       FROM plate_designs WHERE created_at > $2`,
    [ipHash, since]
  );
  if (rows[0].mine >= PER_IP_PER_HOUR || rows[0].total >= ALL_PER_HOUR) {
    throw new PlateError('Muitas placas em pouco tempo. Tente de novo mais tarde.', 429);
  }
}

export async function savePlate(req) {
  const body = req.body || {};
  const token = String(body.token || '');
  if (!PLATE_TOKEN.test(token)) throw new PlateError('Código da placa inválido.');

  const { rows: found } = await q('SELECT id FROM plate_designs WHERE token = $1', [token]);
  if (found[0]) return { token, id: found[0].id };

  const jpg = decode(body.jpg);
  if (!jpg.length || jpg.length > LIMITS.jpg || jpg[0] !== 0xff || jpg[1] !== 0xd8 || jpg[2] !== 0xff) {
    throw new PlateError('Imagem da placa inválida.');
  }
  const svg = String(body.svg || '');
  if (!svg || Buffer.byteLength(svg) > LIMITS.svg || !isSafeSvg(svg)) throw new PlateError('Vetor da placa inválido.');

  let logo = null;
  if (body.logo?.data) {
    const mime = String(body.logo.type || '');
    const buffer = decode(body.logo.data);
    if (!LOGO_TYPES[mime] || !buffer.length || buffer.length > LIMITS.logo) throw new PlateError('Logo inválida.');
    logo = { mime, buffer, ext: LOGO_TYPES[mime] };
  }

  const ipHash = hashIp(req);
  await checkRate(ipHash);

  const data = cleanData(body.data);
  const folderId = await ensurePlatesFolder();
  const base = `placa-${token.slice(0, 8)}`;
  const jpgFile = await uploadBufferToFolder(folderId, { name: `${base}.jpg`, mimeType: 'image/jpeg', buffer: jpg });
  const svgFile = await uploadBufferToFolder(folderId, { name: `${base}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  const logoFile = logo
    ? await uploadBufferToFolder(folderId, { name: `${base}-logo.${logo.ext}`, mimeType: logo.mime, buffer: logo.buffer })
    : null;

  const { rows } = await q(
    `INSERT INTO plate_designs
       (token, data, jpg_file_id, svg_file_id, logo_file_id, logo_mime, ip_hash, page, utm_source, utm_campaign)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [token, JSON.stringify(data), jpgFile.id, svgFile.id, logoFile?.id || null, logo?.mime || null, ipHash,
      clip(body.page, 120), clip(body.utm_source, 60), clip(body.utm_campaign, 80)]
  );
  return { token, id: rows[0].id };
}

export async function getPlateByToken(token) {
  const { rows } = await q('SELECT * FROM plate_designs WHERE token = $1', [token]);
  return rows[0] || null;
}

export async function getPlateById(id) {
  const { rows } = await q('SELECT * FROM plate_designs WHERE id = $1', [Number(id) || 0]);
  return rows[0] || null;
}

export async function listPlates(limit = 60) {
  const { rows } = await q(
    `SELECT id, token, data, logo_file_id, phone, push_name, image_sent_at, image_error, utm_source, utm_campaign, created_at
       FROM plate_designs ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data || '{}'), has_logo: Boolean(r.logo_file_id), logo_file_id: undefined }));
}

function messageText(message) {
  if (!message) return '';
  return message.conversation || message.extendedTextMessage?.text || '';
}

// Quando o cliente envia a mensagem montada no site, ela traz o link da placa.
// O WhatsApp não aceita imagem em link de conversa, então a imagem chega por aqui.
export async function handlePlateMessage(body, siteBase) {
  const data = body?.data || {};
  const key = data.key || {};
  if (key.fromMe) return { ignored: 'mensagem nossa' };
  const jid = String(key.remoteJid || '');
  if (jid.endsWith('@g.us') || jid.includes('broadcast')) return { ignored: 'não é conversa individual' };
  const match = messageText(data.message).match(/\/api\/plates\/([A-Za-z0-9_-]{22})/);
  if (!match) return { ignored: 'sem placa' };

  const pnJid = String(key.senderPn || (jid.endsWith('@s.whatsapp.net') ? jid : ''));
  const phone = pnJid.split('@')[0].replace(/\D/g, '') || null;
  const token = match[1];
  const pushName = clip(data.pushName, 80);
  if (!phone) return { ignored: 'sem telefone' };

  const plate = await getPlateByToken(token);
  if (!plate) return { ignored: 'placa não encontrada' };
  await q('UPDATE plate_designs SET phone = $1, push_name = COALESCE($2, push_name) WHERE id = $3', [phone, pushName, plate.id]);

  const settings = await getSettings();
  if (settings.plate_send_image === 'false') return { ignored: 'envio desligado', id: plate.id };

  // A trava é a própria linha: duas entregas do mesmo webhook não mandam a imagem duas vezes.
  const { rows } = await q(
    'UPDATE plate_designs SET image_sent_at = now(), image_error = NULL WHERE id = $1 AND image_sent_at IS NULL RETURNING id',
    [plate.id]
  );
  if (!rows[0]) return { ignored: 'imagem já enviada', id: plate.id };
  try {
    await sendImageUrl(
      phone,
      `${siteBase}/api/plates/${token}/image.jpg`,
      'Recebemos a placa que você montou no site. Esta é uma prévia: nossa equipe confere e prepara a arte final para a sua aprovação.'
    );
    return { sent: true, id: plate.id };
  } catch (err) {
    await q('UPDATE plate_designs SET image_sent_at = NULL, image_error = $1 WHERE id = $2', [String(err.message).slice(0, 300), plate.id]);
    return { error: err.message, id: plate.id };
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Página do link da mensagem: é ela que dá a miniatura da placa na conversa.
export function platePage(plate, siteBase) {
  const data = JSON.parse(plate.data || '{}');
  const img = `${siteBase}/api/plates/${plate.token}/image.jpg`;
  const title = `Placa de homenagem${data.name ? ` para ${data.name}` : ''}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} | Classul</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Prévia da placa montada no site da Classul.">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:type" content="website">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101216;color:#efece6;font:16px system-ui,sans-serif;text-align:center;padding:16px;box-sizing:border-box}img{max-width:min(100%,900px);height:auto;border-radius:10px}p{color:#a9abb1;margin:14px 0 0}</style>
</head><body><main><img src="${esc(img)}" alt="${esc(title)}"><p>Prévia ilustrativa. A arte final vem para a sua aprovação antes da produção.</p></main></body></html>`;
}
