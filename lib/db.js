import pg from 'pg';
import crypto from 'crypto';

export const STATUSES = ['novo', 'producao', 'pronto', 'entregue'];

const DEFAULT_SETTINGS_KEYS = [
  'evolution_url',
  'evolution_apikey',
  'evolution_instance',
  'msg_pronto_enabled',
  'msg_pronto_template',
  'msg_entregue_enabled',
  'msg_entregue_template',
  'google_client_id',
  'google_client_secret',
  'google_refresh_token',
  'google_folder_id',
  'bot_enabled',
  'openai_api_key',
  'openai_model',
  'bot_test_number',
  'bot_products',
  'bot_system_prompt',
  'bot_webhook_secret'
];

const DEFAULT_BOT_PRODUCTS =
  '- Placa em quadro\n' +
  '- Tarjeta plaqueta do Exército Brasileiro (EB)\n' +
  '- Estojo luxo de veludo\n' +
  '- Placa de homenagem (tamanhos: 9x14, 12x17, 14x20, 16x25, 20x30 cm)\n' +
  '- Placa para jazigo\n' +
  '- Placa em aço inox escovado';

const DEFAULT_BOT_PROMPT =
  'Você é o atendente virtual de PRÉ-ATENDIMENTO da Classul, empresa de placas e brindes personalizados de Porto Alegre-RS.\n\n' +
  'Seu papel é APENAS o primeiro contato: dar boas-vindas, entender o que o cliente precisa e coletar as informações iniciais. ' +
  'Você NÃO fecha pedido, NÃO passa preço, NÃO define prazo e NÃO cria arte — tudo isso é feito por um atendente humano da Classul logo depois. Deixe isso claro de forma gentil.\n\n' +
  'Fale como uma pessoa de verdade: cordial, simples e direto, em português do Brasil, com mensagens curtas (estilo WhatsApp). Pode usar no máximo 1 emoji por mensagem.\n\n' +
  'PRODUTOS QUE PRODUZIMOS (somente estes):\n{PRODUTOS}\n\n' +
  'Se o cliente pedir algo que NÃO está na lista acima, diga com educação que no momento não estamos produzindo esse item e ofereça os que fazemos.\n\n' +
  'Antes de encerrar, entenda o essencial:\n' +
  '- Qual produto da lista o cliente quer\n' +
  '- Uma ideia do que ele deseja (ocasião, texto/homenagem, tamanho quando fizer sentido, quantidade)\n\n' +
  'TAMANHOS: sempre que o cliente perguntar ou falar sobre tamanho, informe TODOS os tamanhos da placa de homenagem: 9x14, 12x17, 14x20, 16x25 e 20x30 cm. Nesse caso, envie também a foto [[FOTO:placa_homenagem]].\n\n' +
  'FOTOS: SEMPRE que o cliente perguntar sobre um produto, demonstrar interesse ou pedir para ver, envie as fotos daquele produto. Para enviar, escreva numa linha separada exatamente o marcador do produto (o sistema envia todas as fotos dele):\n' +
  '[[FOTO:placa_homenagem]] — placas de homenagem em estojo de veludo\n' +
  '[[FOTO:placa_inauguracao]] — placa de inauguração\n' +
  '[[FOTO:plaqueta_eb]] — plaquetas de identificação do Exército (EB)\n' +
  '[[FOTO:estojos]] — estojos de luxo em veludo (preto, azul, vermelho, vários tamanhos)\n' +
  'Envie o marcador do produto certo assim que o cliente disser qual produto quer. Não peça permissão para mandar as fotos, apenas mande.\n\n' +
  'Quando já tiver entendido o essencial, faça um breve resumo do que entendeu para o cliente, avise que um atendente da Classul vai dar sequência (arte, valores e prazo) e se despeça. ' +
  'Só nesse momento, escreva numa linha separada, exatamente ao final: [[ATENDIDO]]\n\n' +
  'Nunca invente preços, prazos ou informações. Não escreva [[ATENDIDO]] antes de entender o pedido.';

function defaultSettings() {
  return {
    evolution_url: process.env.EVOLUTION_URL || '',
    evolution_apikey: process.env.EVOLUTION_APIKEY || '',
    evolution_instance: process.env.EVOLUTION_INSTANCE || '',
    msg_pronto_enabled: '1',
    msg_pronto_template:
      'Olá {nome}! 🎉\n\nSeu pedido {pedido} está PRONTO!\n\n🔑 Código de retirada: {codigo}\nInforme esse código na hora de pegar o pedido.\n\nJá pode combinar a retirada ou aguardar o envio. Qualquer dúvida estamos à disposição.\n\n— Classul',
    msg_entregue_enabled: '1',
    msg_entregue_template:
      'Olá {nome}! ✅\n\nSeu pedido {pedido} foi enviado/entregue.\n\nAgradecemos muito pela preferência! Se puder, deixe sua avaliação no Google, isso nos ajuda demais:\n🔗 https://g.page/r/CdrHqDugZPp5EBE/review\n\n— Classul',
    google_client_id: process.env.GOOGLE_CLIENT_ID || '',
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    google_refresh_token: '',
    google_folder_id: '',
    bot_enabled: '0',
    openai_api_key: process.env.OPENAI_API_KEY || '',
    openai_model: 'gpt-4o-mini',
    bot_test_number: '',
    bot_products: DEFAULT_BOT_PRODUCTS,
    bot_system_prompt: DEFAULT_BOT_PROMPT,
    bot_webhook_secret: crypto.randomBytes(16).toString('hex')
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
  await q(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      company TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      drive_file_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT,
      size BIGINT,
      web_view_link TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS bot_conversations (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      push_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      handled_reason TEXT,
      handled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS bot_messages (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      wa_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  for (const ddl of [
    'ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id INTEGER',
    'ALTER TABLE orders ADD COLUMN IF NOT EXISTS drive_folder_id TEXT',
    'ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ',
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pendente'",
    'ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT',
    "ALTER TABLE attachments ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'arquivo'"
  ]) {
    try {
      await q(ddl);
    } catch {
      try {
        await q(ddl.replace(' IF NOT EXISTS', ''));
      } catch {
        // coluna já existe
      }
    }
  }
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
