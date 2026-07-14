import pg from 'pg';

export const STATUSES = ['novo', 'producao', 'pronto', 'entregue'];

const DEFAULT_SETTINGS_KEYS = [
  'evolution_url',
  'evolution_apikey',
  'evolution_instance',
  'msg_pronto_enabled',
  'msg_pronto_template',
  'msg_entregue_enabled',
  'msg_entregue_template'
];

function defaultSettings() {
  return {
    evolution_url: process.env.EVOLUTION_URL || '',
    evolution_apikey: process.env.EVOLUTION_APIKEY || '',
    evolution_instance: process.env.EVOLUTION_INSTANCE || '',
    msg_pronto_enabled: '1',
    msg_pronto_template:
      'Olá {nome}! 🎉\n\nSeu pedido {pedido} está PRONTO!\n\nJá pode combinar a retirada ou aguardar o envio. Qualquer dúvida estamos à disposição.\n\n— Classul',
    msg_entregue_enabled: '1',
    msg_entregue_template:
      'Olá {nome}! ✅\n\nSeu pedido {pedido} foi enviado/entregue.\n\nAgradecemos muito pela preferência! Se puder, deixe sua avaliação no Google, isso nos ajuda demais:\n🔗 https://g.page/r/CdrHqDugZPp5EBE/review\n\n— Classul'
  };
}

let pool = null;

// Hook usado apenas pelos testes (pg-mem).
export function _setPoolForTests(testPool) {
  pool = testPool;
}

export function getPool() {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
    if (!connectionString) {
      throw new Error(
        'Banco de dados não configurado. Crie um Postgres (Storage → Neon) na Vercel ou defina DATABASE_URL.'
      );
    }
    pool = new pg.Pool({
      connectionString,
      max: 3,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false }
    });
  }
  return pool;
}

export const q = (text, params) => getPool().query(text, params);

let readyPromise = null;

// Garante o schema uma vez por cold start da função.
export function ensureSchema() {
  if (!readyPromise) {
    readyPromise = initSchema().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

async function initSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT,
      description TEXT,
      product_type TEXT,
      case_color TEXT,
      value TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'novo',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS message_log (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      status_trigger TEXT NOT NULL,
      phone TEXT,
      body TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
  for (const [key, value] of Object.entries(defaultSettings())) {
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
  }
}

export async function getSettings() {
  const { rows } = await q('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function setSettings(partial) {
  for (const [key, value] of Object.entries(partial)) {
    if (!DEFAULT_SETTINGS_KEYS.includes(key)) continue;
    await q(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, String(value ?? '')]
    );
  }
  return getSettings();
}
