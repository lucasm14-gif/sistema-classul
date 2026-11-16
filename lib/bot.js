import { q, getSettings } from './db.js';
import { sendText, sendImageUrl, normalizePhone } from './whatsapp.js';
import { FOTOS_ATENDIMENTO, avaliarContato, telefoneDaMensagem, contextoDeHorario } from './atendimento.js';

const MAX_USER_TURNS = 12; // trava de segurança contra loop/custo
const HISTORY_LIMIT = 24;
const MAX_PHOTOS_PER_REPLY = 5;

// Catálogo de fotos que o bot pode enviar (web/public/bot-fotos, servidas pela Vercel).
// O modelo pede as fotos de um produto com [[FOTO:chave]] e o bot envia todas daquele produto.
const MEDIA = FOTOS_ATENDIMENTO;

function parsePhotoTokens(text) {
  const tokens = [];
  const re = /\[\[\s*FOTO\s*:\s*([a-z_]+)\s*\]\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].toLowerCase();
    if (MEDIA[key] && !tokens.includes(key)) tokens.push(key);
  }
  const clean = text.replace(/\[\[\s*FOTO\s*:\s*[a-z_]+\s*\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  return { tokens, clean };
}

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

function buildSystemPrompt(settings, agora = new Date()) {
  const base = settings.bot_system_prompt || '';
  const prompt = base.includes('{PRODUTOS}')
    ? base.replaceAll('{PRODUTOS}', settings.bot_products || '')
    : `${base}\n\nProdutos que produzimos:\n${settings.bot_products || ''}`;
  return `${prompt}\n\n${contextoDeHorario(agora)}`;
}

// Decide a resposta para uma conversa (lista de {role, content}, a última é do cliente).
// É o mesmo caminho para o WhatsApp e para o chat de teste do sistema.
//   silencio: o modelo avaliou que não é para responder (conversa pessoal, fornecedor...)
//   done:     o modelo passou a conversa para o atendente humano
export async function gerarResposta(settings, history, agora = new Date()) {
  const reply = await callOpenAI(settings, [
    { role: 'system', content: buildSystemPrompt(settings, agora) },
    ...history.map((m) => ({ role: m.role, content: m.content || '' }))
  ]);
  const done = /\[\[\s*ATENDIDO\s*\]\]/i.test(reply);
  const calado = /\[\[\s*SIL[EÊ]NCIO\s*\]\]/i.test(reply);
  const semMarcas = reply.replace(/\[\[\s*(ATENDIDO|SIL[EÊ]NCIO)\s*\]\]/gi, '').trim();
  const { tokens, clean } = parsePhotoTokens(semMarcas);
  const silencio = calado || (!clean && !tokens.length);
  return {
    texto: silencio ? '' : clean,
    fotos: silencio ? [] : tokens,
    done,
    silencio
  };
}

// Links das fotos de uma resposta, na ordem de envio.
export function fotosDaResposta(tokens, siteBase = '') {
  const base = (siteBase || '').replace(/\/+$/, '');
  const out = [];
  for (const key of tokens) {
    for (const file of MEDIA[key].files) {
      if (out.length >= MAX_PHOTOS_PER_REPLY) break;
      out.push({ label: MEDIA[key].label, url: `${base}/bot-fotos/${file}` });
    }
  }
  return out;
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
    "SELECT role, content FROM bot_messages WHERE phone = $1 AND role IN ('user','assistant') ORDER BY id DESC LIMIT $2",
    [phone, HISTORY_LIMIT]
  );
  return rows.reverse();
}

// O bot já falou nesta conversa? (é o que diferencia "conversa em andamento" de primeiro contato)
async function botJaRespondeu(phone) {
  const { rows } = await q("SELECT 1 FROM bot_messages WHERE phone = $1 AND role = 'assistant' LIMIT 1", [phone]);
  return rows.length > 0;
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
// siteBase é a URL pública do sistema (para montar os links das fotos).
export async function handleIncoming(body, siteBase = '') {
  const settings = await getSettings();
  if (settings.bot_enabled !== '1') return { ignored: 'bot desativado' };
  if (!settings.openai_api_key) return { ignored: 'openai não configurada' };

  const data = body?.data || {};
  const key = data.key || {};
  // só conversas individuais (ignora grupos e status)
  const phone = telefoneDaMensagem(key);
  if (!phone) return { ignored: 'não é conversa individual' };
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

  const anterior = await getConversation(phone);
  if (anterior?.status === 'handled') return { ignored: 'conversa já atendida', phone };

  // Números da lista de não responder (família, fornecedores) nem chegam ao modelo.
  const filtro = avaliarContato({ phone, settings });
  if (!filtro.atender) return { ignored: 'não é cliente', motivo: filtro.motivo, phone };

  // O bot lê a conversa e decide se responde. Enquanto ele não tiver entrado, nada é
  // guardado: conversa pessoal não vira histórico nem conta para a trava de mensagens.
  const engajado = await botJaRespondeu(phone);
  const history = [...(engajado ? await getHistory(phone) : []), { role: 'user', content: text }];
  const userTurns = history.filter((m) => m.role === 'user').length;

  // trava de segurança: muitas idas e vindas → entrega para humano
  if (userTurns > MAX_USER_TURNS) {
    const bye = 'Vou pedir para um atendente da Classul continuar com você por aqui, tá? 🙂 Já já alguém te responde.';
    try {
      await upsertConversation(phone, data.pushName);
      await addMessage(phone, 'user', text, key.id);
      const sent = await sendText(phone, bye);
      await addMessage(phone, 'assistant', bye, sent?.key?.id);
    } catch (err) {
      return { error: err.message, phone };
    }
    await markHandled(phone, 'limite de mensagens');
    return { replied: true, done: true, phone };
  }

  let resposta;
  try {
    resposta = await gerarResposta(settings, history);
  } catch (err) {
    return { error: err.message, phone };
  }

  if (resposta.silencio) {
    if (engajado) await addMessage(phone, 'user', text, key.id);
    if (resposta.done) {
      await upsertConversation(phone, data.pushName);
      await markHandled(phone, 'bot passou para o atendente');
    }
    return { ignored: 'bot preferiu não responder', done: resposta.done, phone };
  }

  try {
    await upsertConversation(phone, data.pushName);
    await addMessage(phone, 'user', text, key.id);
    const sent = resposta.texto ? await sendText(phone, resposta.texto) : null;
    const sentPhotos = [];
    for (const foto of fotosDaResposta(resposta.fotos, siteBase)) {
      try {
        await sendImageUrl(phone, foto.url);
        sentPhotos.push(foto.label);
      } catch (err) {
        console.error('bot foto:', err.message);
      }
    }
    const note = sentPhotos.length ? `\n📷 ${[...new Set(sentPhotos)].join(', ')}` : '';
    await addMessage(phone, 'assistant', (resposta.texto + note).trim(), sent?.key?.id);
  } catch (err) {
    return { error: err.message, phone };
  }

  if (resposta.done) await markHandled(phone, 'bot concluiu');
  return { replied: true, done: resposta.done, phone };
}
