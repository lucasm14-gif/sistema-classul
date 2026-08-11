// Testa buildFinanceSummary com respostas simuladas da Pluggy (sem rede real).
const ROOT = '/Users/lucasmac/Desktop/sistema classul';

const now = new Date();
const ymd = (d) => {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};
const thisMonth = (day) => ymd(new Date(now.getFullYear(), now.getMonth(), day));
const prevMonth = (day) => ymd(new Date(now.getFullYear(), now.getMonth() - 1, day));

// Fixtures: Inter (conta + renda fixa) e Nubank (cartão de crédito).
const FIX = {
  '/items/inter': { id: 'inter', connector: { name: 'Inter', imageUrl: 'http://x/inter.png' }, status: 'UPDATED', lastUpdatedAt: '2026-08-10T10:00:00Z' },
  '/items/nu': { id: 'nu', connector: { name: 'Nubank', imageUrl: 'http://x/nu.png' }, status: 'UPDATED', lastUpdatedAt: '2026-08-10T09:00:00Z' },
  '/accounts?itemId=inter': {
    results: [{ id: 'acc-inter', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Corrente', number: '0001/1', balance: 1000, currencyCode: 'BRL' }]
  },
  '/accounts?itemId=nu': {
    results: [{
      id: 'card-nu', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Nubank Gold', number: 'xxxx3339', balance: 200, currencyCode: 'BRL',
      creditData: { creditLimit: 1000, availableCreditLimit: 800, balanceDueDate: '2026-08-20', minimumPayment: 50 }
    }]
  },
  '/investments?itemId=inter': {
    results: [
      { id: 'i1', type: 'FIXED_INCOME', name: 'CDB', balance: 500 },
      { id: 'i2', type: 'EQUITY', name: 'Ação XPTO', balance: 300 }
    ]
  },
  '/investments?itemId=nu': { results: [] }
};

// Transações: conta Inter (negativo = gasto), cartão Nubank (positivo = gasto).
const TX = {
  'acc-inter': [
    { id: 't1', description: 'Mercado', date: thisMonth(3), category: 'Supermercado', amount: -150 },
    { id: 't2', description: 'Salário', date: thisMonth(5), category: 'Salário', amount: 3000 },
    { id: 't3', description: 'Gasto mês passado', date: prevMonth(10), category: 'Outros', amount: -100 }
  ],
  'card-nu': [
    { id: 't4', description: 'Restaurante', date: thisMonth(4), category: 'Alimentação', amount: 80 },
    { id: 't5', description: 'Pagamento fatura', date: thisMonth(6), category: 'Pagamento', amount: -30 }
  ]
};

globalThis.fetch = async (url, opts) => {
  const u = String(url).replace('https://api.pluggy.ai', '');
  if (u === '/auth') return { ok: true, json: async () => ({ apiKey: 'fake-key' }) };
  if (u.startsWith('/transactions')) {
    const accountId = new URL(String(url)).searchParams.get('accountId');
    return { ok: true, json: async () => ({ results: TX[accountId] || [], totalPages: 1, page: 1 }) };
  }
  const hit = FIX[u];
  if (hit) return { ok: true, json: async () => hit };
  return { ok: false, status: 404, text: async () => 'not found ' + u };
};

const { buildFinanceSummary } = await import(`file://${ROOT}/lib/pluggy.js`);

const items = [
  { item_id: 'inter', connector_name: 'Inter', connector_image: null },
  { item_id: 'nu', connector_name: 'Nubank', connector_image: null }
];
const s = await buildFinanceSummary('fake-key', items, { days: 30 });

let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) fails++;
};

const T = s.total;
const inter = s.by_connector.inter;
const nu = s.by_connector.nu;

