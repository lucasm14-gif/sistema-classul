import { q, getSettings } from './db.js';
import { sendText, normalizePhone } from './whatsapp.js';

const MAX_USER_TURNS = 12; // trava de segurança contra loop/custo
const HISTORY_LIMIT = 24;

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ''
  ).trim();
}

function buildSystemPrompt(settings) {
  const base = settings.bot_system_prompt || '';
  return base.includes('{PRODUTOS}')
    ? base.replaceAll('{PRODUTOS}', settings.bot_products || '')
    : `${base}\n\nProdutos que produzimos:\n${settings.bot_products || ''}`;
}

async function callOpenAI(settings, messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.openai_api_key}`
    },
    body: JSON.stringify({
      model: settings.openai_model || 'gpt-4o-mini',
      messages,
      temperature: 0.4,
      max_tokens: 500
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI respondeu ${res.status}`);
  }
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function getConversation(phone) {
  const { rows } = await q('SELECT * FROM bot_conversations WHERE phone = $1', [phone]);
  return rows[0] || null;
}

async function upsertConversation(phone, pushName) {
  await q(
    `INSERT INTO bot_conversations (phone, push_name) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET
       push_name = COALESCE(EXCLUDED.push_name, bot_conversations.push_name),
       updated_at = now()`,
    [phone, pushName || null]
  );
  return getConversation(phone);
}

async function markHandled(phone, reason) {
  await q(
    `UPDATE bot_conversations SET status = 'handled', handled_reason = $2, handled_at = now(), updated_at = now()
     WHERE phone = $1`,
    [phone, reason]
  );
}

async function addMessage(phone, role, content, waId) {
  await q('INSERT INTO bot_messages (phone, role, content, wa_message_id) VALUES ($1, $2, $3, $4)', [
    phone,
    role,
    content,
    waId || null
  ]);
}

async function getHistory(phone) {
  const { rows } = await q(
    "SELECT role, content FROM bot_messages WHERE phone = $1 AND role IN ('user','assistant') ORDER BY id ASC LIMIT $2",
    [phone, HISTORY_LIMIT]
  );
  return rows;
}

// Detecta se um id de mensagem "fromMe" foi enviado pelo próprio bot (evita tratar o eco como handoff).
async function wasSentByBot(phone, waId, text) {
  if (waId) {
    const { rows } = await q(
      "SELECT 1 FROM bot_messages WHERE phone = $1 AND role = 'assistant' AND wa_message_id = $2 LIMIT 1",
      [phone, waId]
    );
    if (rows.length) return true;
  }
  if (text) {
    const { rows } = await q(
      "SELECT 1 FROM bot_messages WHERE phone = $1 AND role = 'assistant' AND content = $2 ORDER BY id DESC LIMIT 1",
      [phone, text]
    );
    if (rows.length) return true;
  }
  return false;
}

// Processa um evento de mensagem recebida da Evolution. Nunca lança: devolve um resumo do que fez.
export async function handleIncoming(body) {
  const settings = await getSettings();
  if (settings.bot_enabled !== '1') return { ignored: 'bot desativado' };
  if (!settings.openai_api_key) return { ignored: 'openai não configurada' };

  const data = body?.data || {};
  const key = data.key || {};
  const jid = key.remoteJid || '';
  // só conversas individuais (ignora grupos e status)
  if (!jid.endsWith('@s.whatsapp.net')) return { ignored: 'não é conversa individual' };

  const phone = jid.split('@')[0].replace(/\D/g, '');
  const fromMe = Boolean(key.fromMe);
  const text = extractText(data.message);

  // filtro de número de teste
  const testNumber = normalizePhone(settings.bot_test_number);
  if (testNumber && phone !== testNumber) return { ignored: 'fora do número de teste' };

  // handoff humano: se você respondeu manualmente, o bot silencia para sempre
  if (fromMe) {
    if (await wasSentByBot(phone, key.id, text)) return { ignored: 'eco do próprio bot' };
    const convo = await getConversation(phone);
    if (convo && convo.status === 'handled') return { ignored: 'já encerrado' };
    await upsertConversation(phone, null);
    await markHandled(phone, 'humano assumiu');
    return { handoff: true, phone };
  }

  if (!text) return { ignored: 'mensagem sem texto' };

  const convo = await upsertConversation(phone, data.pushName);
  if (convo.status === 'handled') return { ignored: 'conversa já atendida', phone };

  await addMessage(phone, 'user', text, key.id);

  const history = await getHistory(phone);
  const userTurns = history.filter((m) => m.role === 'user').length;

  // trava de segurança: muitas idas e vindas → entrega para humano
  if (userTurns > MAX_USER_TURNS) {
    const bye = 'Vou pedir para um atendente da Classul continuar com você por aqui, tá? 🙂 Já já alguém te responde.';
    try {
      const sent = await sendText(phone, bye);
      await addMessage(phone, 'assistant', bye, sent?.key?.id);
    } catch (err) {
      return { error: err.message, phone };
    }
    await markHandled(phone, 'limite de mensagens');
    return { replied: true, done: true, phone };
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(settings) },
    ...history.map((m) => ({ role: m.role, content: m.content || '' }))
  ];

  let reply;
  try {
    reply = await callOpenAI(settings, messages);
  } catch (err) {
    return { error: err.message, phone };
  }
  if (!reply) return { ignored: 'openai devolveu vazio', phone };

  const done = /\[\[\s*ATENDIDO\s*\]\]/i.test(reply);
  const clean = reply.replace(/\[\[\s*ATENDIDO\s*\]\]/gi, '').trim() || reply.trim();

  try {
    const sent = await sendText(phone, clean);
    await addMessage(phone, 'assistant', clean, sent?.key?.id);
  } catch (err) {
    return { error: err.message, phone };
  }

  if (done) await markHandled(phone, 'bot concluiu');
  return { replied: true, done, phone };
}
