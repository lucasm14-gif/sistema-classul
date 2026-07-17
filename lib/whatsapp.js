import { q, getSettings } from './db.js';

export function formatOrderNumber(id) {
  return `#${String(id).padStart(4, '0')}`;
}

// Aceita "(51) 99999-9999", "5551999999999" etc. e devolve só dígitos com DDI 55.
export function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits;
}

export function renderTemplate(template, order) {
  const brl = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : (v || '');
  };
  const dateBr = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return d && m && y ? `${d.slice(0, 2)}/${m}/${y}` : iso;
  };
  return String(template || '')
    .replaceAll('{nome}', order.customer_name || '')
    .replaceAll('{pedido}', formatOrderNumber(order.id))
    .replaceAll('{codigo}', order.pickup_code || '')
    .replaceAll('{produto}', order.product_type || '')
    .replaceAll('{valor}', brl(order.value))
    .replaceAll('{entrega}', dateBr(order.due_date))
    .replaceAll('{descricao}', order.description || '');
}

async function evolutionConfig() {
  const s = await getSettings();
  if (!s.evolution_url || !s.evolution_apikey || !s.evolution_instance) {
    throw new Error('Evolution API não configurada. Preencha URL, API key e nome da instância em Configurações.');
  }
  return {
    base: s.evolution_url.replace(/\/+$/, ''),
    apikey: s.evolution_apikey,
    instance: s.evolution_instance
  };
}

export async function sendText(number, text) {
  const { base, apikey, instance } = await evolutionConfig();
  const url = `${base}/message/sendText/${encodeURIComponent(instance)}`;
  const headers = { 'Content-Type': 'application/json', apikey };

  // Formato Evolution API v2; se o servidor for v1, tenta o formato antigo.
  let res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ number, text })
  });
  if (res.status === 400) {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number, options: { delay: 0 }, textMessage: { text } })
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Evolution API respondeu ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Envia uma imagem (por URL pública) via Evolution. Usado pelo bot para mostrar produtos.
export async function sendImageUrl(number, imageUrl, caption = '') {
  const { base, apikey, instance } = await evolutionConfig();
  const url = `${base}/message/sendMedia/${encodeURIComponent(instance)}`;
  const headers = { 'Content-Type': 'application/json', apikey };

  // Formato Evolution API v2; fallback para o formato antigo se der 400.
  let res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ number, mediatype: 'image', media: imageUrl, caption })
  });
  if (res.status === 400) {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        number,
        mediaMessage: { mediatype: 'image', media: imageUrl, caption }
      })
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Evolution sendMedia respondeu ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function fetchInstances() {
  const s = await getSettings();
  if (!s.evolution_url || !s.evolution_apikey) {
    throw new Error('Preencha a URL e a API key da Evolution primeiro.');
  }
  const base = s.evolution_url.replace(/\/+$/, '');
  const res = await fetch(`${base}/instance/fetchInstances`, {
    headers: { apikey: s.evolution_apikey }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Evolution API respondeu ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

const NOTIFY_STATUSES = {
  pronto: { enabledKey: 'msg_pronto_enabled', templateKey: 'msg_pronto_template' },
  entregue: { enabledKey: 'msg_entregue_enabled', templateKey: 'msg_entregue_template' }
};

// Envia (se aplicável) a mensagem automática de uma etapa. Nunca lança: devolve o resultado.
export async function notifyStatus(order, status, { force = false } = {}) {
  const config = NOTIFY_STATUSES[status];
  if (!config) return { sent: false, skipped: true, reason: 'Etapa sem mensagem automática.' };

  const settings = await getSettings();
  if (!force && settings[config.enabledKey] !== '1') {
    return { sent: false, skipped: true, reason: 'Mensagem automática desativada para esta etapa.' };
  }

  const phone = normalizePhone(order.phone);
  if (!phone) {
    return { sent: false, skipped: true, reason: 'Pedido sem telefone — mensagem não enviada.' };
  }

  if (!force) {
    const { rows } = await q(
      'SELECT 1 FROM message_log WHERE order_id = $1 AND status_trigger = $2 AND success = 1 LIMIT 1',
      [order.id, status]
    );
    if (rows.length) {
      return { sent: false, skipped: true, reason: 'Mensagem desta etapa já foi enviada antes.' };
    }
  }

  const body = renderTemplate(settings[config.templateKey], order);
  try {
    await sendText(phone, body);
    await q(
      'INSERT INTO message_log (order_id, status_trigger, phone, body, success, error) VALUES ($1, $2, $3, $4, 1, NULL)',
      [order.id, status, phone, body]
    );
    return { sent: true, phone, body };
  } catch (err) {
    await q(
      'INSERT INTO message_log (order_id, status_trigger, phone, body, success, error) VALUES ($1, $2, $3, $4, 0, $5)',
      [order.id, status, phone, body, err.message]
    );
    return { sent: false, error: err.message };
  }
}
