// Smoke test da aba Finanças (trava por PIN + config Pluggy) com Postgres em memória.
process.env.API_TOKEN = 'teste-token';
process.env.EVOLUTION_URL = 'https://evolution.scalemidia.com.br';
process.env.EVOLUTION_APIKEY = 'fake';
process.env.EVOLUTION_INSTANCE = '';

import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests } = await import(`file://${ROOT}/lib/db.js`);
const { default: app } = await import(`file://${ROOT}/api/index.js`);

const mem = newDb();
const pgAdapter = mem.adapters.createPg();
_setPoolForTests(new pgAdapter.Pool());

const server = app.listen(3122);
const B = 'http://localhost:3122/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

const j = (r) => r.json();

// 1) status inicial: sem PIN, sem credenciais, 0 itens
let r = await fetch(`${B}/finance/status`, { headers: H });
let s = await j(r);
check('status inicial', r.status === 200 && s.has_pin === false && s.has_credentials === false && s.item_count === 0, JSON.stringify(s));

// 2) config/summary bloqueados sem finance token (403 finance_locked)
r = await fetch(`${B}/finance/summary`, { headers: H });
let body = await j(r);
check('summary bloqueado sem PIN', r.status === 403 && body.finance_locked === true);

// 3) criar PIN
r = await fetch(`${B}/finance/pin`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '4321' }) });
let pinRes = await j(r);
const FIN = pinRes.token;
check('criar PIN devolve token', r.status === 200 && typeof FIN === 'string' && FIN.length > 10);

// 4) PIN muito curto é rejeitado
r = await fetch(`${B}/finance/pin`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '12', current_pin: '4321' }) });
check('PIN curto rejeitado', r.status === 400);

// 5) unlock com PIN errado
r = await fetch(`${B}/finance/unlock`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '0000' }) });
check('unlock PIN errado', r.status === 403);

// 6) unlock com PIN certo devolve o mesmo token
r = await fetch(`${B}/finance/unlock`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '4321' }) });
let un = await j(r);
check('unlock PIN certo', r.status === 200 && un.token === FIN, un.token === FIN ? '' : 'token diferente');

const FH = { ...H, 'X-Finance-Token': FIN };

// 7) status agora tem PIN
r = await fetch(`${B}/finance/status`, { headers: H });
s = await j(r);
check('status com PIN', s.has_pin === true);

// 8) finance token inválido é barrado
r = await fetch(`${B}/finance/config`, { headers: { ...H, 'X-Finance-Token': 'errado' } });
check('finance token inválido barrado', r.status === 403);

// 9) config acessível com token válido
r = await fetch(`${B}/finance/config`, { headers: FH });
let cfg = await j(r);
check('config vazia com token', r.status === 200 && cfg.has_secret === false);

// 10) salvar credenciais Pluggy
r = await fetch(`${B}/finance/config`, {
  method: 'PUT',
  headers: FH,
  body: JSON.stringify({ client_id: 'abc-123', client_secret: 'segredo-xyz' })
});
cfg = await j(r);
check('salvar credenciais', r.status === 200 && cfg.client_id === 'abc-123' && cfg.has_secret === true);

// 11) status agora tem credenciais
r = await fetch(`${B}/finance/status`, { headers: H });
s = await j(r);
check('status com credenciais', s.has_credentials === true);

// 12) summary sem itens: retorna empty (não chama a Pluggy)
r = await fetch(`${B}/finance/summary`, { headers: FH });
body = await j(r);
check('summary vazio sem bancos', r.status === 200 && body.empty === true);

// 13) /api/settings NÃO vaza chaves de finanças
r = await fetch(`${B}/settings`, { headers: H });
let settings = await j(r);
check(
  'settings não vaza segredos de finanças',
  !('pluggy_client_secret' in settings) && !('pluggy_client_id' in settings) && !('finance_pin_hash' in settings),
  Object.keys(settings).filter((k) => k.includes('pluggy') || k.includes('finance')).join(',') || 'ok'
);

// 14) trocar o PIN exige o PIN atual
r = await fetch(`${B}/finance/pin`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '9999' }) });
check('trocar PIN sem atual falha', r.status === 403);

r = await fetch(`${B}/finance/pin`, { method: 'POST', headers: H, body: JSON.stringify({ pin: '9999', current_pin: '4321' }) });
let changed = await j(r);
check('trocar PIN com atual ok', r.status === 200 && changed.token !== FIN);

server.close();
console.log('\n— fim —');
