// Testa o analista de conversas com OpenAI e Evolution "mockados"
// (nenhuma chamada externa real). Cobre o fluxo real da Classul:
// orçamento → informações → arte → aprovação → produção.
process.env.API_TOKEN = 'teste-token';

import { newDb } from 'pg-mem';

const ROOT = '/Users/lucasmac/Desktop/sistema classul';
const { _setPoolForTests, setSettings, ensureSchema } = await import(`file://${ROOT}/lib/db.js`);

const mem = newDb();
_setPoolForTests(new (mem.adapters.createPg()).Pool());

const { default: app } = await import(`file://${ROOT}/api/index.js`);

// --- mocks de rede: só a OpenAI; localhost passa pelo fetch real ---
const realFetch = globalThis.fetch;
let analysis = {};
let openaiCalls = 0;
let lastPrompt = '';
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('openai.com')) {
    openaiCalls++;
    lastPrompt = JSON.parse(opts.body).messages.map((m) => m.content).join('\n');
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) };
  }
  // qualquer coisa de Evolution falha (não queremos rede nos testes)
  if (u.includes('evolution')) return { ok: false, status: 401, text: async () => 'sem rede', json: async () => ({}) };
  return realFetch(url, opts);
};

const server = app.listen(3130);
const B = 'http://localhost:3130/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer teste-token' };
const HU = { ...H, 'X-Classul-User': 'Lucas' };

const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

await ensureSchema();
await setSettings({ openai_api_key: 'sk-teste', openai_model: 'gpt-4o-mini' });

let r = await fetch(`${B}/settings`, { headers: H });
const secret = (await r.json()).bot_webhook_secret;

