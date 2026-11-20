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
  `)
    .then(() =>
      q(`
        CREATE TABLE IF NOT EXISTS ideal_actions (
          id SERIAL PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          applied_at TIMESTAMPTZ,
          ok BOOLEAN,
          error TEXT,
          result TEXT
        )
      `)
    )
    .catch((err) => {
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
  const actions = await webActions();
  if (!rows[0]) return { snapshot: null, received_at: null, device: null, connected, actions };
  return { snapshot: JSON.parse(rows[0].data), received_at: rows[0].received_at, device: rows[0].device, connected, actions };
}

// ------------------------------------------------------------------ alterações da web
//
// O que for feito no Ideal da web vira uma "ação" na fila. O iPhone busca as
// pendentes, aplica no banco dele e confirma; a web mostra a mudança na hora
// (aplicando as pendentes por cima do último snapshot).

export const ACTION_TYPES = [
  'routine.check', 'routine.save', 'routine.delete',
  'habit.check', 'habit.save', 'habit.delete',
  'goal.save', 'goal.delete', 'idea.add', 'idea.delete',
  'water.add', 'weight.add', 'meal.add', 'meal.delete', 'mood.add', 'sleep.add', 'focus.add', 'cardio.add',
  'settings.save'
];

const rowToAction = (r) => ({
  id: r.id,
  type: r.type,
  payload: JSON.parse(r.payload),
  created_at: r.created_at,
  applied_at: r.applied_at,
  ok: r.ok,
  error: r.error,
  result: r.result
});

export async function addAction(type, payload) {
  await ensureIdealSchema();
  if (!ACTION_TYPES.includes(type)) throw new IdealError('Tipo de alteração desconhecido.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new IdealError('Alteração sem dados.');
  const text = JSON.stringify(payload);
  if (text.length > 20000) throw new IdealError('Alteração grande demais.');
  const { rows } = await q('INSERT INTO ideal_actions (type, payload) VALUES ($1, $2) RETURNING *', [type, text]);
  return rowToAction(rows[0]);
}

export async function cancelAction(id) {
  await ensureIdealSchema();
  const { rows } = await q('DELETE FROM ideal_actions WHERE id = $1 AND applied_at IS NULL RETURNING id', [Number(id) || 0]);
  if (!rows[0]) throw new IdealError('Essa alteração já foi aplicada pelo iPhone.', 409);
  return { ok: true };
}

// Para a web: pendentes (aplicadas por cima do snapshot) e as que falharam há pouco.
export async function webActions() {
  await ensureIdealSchema();
  const { rows } = await q(
    `SELECT * FROM ideal_actions
     WHERE applied_at IS NULL OR (ok = false AND applied_at > now() - interval '2 days')
     ORDER BY id`
  );
  return rows.map(rowToAction);
}

// Para o iPhone: pendentes em ordem. Um item criado na web e ainda sem id real
// é apontado como "pending:<ação>"; se essa ação já foi aplicada, troca pelo id.
export async function pendingForPhone() {
  await ensureIdealSchema();
  const { rows } = await q('SELECT * FROM ideal_actions WHERE applied_at IS NULL ORDER BY id LIMIT 200');
  const refs = [...new Set(rows.map((r) => JSON.parse(r.payload).id).filter((v) => typeof v === 'string' && v.startsWith('pending:')))];
  const resolved = new Map();
  if (refs.length) {
    const ids = refs.map((r) => Number(r.slice(8))).filter(Boolean);
    const { rows: done } = await q('SELECT id, result FROM ideal_actions WHERE id = ANY($1::int[]) AND ok = true', [ids]);
    for (const d of done) resolved.set(`pending:${d.id}`, d.result);
  }
  return rows.map((r) => {
    const payload = JSON.parse(r.payload);
    if (typeof payload.id === 'string' && resolved.has(payload.id)) payload.id = resolved.get(payload.id);
    return { id: r.id, type: r.type, payload };
  });
}

export async function ackActions(results) {
  await ensureIdealSchema();
  if (!Array.isArray(results)) throw new IdealError('Confirmação inválida.');
  let n = 0;
  for (const r of results.slice(0, 500)) {
    const id = Number(r?.id) || 0;
    if (!id) continue;
    await q(
      'UPDATE ideal_actions SET applied_at = now(), ok = $2, error = $3, result = $4 WHERE id = $1 AND applied_at IS NULL',
      [id, r.ok !== false, r.ok === false ? String(r.error || 'erro').slice(0, 300) : null, r.result ? String(r.result).slice(0, 2000) : null]
    );
    n += 1;
    // Item criado agora: ações pendentes que apontavam para "pending:<id>" passam a usar o id real.
    if (r.ok !== false && r.result) {
      const { rows: refs } = await q('SELECT id, payload FROM ideal_actions WHERE applied_at IS NULL');
      for (const row of refs) {
        const payload = JSON.parse(row.payload);
        if (payload.id === `pending:${id}`) {
          payload.id = String(r.result);
          await q('UPDATE ideal_actions SET payload = $2 WHERE id = $1', [row.id, JSON.stringify(payload)]);
        }
      }
    }
  }
  // Limpeza: confirmadas com sucesso há mais de 30 dias saem da fila.
  await q("DELETE FROM ideal_actions WHERE ok = true AND applied_at < now() - interval '30 days'");
  return { ok: true, confirmadas: n };
}
