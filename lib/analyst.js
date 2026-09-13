// Analista de conversas.
//
// Lê o histórico de uma conversa acompanhada e devolve uma SUGESTÃO — nunca
// mexe no quadro sozinho. Quem decide é o atendente, com um clique.
//
// O prompt é modelado no fluxo real da Classul:
//   1. cliente diz o que quer e o prazo
//   2. você passa o orçamento
//   3. cliente manda as informações para a arte
//   4. você monta o layout e manda prints para conferência
//   5. cliente aprova  → só então entra em produção

import { q, getSettings } from './db.js';
import { formatOrderNumber } from './whatsapp.js';

const HISTORY_LIMIT = 40;
// Não analisa a mesma conversa mais de uma vez nesse intervalo (custo e ruído).
const MIN_SECONDS_BETWEEN = 30;

export const STAGES = {
  orcamento: 'Aguardando orçamento',
  informacoes: 'Aguardando informações para a arte',
  arte: 'Montando a arte',
  aprovacao: 'Aguardando aprovação da arte',
  aprovado: 'Arte aprovada — pode produzir',
  indefinido: 'Conversa ainda sem pedido claro'
};

function buildPrompt(settings, order, catalog) {
  const produtos = catalog.map((p) => `- ${p.name}`).join('\n');
  return (
    'Você analisa conversas de WhatsApp da Classul, fábrica de placas e brindes de Porto Alegre-RS, ' +
    'e extrai informações de pedido. Você NÃO conversa com ninguém: só devolve JSON.\n\n' +
    'O ATENDIMENTO DA CLASSUL SEGUE SEMPRE ESTE FLUXO:\n' +
    '1. O cliente diz o que quer e, muitas vezes, a data de entrega.\n' +
    '2. A Classul passa o orçamento.\n' +
    '3. O cliente manda as informações para a montagem da arte (nomes, textos, logotipo, fotos).\n' +
    '4. A Classul monta o layout e manda prints para o cliente conferir.\n' +
    '5. O cliente aprova — e SÓ ENTÃO a produção começa.\n\n' +
    'PRODUTOS QUE A CLASSUL FAZ:\n' + produtos + '\n\n' +
    (order
      ? `JÁ EXISTE UM PEDIDO ABERTO para este cliente: ${formatOrderNumber(order.id)} — ` +
        `${order.product || order.product_type || 'produto não informado'}` +
        `${order.size ? `, tamanho ${order.size}` : ''}` +
        `${order.value ? `, valor ${order.value}` : ''}. ` +
        'Não sugira criar outro pedido para o mesmo trabalho: foque em detectar a aprovação da arte ' +
        'ou informações novas.\n\n'
      : 'Ainda NÃO existe pedido aberto para este cliente no sistema.\n\n') +
    'Responda APENAS com um objeto JSON, exatamente com estes campos:\n' +
    '{\n' +
    '  "fase": "orcamento" | "informacoes" | "arte" | "aprovacao" | "aprovado" | "indefinido",\n' +
    '  "tem_pedido": true se dá para identificar um trabalho concreto sendo negociado,\n' +
    '  "cliente": nome do cliente se ele aparecer na conversa, senão null,\n' +
    '  "produto": um dos produtos da lista acima, ou null,\n' +
    '  "tamanho": medida em cm citada (ex: "14x20"), ou null,\n' +
    '  "quantidade": número de peças, ou null,\n' +
    '  "valor": valor combinado, só números e vírgula (ex: "250,00"), ou null,\n' +
    '  "prazo": data de entrega no formato AAAA-MM-DD se der para saber, senão null,\n' +
    '  "descricao": resumo do que deve ser produzido (texto da homenagem, ocasião, detalhes),\n' +
    '  "arte_aprovada": true SOMENTE se o cliente aprovou claramente a arte/layout,\n' +
    '  "evidencia": a frase EXATA do cliente que prova a aprovação, ou null,\n' +
    '  "resumo": uma frase curta explicando em que pé está a conversa\n' +
    '}\n\n' +
    'REGRAS IMPORTANTES:\n' +
    '- "arte_aprovada" só é true com autorização clara do CLIENTE (ex: "pode produzir", "aprovado", ' +
    '"está perfeito, pode fazer"). Elogio solto como "ficou bonito" ou "gostei" NÃO é aprovação. ' +
    'Na dúvida, use false.\n' +
    '- Nunca invente valor, prazo ou medida que não esteja escrito na conversa. Prefira null.\n' +
    '- "prazo": converta datas relativas ("sexta", "dia 20") só se der para ter certeza do dia.\n' +
    `- Hoje é ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.\n` +
    '- As mensagens marcadas como [CLASSUL] são suas; as marcadas como [CLIENTE] são do cliente.'
  );
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
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 600
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `OpenAI respondeu ${res.status}`);
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function findOpenOrder(phone) {
  const { rows } = await q(
    'SELECT * FROM orders WHERE phone = $1 AND archived = 0 ORDER BY created_at DESC, id DESC LIMIT 1',
    [phone]
  );
  return rows[0] || null;
}