console.log('--- consolidado ---');
eq('bank_total', T.bank_total, 1000);
eq('invest_total', T.invest_total, 800);
eq('credit_owed', T.credit_owed, 200);
eq('net_worth (1000+800-200)', T.net_worth, 1600);
eq('credit_limit', T.credit_limit, 1000);
eq('credit_usage 20%', Math.round(T.credit_usage * 100), 20);
eq('month_expense (150 conta + 80 cartão)', T.month_expense, 230);
eq('card_month', T.card_month, 80);
eq('bank_out_month', T.bank_out_month, 150);
eq('month_income (3000 + 30 estorno)', T.month_income, 3030);
eq('prev_month_expense', T.prev_month_expense, 100);
eq('expense_trend (230 vs 100)', Number(T.expense_trend.toFixed(2)), 1.3);
eq('categorias do mês', T.categories.map((c) => [c.name, c.total]), [['Supermercado', 150], ['Alimentação', 80]]);
eq('share da maior categoria', Math.round(T.categories[0].share * 100), 65);
eq('cards', T.cards.map((c) => [c.name, c.balance, Math.round(c.usage * 100)]), [['Nubank Gold', 200, 20]]);
eq('banks', T.banks.map((b) => [b.name, b.total, b.share]), [['Inter', 1000, 1]]);
eq('invest por classe', T.investments.map((i) => [i.name, i.total]), [['Renda Fixa', 500], ['Ações', 300]]);
eq('invest por instituição', T.investments_by_institution.map((i) => [i.name, i.total]), [['Inter', 800]]);
eq('upcoming (fatura)', T.upcoming.map((u) => [u.connector, u.amount, u.due_date]), [['Nubank', 200, '2026-08-20']]);
// desc por data: t5(dia6), t2(dia5), t4(dia4), t1(dia3), t3(mês anterior)
eq('recent ordenado desc', T.recent.map((r) => r.id), ['t5', 't2', 't4', 't1', 't3']);
eq('recent marca direção', T.recent.map((r) => [r.id, r.direction, r.value]), [
  ['t5', 'in', 30], ['t2', 'in', 3000], ['t4', 'out', 80], ['t1', 'out', 150], ['t3', 'out', 100]
]);
eq('tx_count', T.tx_count, 5);

console.log('--- recorte Inter ---');
eq('inter bank_total', inter.bank_total, 1000);
eq('inter credit_owed (0)', inter.credit_owed, 0);
eq('inter invest_total', inter.invest_total, 800);
eq('inter net_worth', inter.net_worth, 1800);
eq('inter month_expense (só 150)', inter.month_expense, 150);
eq('inter categorias', inter.categories.map((c) => c.name), ['Supermercado']);
eq('inter sem cartões', inter.cards.length, 0);
eq('inter recent só do Inter', [...new Set(inter.recent.map((r) => r.connector))], ['Inter']);

console.log('--- recorte Nubank ---');
eq('nu bank_total (0)', nu.bank_total, 0);
eq('nu credit_owed', nu.credit_owed, 200);
eq('nu net_worth (-200)', nu.net_worth, -200);
eq('nu month_expense (80)', nu.month_expense, 80);
eq('nu card_month', nu.card_month, 80);
eq('nu sem investimentos', nu.investments.length, 0);
eq('nu prev_month_expense (0)', nu.prev_month_expense, 0);
eq('nu expense_trend null sem base', nu.expense_trend, null);

console.log('--- consistência ---');
eq('soma dos net_worth por banco = total', inter.net_worth + nu.net_worth, T.net_worth);
eq('soma dos month_expense = total', inter.month_expense + nu.month_expense, T.month_expense);
eq('connectors com destaques', s.connectors.map((c) => [c.name, c.net_worth, c.account_count]), [['Inter', 1800, 1], ['Nubank', -200, 1]]);
eq('série tem 30 dias', T.series.length, 30);
eq('série soma os gastos da janela', T.series.reduce((a, b) => a + b.expense, 0), 230);
eq('série tem entradas', T.series.reduce((a, b) => a + b.income, 0), 3030);

console.log('--- nome do banco (Meu Pluggy manda "MeuPluggy" para todos) ---');
const { resolveConnectorName } = await import(`file://${ROOT}/lib/pluggy.js`);
const rn = (o) => resolveConnectorName(o);
eq(
  'infere Nubank pelo nome do cartão',
  rn({ connectorName: 'MeuPluggy', accounts: [{ name: 'Nubank Gold', marketingName: '' }] }),
  'Nubank'
);
eq(
  'infere Mercado Pago',
  rn({ connectorName: 'MeuPluggy', accounts: [{ name: 'Mercado Pago', number: 'xxxx1705' }] }),
  'Mercado Pago'
);
eq(
  'infere Inter pelo marketingName',
  rn({ connectorName: 'Meu Pluggy', accounts: [{ name: 'Conta Corrente', marketingName: 'Banco Inter' }] }),
  'Inter'
);
eq('apelido do usuário tem prioridade', rn({ label: 'Meu Inter', connectorName: 'Nubank', accounts: [] }), 'Meu Inter');
eq(
  'conector real não é sobrescrito',
  rn({ connectorName: 'Itaú', accounts: [{ name: 'Nubank Gold' }] }),
  'Itaú'
);
eq(
  'sem pista usa o nome da conta',
  rn({ connectorName: 'MeuPluggy', accounts: [{ name: 'Conta Corrente' }] }),
  'Conta Corrente'
);
eq('sem nada cai no fallback', rn({ connectorName: 'MeuPluggy', accounts: [], fallback: 'Conexão 2' }), 'Conexão 2');

console.log(fails === 0 ? '\n🎉 todos passaram' : `\n💥 ${fails} falharam`);
process.exit(fails ? 1 : 0);
