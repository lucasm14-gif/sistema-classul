// Avisos que o sistema manda PARA o Hermes (VPS), e o registro das duas mãos.
// Separado de hermes.js de propósito: orders.js precisa avisar eventos sem
// importar o catálogo de ferramentas (evita import circular).
import crypto from 'crypto';
import { q, getSettings } from './db.js';

const TIMEOUT_MS = 6000;
const LOG_LIMIT = 500;

const cut = (v, max = 4000) => {
  if (v == null) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

// Nunca lança: um problema de registro não pode derrubar um pedido.
export async function logHermes(direction, name, { args, result, ok = true, error = null } = {}) {
  try {
    await q(
      'INSERT INTO hermes_events (direction, name, args, result, ok, error) VALUES ($1, $2, $3, $4, $5, $6)',
      [direction, String(name).slice(0, 80), cut(args), cut(result), ok ? 1 : 0, error ? String(error).slice(0, 500) : null]
    );
    // mantém o histórico curto (o painel mostra os últimos)
    const { rows } = await q('SELECT id FROM hermes_events ORDER BY id DESC LIMIT 1');
    const lastId = rows[0]?.id || 0;
    if (lastId > LOG_LIMIT) await q('DELETE FROM hermes_events WHERE id <= $1', [lastId - LOG_LIMIT]);
  } catch (err) {
    console.error('hermes log:', err.message);
  }
}

export function signBody(body, secret) {
  return crypto.createHmac('sha256', String(secret || '')).update(body).digest('hex');
}

// Envia um evento ao Hermes. Nunca lança — se a VPS estiver fora do ar,
// o pedido continua acontecendo normalmente e o erro fica no registro.
export async function notifyHermes(event, data) {
  let settings;
  try {
    settings = await getSettings();
  } catch {
    return { skipped: 'sem configuração' };
  }
  if (settings.hermes_enabled !== '1') return { skipped: 'hermes desativado' };
  const url = (settings.hermes_webhook_url || '').trim();
  if (!url) return { skipped: 'sem webhook do hermes' };

  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.hermes_token || ''}`,
        'X-Classul-Event': event,
        'X-Classul-Signature': signBody(body, settings.hermes_token)
      },
      body,
      signal: controller.signal
    });
    const text = await res.text().catch(() => '');
    await logHermes('saida', event, { args: data, result: text, ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` });
    return { sent: res.ok, status: res.status, response: text.slice(0, 2000) };
  } catch (err) {
    const msg = err.name === 'AbortError' ? `sem resposta em ${TIMEOUT_MS / 1000}s` : err.message;
    await logHermes('saida', event, { args: data, ok: false, error: msg });
    return { sent: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