// Transcrição da conversa, marcando quem falou e o que era arquivo.
function renderHistory(messages) {
  return messages
    .map((m) => {
      const who = m.from_me ? '[CLASSUL]' : '[CLIENTE]';
      const media = m.media_type ? ` (enviou ${m.media_type})` : '';
      return `${who}${media}: ${m.body || ''}`.trim();
    })
    .join('\n');
}

// Analisa uma conversa e grava/atualiza a sugestão pendente dela.
// `force` ignora o intervalo mínimo (usado pelo botão "Analisar agora").
export async function analyzeChat(phone, { force = false } = {}) {
  const settings = await getSettings();
  if (!settings.openai_api_key) return { ignored: 'openai não configurada' };

  const { rows: watched } = await q('SELECT * FROM watched_chats WHERE phone = $1', [phone]);
  if (!watched.length) return { ignored: 'conversa não acompanhada' };
  const chat = watched[0];

  if (!force && chat.last_analysis_at) {
    const elapsed = (Date.now() - new Date(chat.last_analysis_at).getTime()) / 1000;
    if (elapsed < MIN_SECONDS_BETWEEN) return { ignored: 'analisada há pouco' };
  }

  const { rows: messages } = await q(
    'SELECT * FROM chat_messages WHERE phone = $1 ORDER BY id DESC LIMIT $2',
    [phone, HISTORY_LIMIT]
  );
  if (!messages.length) return { ignored: 'conversa sem mensagens' };
  messages.reverse();

  const order = await findOpenOrder(phone);
  const { rows: catalog } = await q('SELECT name FROM catalog_products WHERE active = 1 ORDER BY sort_order ASC');

  let parsed;
  try {
    const raw = await callOpenAI(settings, [
      { role: 'system', content: buildPrompt(settings, order, catalog) },
      { role: 'user', content: renderHistory(messages) }
    ]);
    parsed = JSON.parse(raw);
  } catch (err) {
    await q('UPDATE watched_chats SET last_analysis_at = now() WHERE phone = $1', [phone]);
    return { error: err.message };
  }

  await q('UPDATE watched_chats SET last_analysis_at = now() WHERE phone = $1', [phone]);

  const approved = parsed.arte_aprovada === true && Boolean(order);
  const kind = approved ? 'arte_aprovada' : 'novo_pedido';

  // Sem pedido para abrir e sem aprovação para avisar: não gera ruído.
  if (!approved && (!parsed.tem_pedido || order)) {
    return { analyzed: true, stage: parsed.fase, suggestion: null };
  }

  const payload = {
    cliente: parsed.cliente || chat.chat_name || null,
    produto: parsed.produto || null,
    tamanho: parsed.tamanho || null,
    quantidade: parsed.quantidade || null,
    valor: parsed.valor || null,
    prazo: parsed.prazo || null,
    descricao: parsed.descricao || null,
    evidencia: parsed.evidencia || null
  };

  // Uma sugestão pendente por conversa e tipo: a nova substitui a anterior.
  const { rows: existing } = await q(
    "SELECT * FROM order_suggestions WHERE phone = $1 AND kind = $2 AND status = 'pendente' LIMIT 1",
    [phone, kind]
  );
  if (existing.length) {
    const { rows } = await q(
      `UPDATE order_suggestions SET stage = $2, summary = $3, data = $4, order_id = $5, created_at = now()
       WHERE id = $1 RETURNING *`,
      [existing[0].id, parsed.fase || null, parsed.resumo || null, JSON.stringify(payload), order?.id || null]
    );
    return { analyzed: true, stage: parsed.fase, suggestion: rows[0] };
  }

  const { rows } = await q(
    `INSERT INTO order_suggestions (phone, chat_name, order_id, kind, stage, summary, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      phone,
      chat.chat_name || null,
      order?.id || null,
      kind,
      parsed.fase || null,
      parsed.resumo || null,
      JSON.stringify(payload)
    ]
  );
  return { analyzed: true, stage: parsed.fase, suggestion: rows[0] };
}
