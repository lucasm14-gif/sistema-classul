// Observador de conversas do WhatsApp.
//
// Diferente do bot (lib/bot.js), este módulo NUNCA responde nada: ele só
// escuta as conversas que você marcou para acompanhar, guarda o histórico e
// salva no Drive os arquivos que o cliente manda.
//
// Só conversas presentes em `watched_chats` são processadas — é o que mantém
// o volume (e o custo) sob controle.

import { q } from './db.js';
import { fetchMediaBase64, normalizePhone, formatOrderNumber } from './whatsapp.js';
import { ensureOrderFolder, ensureInboxFolder, uploadBufferToFolder } from './google.js';

// Tipos de mensagem que carregam arquivo, na ordem em que aparecem no payload.
const MEDIA_KINDS = [
  ['imageMessage', 'imagem'],
  ['documentMessage', 'documento'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['stickerMessage', 'figurinha']
];

// Texto legível da mensagem (inclui a legenda de fotos e documentos).
function extractText(message = {}) {
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
  ).trim();
}

function findMedia(message = {}) {
  for (const [key, kind] of MEDIA_KINDS) {
    if (message[key]) return { kind, node: message[key] };
  }
  return null;
}

export async function isWatched(phone) {
  const { rows } = await q('SELECT 1 FROM watched_chats WHERE phone = $1 LIMIT 1', [phone]);
  return rows.length > 0;
}

// Pedido ativo mais recente do telefone — é para a pasta dele que o arquivo vai.
async function findOpenOrder(phone) {
  const { rows } = await q(
    'SELECT * FROM orders WHERE phone = $1 AND archived = 0 ORDER BY created_at DESC, id DESC LIMIT 1',
    [phone]
  );
  return rows[0] || null;
}

// Guarda o arquivo no Drive: na pasta do pedido aberto, se houver; senão na
// caixa de entrada, para você anexar depois pelo sistema.
async function saveMedia({ phone, chatName, messageId, kind, fallbackMime }) {
  const media = await fetchMediaBase64(messageId);
  const buffer = Buffer.from(media.base64, 'base64');
  const mimeType = media.mimeType || fallbackMime || 'application/octet-stream';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = media.fileName || `${kind}-${stamp}`;

  const order = await findOpenOrder(phone);
  if (order) {
    const folderId = await ensureOrderFolder(order);
    const file = await uploadBufferToFolder(folderId, { name, mimeType, buffer });
    await q(
      `INSERT INTO attachments (order_id, drive_file_id, name, mime_type, size, web_view_link, category)
       VALUES ($1, $2, $3, $4, $5, $6, 'arquivo')`,
      [order.id, file.id, file.name, file.mimeType || mimeType, file.size ? Number(file.size) : buffer.length, file.webViewLink || null]
    );
    return { saved: 'pedido', order_number: formatOrderNumber(order.id), name: file.name };
  }

  const folderId = await ensureInboxFolder();
  const file = await uploadBufferToFolder(folderId, { name, mimeType, buffer });
  await q(
    `INSERT INTO chat_files (phone, chat_name, drive_file_id, name, mime_type, size, web_view_link)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [phone, chatName || null, file.id, file.name, file.mimeType || mimeType, file.size ? Number(file.size) : buffer.length, file.webViewLink || null]
  );
  return { saved: 'caixa de entrada', name: file.name };
}

// Processa um evento MESSAGES_UPSERT. Nunca lança: devolve um resumo do que fez,
// para não derrubar o webhook (a Evolution re-tentaria).
export async function handleWatchedMessage(body) {
  const data = body?.data || {};
  const key = data.key || {};
  const jid = key.remoteJid || '';
  if (!jid.endsWith('@s.whatsapp.net')) return { ignored: 'não é conversa individual' };

  const phone = normalizePhone(jid.split('@')[0]) || jid.split('@')[0].replace(/\D/g, '');
  if (!(await isWatched(phone))) return { ignored: 'conversa não acompanhada' };

  const fromMe = Boolean(key.fromMe);
  const text = extractText(data.message);
  const media = findMedia(data.message);

  await q(
    `INSERT INTO chat_messages (phone, wa_message_id, from_me, push_name, body, media_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [phone, key.id || null, fromMe ? 1 : 0, data.pushName || null, text || null, media?.kind || null]
  );
  await q('UPDATE watched_chats SET last_message_at = now() WHERE phone = $1', [phone]);

  // Só baixa arquivo que o cliente mandou (o que sai daqui já é nosso).
  let file = null;
  if (media && !fromMe && media.kind !== 'figurinha' && media.kind !== 'audio') {
    try {
      file = await saveMedia({
        phone,
        chatName: data.pushName,
        messageId: key.id,
        kind: media.kind,
        fallbackMime: media.node?.mimetype
      });
    } catch (err) {
      console.error('watcher: falha ao salvar arquivo:', err.message);
      file = { error: err.message };
    }
  }

  return { watched: true, phone, media: media?.kind || null, file };
}
