// Ideal: o app pessoal do iPhone (treino, rotina, sono, água, objetivos, ideias).
//
// O iPhone monta um "snapshot" com tudo o que o painel precisa (o mesmo que manda
// para o app do Mac pela rede local) e envia para cá pela internet. O sistema só
// guarda o último e mostra na área secreta, travada por senha. Quem manda é o
// iPhone: aqui nada é editado.
import crypto from 'crypto';
import { q } from './db.js';

export class IdealError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const APP_SECRET = () => process.env.APP_SECRET || process.env.API_TOKEN || 'classul';
export const hashSyncKey = (key) => sha256(`${APP_SECRET()}:ideal-sync:${key}`);

let ready = null;
export function ensureIdealSchema() {
  ready ||= q(`
    CREATE TABLE IF NOT EXISTS ideal_snapshot (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      device TEXT,
      generated_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

// Chave que o iPhone usa para enviar. Só o hash fica no banco; a chave aparece
// uma vez na tela, para colar no app.
export async function newSyncKey() {
  const key = 'ideal_' + crypto.randomBytes(18).toString('base64url');
  await q(
    `INSERT INTO settings (key, value) VALUES ('ideal_sync_key_hash', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [hashSyncKey(key)]
  );
  return key;
}

export async function syncKeyHash() {
  const { rows } = await q("SELECT value FROM settings WHERE key = 'ideal_sync_key_hash'");
  return rows[0]?.value || '';
}

export async function checkSyncKey(key) {
  const hash = await syncKeyHash();
  if (!hash || !key) return false;
  const a = Buffer.from(hash);
  const b = Buffer.from(hashSyncKey(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Confere o formato mínimo (o mesmo SyncSnapshot do app, datas em segundos).
export function validateSnapshot(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new IdealError('Snapshot inválido.');
  for (const k of ['days', 'sessions', 'weights', 'objectives']) {
    if (!Array.isArray(s[k])) throw new IdealError(`Snapshot sem "${k}".`);
  }
  if (typeof s.generatedAt !== 'number' || !s.goals || typeof s.goals !== 'object') throw new IdealError('Snapshot sem data ou metas.');
  return s;
}

export async function saveSnapshot(snapshot) {
  await ensureIdealSchema();
  const s = validateSnapshot(snapshot);
  const generated = new Date(s.generatedAt * 1000);
  await q(
    `INSERT INTO ideal_snapshot (id, data, device, generated_at, received_at) VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, device = EXCLUDED.device,
       generated_at = EXCLUDED.generated_at, received_at = now()`,
    [JSON.stringify(s), String(s.deviceName || '').slice(0, 80), Number.isFinite(generated.getTime()) ? generated.toISOString() : null]
  );
  return { ok: true };
}

export async function readSnapshot() {
  await ensureIdealSchema();
  const { rows } = await q('SELECT data, device, received_at FROM ideal_snapshot WHERE id = 1');
  const connected = Boolean(await syncKeyHash());
  if (!rows[0]) return { snapshot: null, received_at: null, device: null, connected };
  return { snapshot: JSON.parse(rows[0].data), received_at: rows[0].received_at, device: rows[0].device, connected };
}