const PHONE = '5551933334444';
const say = (text, fromMe = false) =>
  fetch(`${B}/bot/webhook?secret=${secret}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: `m${Math.random().toString(16).slice(2)}`, fromMe },
        pushName: 'Dona Marta',
        message: { conversation: text }
      }
    })
  });

// acompanha a conversa
await fetch(`${B}/watched-chats/${PHONE}`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ name: 'Dona Marta' })
});

// ---------- 1. cliente diz o que quer ----------
analysis = {
  fase: 'orcamento',
  tem_pedido: true,
  cliente: 'Dona Marta',
  produto: 'Placa de Homenagem',
  tamanho: '14x20',
  quantidade: 1,
  valor: null,
  prazo: '2026-10-02',
  descricao: 'Homenagem de aposentadoria para o Sr. Antônio',
  arte_aprovada: false,
  evidencia: null,
  resumo: 'Cliente pediu orçamento de placa de homenagem 14x20 para 02/10.'
};
await say('Bom dia! Queria uma placa de homenagem 14x20 para aposentadoria, preciso até dia 2 de outubro');

check('analista foi chamado pelo observador', openaiCalls === 1, `${openaiCalls} chamada(s)`);
check('prompt descreve o fluxo da Classul', /cliente aprova/i.test(lastPrompt) && /orçamento/i.test(lastPrompt));
check('prompt marca quem falou', /\[CLIENTE\]/.test(lastPrompt));

r = await fetch(`${B}/suggestions`, { headers: H });
let suggestions = await r.json();
check(
  'sugestão de pedido novo criada',
  suggestions.length === 1 && suggestions[0].kind === 'novo_pedido' && suggestions[0].data.tamanho === '14x20',
  JSON.stringify(suggestions[0]?.data)
);
check('fase traduzida para o painel', suggestions[0].stage_label === 'Aguardando orçamento', suggestions[0].stage_label);

// nova mensagem logo em seguida não re-analisa (trava de custo)
const antes = openaiCalls;
await say('esqueci de dizer: o nome é Antônio Carlos');
check('não reanalisa a cada mensagem', openaiCalls === antes, `${openaiCalls} chamadas`);

// forçar análise pelo botão "Analisar agora"
analysis.resumo = 'Aguardando o orçamento ser passado.';
r = await fetch(`${B}/watched-chats/${PHONE}/analyze`, { method: 'POST', headers: H });
check('analisar agora ignora a trava', openaiCalls === antes + 1 && (await r.json()).analyzed === true);

r = await fetch(`${B}/suggestions`, { headers: H });
check('sugestão é atualizada, não duplicada', (await r.json()).length === 1);

// ---------- 2. aceitar a sugestão vira pedido ----------
r = await fetch(`${B}/suggestions/${suggestions[0].id}/accept`, { method: 'POST', headers: HU, body: '{}' });
const accepted = await r.json();
check(
  'aceitar cria o pedido com o que foi extraído',
  r.status === 201 &&
    accepted.order.customer_name === 'Dona Marta' &&
    accepted.order.product === 'Placa de Homenagem' &&
    accepted.order.size === '14x20' &&
    accepted.order.due_date === '2026-10-02' &&
    accepted.order.created_by === 'Lucas',
  JSON.stringify({ p: accepted.order?.product, s: accepted.order?.size, d: accepted.order?.due_date })
);
const orderId = accepted.order.id;

r = await fetch(`${B}/clients`, { headers: H });
check('cliente criado e vinculado', (await r.json()).some((c) => c.phone === PHONE));

r = await fetch(`${B}/suggestions`, { headers: H });
check('sugestão sai da fila depois de aceita', (await r.json()).length === 0);

// ---------- 3. com pedido aberto, não sugere outro ----------
analysis = { ...analysis, fase: 'informacoes', arte_aprovada: false, resumo: 'Cliente mandou os dados da arte.' };
r = await fetch(`${B}/watched-chats/${PHONE}/analyze`, { method: 'POST', headers: H });
check('com pedido aberto não cria pedido duplicado', (await r.json()).suggestion === null);
check('prompt avisa que já existe pedido', /JÁ EXISTE UM PEDIDO ABERTO/.test(lastPrompt));

// ---------- 4. aprovação da arte ----------
analysis = {
  ...analysis,
  fase: 'aprovado',
  arte_aprovada: true,
  evidencia: 'Ficou perfeito, pode produzir!',
  resumo: 'Cliente aprovou a arte e liberou a produção.'
};
r = await fetch(`${B}/watched-chats/${PHONE}/analyze`, { method: 'POST', headers: H });
await r.json();

r = await fetch(`${B}/suggestions`, { headers: H });
suggestions = await r.json();
check(
  'aprovação da arte vira sugestão ligada ao pedido',
  suggestions.length === 1 &&
    suggestions[0].kind === 'arte_aprovada' &&
    suggestions[0].order?.id === orderId &&
    suggestions[0].data.evidencia === 'Ficou perfeito, pode produzir!',
  JSON.stringify({ kind: suggestions[0]?.kind, order: suggestions[0]?.order?.order_number })
);

r = await fetch(`${B}/suggestions/${suggestions[0].id}/accept`, { method: 'POST', headers: HU, body: '{}' });
const moved = await r.json();
check('aceitar a aprovação move o pedido para produção', moved.order.status === 'producao', moved.order?.status);

r = await fetch(`${B}/orders/${orderId}`, { headers: H });
const full = await r.json();
check(
  'a frase do cliente fica registrada no pedido',
  full.comments.some((c) => c.body.includes('pode produzir') && c.author === 'Lucas'),
  full.comments.map((c) => c.body.slice(0, 40)).join(' | ')
);

// ---------- 5. descartar ----------
analysis = { ...analysis, fase: 'aprovado', arte_aprovada: true, evidencia: 'pode fazer', resumo: 'De novo.' };
r = await fetch(`${B}/watched-chats/${PHONE}/analyze`, { method: 'POST', headers: H });
await r.json();
r = await fetch(`${B}/suggestions`, { headers: H });
const pend = await r.json();
r = await fetch(`${B}/suggestions/${pend[0].id}/dismiss`, { method: 'POST', headers: HU });
check('descartar sugestão', (await r.json()).ok === true);
r = await fetch(`${B}/suggestions`, { headers: H });
check('descartada sai da fila', (await r.json()).length === 0);

// ---------- 6. elogio não é aprovação (a regra está no prompt) ----------
check(
  'prompt proíbe tratar elogio como aprovação',
  /NÃO é aprovação/.test(lastPrompt) && /Na dúvida, use false/.test(lastPrompt)
);

// ---------- 7. conversa não acompanhada não gasta OpenAI ----------
const antesFinal = openaiCalls;
await fetch(`${B}/bot/webhook?secret=${secret}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5551900000000@s.whatsapp.net', id: 'x1', fromMe: false },
      message: { conversation: 'oi' }
    }
  })
});
check('conversa não acompanhada não chama a OpenAI', openaiCalls === antesFinal);

server.close();
console.log('\nFim dos testes do analista.');
