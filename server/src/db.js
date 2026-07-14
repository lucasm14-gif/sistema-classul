import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = process.env.DB_PATH || './data/classul.db';
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT,
    description TEXT,
    product_type TEXT,
    case_color TEXT,
    value TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'novo',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status_trigger TEXT NOT NULL,
    phone TEXT,
    body TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`);

export const STATUSES = ['novo', 'producao', 'pronto', 'entregue'];

const DEFAULT_SETTINGS = {
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

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSetting.run(key, value);
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSettings(partial) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) upsert.run(key, String(value ?? ''));
  });
  tx(Object.entries(partial).filter(([key]) => key in DEFAULT_SETTINGS));
  return getSettings();
}
