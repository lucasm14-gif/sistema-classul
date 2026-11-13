// Arquivo de conversas do WhatsApp (aba Conversas).
//
// Guarda TODAS as mensagens das conversas individuais que passam pelo webhook da
// Evolution — recebidas e enviadas — e sobe a mídia para o Drive na hora, porque o
// WhatsApp apaga o arquivo do servidor dele depois de um tempo.
//
// Não responde nada e não depende do Observador (lib/watcher.js), que continua
// cuidando só das conversas marcadas.

import { q } from './db.js';
import { fetchMediaBase64, normalizePhone } from './whatsapp.js';
import { ensureChatFolder, uploadBufferToFolder } from './google.js';

const MEDIA_KINDS = [
  ['imageMessage', 'imagem'],
  ['videoMessage', 'video'],
  ['ptvMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'documento'],
  ['stickerMessage', 'figurinha']
];

// Tira as "embalagens" que o WhatsApp põe em volta da mensagem de verdade.
function unwrap(message = {}) {
  let m = message || {};
  for (let i = 0; i < 4; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function extractText(m) {
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    '';
  if (text) return String(text).trim();
  if (m.locationMessage || m.liveLocationMessage) {
    const loc = m.locationMessage || m.liveLocationMessage;
    const where = [loc.name, loc.address].filter(Boolean).join(' — ');
    const coords = loc.degreesLatitude != null ? `https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}` : '';
    return ['📍 Localização', where, coords].filter(Boolean).join('\n');
  }
  if (m.contactMessage) return `👤 Contato: ${m.contactMessage.displayName || ''}`.trim();
  if (m.contactsArrayMessage) {
    const names = (m.contactsArrayMessage.contacts || []).map((c) => c.displayName).filter(Boolean);
    return `👤 Contatos: ${names.join(', ')}`;
  }
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    return `📊 Enquete: ${(m.pollCreationMessage || m.pollCreationMessageV3).name || ''}`.trim();
  }
  return '';
}

function findMedia(m) {
  for (const [key, kind] of MEDIA_KINDS) {
    if (m[key]) return { kind, node: m[key] };
  }
  return null;
}

// Telefone da conversa. Contas novas do WhatsApp chegam como "@lid" (um apelido
// interno); nesse caso a Evolution manda o número de verdade num campo ao lado.
function chatPhone(key = {}, data = {}) {
  const candidates = [key.remoteJid, key.remoteJidAlt, key.senderPn, data.senderPn];
  const jid = candidates.find((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
  if (!jid) return null;
  const raw = jid.split('@')[0].split(':')[0];
  return normalizePhone(raw) || raw.replace(/\D/g, '') || null;
}

function sentAt(data) {
  const ts = Number(data.messageTimestamp?.low ?? data.messageTimestamp);
  if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000).toISOString();
  return new Date().toISOString();
}

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf'
};

// Baixa a mídia na Evolution e guarda na pasta do contato no Drive.
// Nunca lança: o resultado fica gravado na própria mensagem (salva / falhou).
export async function saveMessageMedia(messageId) {
  const { rows } = await q('SELECT * FROM wa_messages WHERE id = $1', [messageId]);
  const msg = rows[0];
  if (!msg) return { error: 'mensagem não encontrada' };
  if (!msg.media_type || msg.media_type === 'figurinha') return { skipped: 'sem arquivo para guardar' };
  if (msg.media_status === 'salva') return { saved: true, already: true };
  try {
    const media = await fetchMediaBase64(msg.wa_message_id);
    const buffer = Buffer.from(media.base64, 'base64');
    const mimeType = (media.mimeType || msg.mime_type || 'application/octet-stream').split(';')[0].trim();
    const stamp = new Date(msg.sent_at).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const name = msg.file_name || media.fileName || `${msg.media_type}-${stamp}.${EXT[mimeType] || 'bin'}`;

    const chat = (await q('SELECT * FROM wa_chats WHERE phone = $1', [msg.phone])).rows[0] || { phone: msg.phone };
    const folderId = await ensureChatFolder(chat);
    const file = await uploadBufferToFolder(folderId, { name, mimeType, buffer });
    await q(
      `UPDATE wa_messages SET media_status = 'salva', media_error = NULL, drive_file_id = $1, file_name = $2,
         mime_type = $3, size = $4, web_view_link = $5 WHERE id = $6`,
      [file.id, file.name || name, mimeType, file.size ? Number(file.size) : buffer.length, file.webViewLink || null, msg.id]
    );
    return { saved: true, name: file.name || name };
  } catch (err) {
    await q("UPDATE wa_messages SET media_status = 'falhou', media_error = $1 WHERE id = $2", [
      String(err.message || err).slice(0, 300),
      msg.id
    ]);
    return { error: err.message };
  }
}

// Processa um MESSAGES_UPSERT. Nunca lança: devolve um resumo, para não derrubar o webhook.
export async function handleConversationMessage(body) {
  try {
    const data = body?.data || {};
    const key = data.key || {};
    if (!key.id) return { ignored: 'sem identificador' };
    const phone = chatPhone(key, data);
    if (!phone) return { ignored: 'não é conversa individual' };

    const m = unwrap(data.message);
    if (m.protocolMessage || m.reactionMessage || m.pollUpdateMessage) return { ignored: 'evento de conversa' };
    const media = findMedia(m);
    const text = extractText(m);
    if (!media && !text) return { ignored: 'mensagem sem conteúdo' };

    // A Evolution reentrega eventos: a mesma mensagem não entra duas vezes.
    const { rows: dup } = await q('SELECT id FROM wa_messages WHERE wa_message_id = $1 LIMIT 1', [key.id]);
    if (dup.length) return { ignored: 'mensagem já guardada', id: dup[0].id };

    const fromMe = key.fromMe ? 1 : 0;
    const when = sentAt(data);
    const wantsFile = media && media.kind !== 'figurinha';
    let id;
    try {
      const { rows } = await q(
        `INSERT INTO wa_messages (phone, wa_message_id, from_me, push_name, body, media_type, media_status, file_name, mime_type, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          phone,
          key.id,
          fromMe,
          fromMe ? null : data.pushName || null,
          text || null,
          media?.kind || null,
          wantsFile ? 'pendente' : null,
          media?.node?.fileName || null,
          media?.node?.mimetype || null,
          when
        ]
      );
      id = rows[0].id;
    } catch (err) {
      // Duas entregas ao mesmo tempo: o índice único segura a segunda.
      if (/unique|duplicate/i.test(err.message)) return { ignored: 'mensagem já guardada' };
      throw err;
    }

    // O nome vem de quem escreve; nas nossas mensagens o pushName é o da própria Classul.
    const name = fromMe ? null : data.pushName || null;
    const { rows: chatRows } = await q('SELECT phone, last_message_at FROM wa_chats WHERE phone = $1', [phone]);
    if (!chatRows.length) {
      await q(
        `INSERT INTO wa_chats (phone, name, last_message_at, last_body, last_from_me, last_media_type)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [phone, name, when, text || null, fromMe, media?.kind || null]
      );
    } else {
      const last = chatRows[0].last_message_at;
      if (!last || new Date(when) >= new Date(last)) {
        await q(
          `UPDATE wa_chats SET last_message_at = $2, last_body = $3, last_from_me = $4, last_media_type = $5,
             name = COALESCE($6, name) WHERE phone = $1`,
          [phone, when, text || null, fromMe, media?.kind || null, name]
        );
      } else if (name) {
        await q('UPDATE wa_chats SET name = $2 WHERE phone = $1', [phone, name]);
      }
    }

    const file = wantsFile ? await saveMessageMedia(id) : null;
    return { stored: true, id, phone, media: media?.kind || null, file };
  } catch (err) {
    console.error('conversas: falha ao guardar mensagem:', err.message);
    return { error: err.message };
  }
}

// ---------- Leitura (aba Conversas) ----------

const tail8 = (phone) => String(phone || '').replace(/\D/g, '').slice(-8);

// Nome do cliente cadastrado, casando pelos 8 últimos dígitos (o WhatsApp às vezes
// entrega o número sem o nono dígito).
async function clientNames() {
  const { rows } = await q("SELECT id, name, phone FROM clients WHERE phone IS NOT NULL AND phone <> ''");
  const map = new Map();
  for (const c of rows) {
    const k = tail8(c.phone);
    if (k.length === 8 && !map.has(k)) map.set(k, c);
  }
  return map;
}

function serializeChat(c, clients) {
  const client = clients.get(tail8(c.phone));
  return {
    phone: c.phone,
    name: client?.name || c.name || null,
    client_id: client?.id || null,
    last_message_at: c.last_message_at,
    last_body: c.last_body,
    last_from_me: Boolean(c.last_from_me),
    last_media_type: c.last_media_type
  };
}

function serializeMessage(m) {
  return {
    id: m.id,
    phone: m.phone,
    from_me: Boolean(m.from_me),
    body: m.body,
    media_type: m.media_type,
    media_status: m.media_status,
    media_error: m.media_error,
    file_name: m.file_name,
    mime_type: m.mime_type,
    size: m.size != null ? Number(m.size) : null,
    web_view_link: m.web_view_link,
    sent_at: m.sent_at
  };
}

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (ch) => '\\' + ch);

// Lista de conversas (mais recente primeiro). Com busca: filtra por nome/telefone e
// devolve também as mensagens que contêm o texto, em qualquer conversa.
export async function listConversations(search = '') {
  const term = String(search || '').trim();
  const clients = await clientNames();
  const { rows } = await q('SELECT * FROM wa_chats ORDER BY last_message_at DESC NULLS LAST LIMIT 2000');
  let chats = rows.map((c) => serializeChat(c, clients));
  if (!term) return { chats: chats.slice(0, 400), total: chats.length, messages: [] };

  const lower = term.toLowerCase();
  const digits = term.replace(/\D/g, '');
  const names = new Map(chats.map((c) => [c.phone, c.name]));
  chats = chats.filter(
    (c) =>
      (c.name || '').toLowerCase().includes(lower) ||
      (digits.length >= 3 && c.phone.includes(digits)) ||
      // Digitado com o nono dígito, guardado sem ele (ou o contrário).
      (digits.length >= 8 && tail8(c.phone) === tail8(digits))
  );
  let messages = [];
  if (term.length >= 2) {
    const { rows: hits } = await q(
      `SELECT * FROM wa_messages WHERE body ILIKE $1 ORDER BY sent_at DESC, id DESC LIMIT 60`,
      [`%${likeEscape(term)}%`]
    );
    messages = hits.map((m) => ({ ...serializeMessage(m), chat_name: names.get(m.phone) || null }));
  }
  return { chats: chats.slice(0, 400), total: chats.length, messages };
}

// Mensagens de uma conversa, em ordem cronológica.
//   sem cursor  → as mais recentes
//   before=id   → as anteriores àquela (rolagem para cima)
//   after=id    → as posteriores (mensagens novas / rolagem para baixo)
//   around=id   → uma janela em volta (abrir um resultado da busca)
export async function listMessages(phone, { before, after, around, limit = 60 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 60, 1), 200);
  const clients = await clientNames();
  const chatRow = (await q('SELECT * FROM wa_chats WHERE phone = $1', [phone])).rows[0];
  if (!chatRow) return null;

  const anchor = async (id) => (await q('SELECT id, sent_at FROM wa_messages WHERE id = $1 AND phone = $2', [id, phone])).rows[0];
  const older = async (ref, inclusive, count) =>
    (
      await q(
        `SELECT * FROM wa_messages WHERE phone = $1 AND (sent_at < $2 OR (sent_at = $2 AND id ${inclusive ? '<=' : '<'} $3))
         ORDER BY sent_at DESC, id DESC LIMIT ${count + 1}`,
        [phone, ref.sent_at, ref.id]
      )
    ).rows;
  const newer = async (ref, count) =>
    (
      await q(
        `SELECT * FROM wa_messages WHERE phone = $1 AND (sent_at > $2 OR (sent_at = $2 AND id > $3))
         ORDER BY sent_at ASC, id ASC LIMIT ${count + 1}`,
        [phone, ref.sent_at, ref.id]
      )
    ).rows;

  let list = [];
  let hasOlder = false;
  let hasNewer = false;
  if (around) {
    const ref = await anchor(around);
    if (!ref) return null;
    const half = Math.ceil(n / 2);
    const a = await older(ref, true, half);
    const b = await newer(ref, half);
    hasOlder = a.length > half;
    hasNewer = b.length > half;
    list = [...a.slice(0, half).reverse(), ...b.slice(0, half)];
  } else if (after) {
    const ref = await anchor(after);
    if (!ref) return null;
    const b = await newer(ref, n);
    hasNewer = b.length > n;
    list = b.slice(0, n);
  } else if (before) {
    const ref = await anchor(before);
    if (!ref) return null;
    const a = await older(ref, false, n);
    hasOlder = a.length > n;
    list = a.slice(0, n).reverse();
  } else {
    const { rows } = await q(
      `SELECT * FROM wa_messages WHERE phone = $1 ORDER BY sent_at DESC, id DESC LIMIT ${n + 1}`,
      [phone]
    );
    hasOlder = rows.length > n;
    list = rows.slice(0, n).reverse();
  }
  return {
    chat: serializeChat(chatRow, clients),
    messages: list.map(serializeMessage),
    has_older: hasOlder,
    has_newer: hasNewer
  };
}

export async function getMessage(id) {
  const { rows } = await q('SELECT * FROM wa_messages WHERE id = $1', [id]);
  return rows[0] || null;
}

export { serializeMessage };
