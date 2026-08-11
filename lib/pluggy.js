// Integração com a API da Pluggy (Open Finance).
// Para uso PESSOAL usamos o "Meu Pluggy" (gratuito): o dono conecta seus próprios
// bancos e gera um Client ID / Client Secret. Aqui trocamos essas credenciais por
// uma apiKey (válida ~2h) e consultamos contas, transações e investimentos.
// Docs: https://docs.pluggy.ai — todas as chamadas autenticadas usam o header X-API-KEY.

const PLUGGY_BASE = 'https://api.pluggy.ai';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Data local no formato YYYY-MM-DD.
function ymd(date) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Quanto uma transação representa de GASTO, conforme o tipo da conta.
// Cartão de crédito: valores positivos são compras (aumentam a fatura).
// Conta bancária: valores negativos são saídas de dinheiro.
function txExpense(accountType, amount) {
  if (accountType === 'CREDIT') return amount > 0 ? amount : 0;
  return amount < 0 ? -amount : 0;
}

// Quanto uma transação representa de ENTRADA de dinheiro.
function txIncome(accountType, amount) {
  if (accountType === 'CREDIT') return amount < 0 ? -amount : 0; // pagamento/estorno da fatura
  return amount > 0 ? amount : 0;
}

async function pluggyError(res, label) {
  const body = await res.text().catch(() => '');
  return new Error(`Pluggy ${label} (${res.status}): ${body.slice(0, 250)}`);
}

// Troca clientId/clientSecret pela apiKey usada nas demais chamadas.
export async function pluggyAuth(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new Error('Configure o Client ID e o Client Secret da Pluggy antes de sincronizar.');
  }
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret })
  });
  if (!res.ok) throw await pluggyError(res, 'auth');
  const data = await res.json();
  if (!data.apiKey) throw new Error('A Pluggy não retornou a apiKey. Verifique as credenciais.');
  return data.apiKey;
}

async function pget(apiKey, path) {
  const res = await fetch(`${PLUGGY_BASE}${path}`, { headers: { 'X-API-KEY': apiKey } });
  if (!res.ok) throw await pluggyError(res, path);
  return res.json();
}

// Cria o connect token usado para abrir o widget Pluggy Connect no navegador.
// Passe itemId para ATUALIZAR uma conexão existente; omita para criar uma nova.
export async function createConnectToken(apiKey, itemId, options = {}) {
  const body = { options };
  if (itemId) body.itemId = itemId;
  const res = await fetch(`${PLUGGY_BASE}/connect_token`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await pluggyError(res, 'connect_token');
  const data = await res.json();
  return data.accessToken;
}

export async function getItem(apiKey, itemId) {
  return pget(apiKey, `/items/${itemId}`);
}

export async function listAccounts(apiKey, itemId) {
  const data = await pget(apiKey, `/accounts?itemId=${encodeURIComponent(itemId)}`);
  return data.results || [];
}

export async function listInvestments(apiKey, itemId) {
  const data = await pget(apiKey, `/investments?itemId=${encodeURIComponent(itemId)}`);
  return data.results || [];
}

// Transações de uma conta no período. Pagina por página (até 6 páginas = 3000 lançamentos).
export async function listTransactions(apiKey, accountId, from, to) {
  const out = [];
  let page = 1;
  for (let i = 0; i < 6; i++) {
    const data = await pget(
      apiKey,
      `/transactions?accountId=${encodeURIComponent(accountId)}&from=${from}&to=${to}&page=${page}&pageSize=500`
    );
    const results = data.results || [];
    out.push(...results);
    const totalPages = data.totalPages || 1;
    if (page >= totalPages || results.length === 0) break;
    page += 1;
  }
  return out;
}

// Monta o painel consolidado a partir dos itens conectados.
// `items` = linhas de finance_items ({ item_id, connector_name, connector_image }).
export async function buildFinanceSummary(apiKey, items, { days = 30 } = {}) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = new Date(Math.min(startOfMonth.getTime(), now.getTime() - days * 86400000));
  const fromStr = ymd(windowStart);
  const toStr = ymd(now);
  const monthKey = ymd(startOfMonth).slice(0, 7);

  const accountsOut = [];
  const connectors = [];
  const allTx = [];
  let bankTotal = 0;
  let creditOwed = 0;
  let creditLimit = 0;
  let creditAvailable = 0;
  let investTotal = 0;

  for (const it of items) {
    let item = null;
    try {
      item = await getItem(apiKey, it.item_id);
    } catch {
      /* item pode ter sido removido no Pluggy — segue com o que temos salvo */
    }
    const connectorName = item?.connector?.name || it.connector_name || 'Banco';
    const connectorImage = item?.connector?.imageUrl || it.connector_image || null;
    connectors.push({
      item_id: it.item_id,
      name: connectorName,
      image: connectorImage,
      status: item?.status || null,
      execution_status: item?.executionStatus || null,
      last_update: item?.lastUpdatedAt || item?.updatedAt || null,
      error: item?.error?.message || null
    });

    let accounts = [];
    try {
      accounts = await listAccounts(apiKey, it.item_id);
    } catch {
      /* sem contas neste item */
    }

    for (const a of accounts) {
      const type = a.type;
      const balance = num(a.balance);
      if (type === 'CREDIT') {
        creditOwed += balance;
        creditLimit += num(a.creditData?.creditLimit);
        creditAvailable += num(a.creditData?.availableCreditLimit);
      } else {
        bankTotal += balance;
      }
      accountsOut.push({
        id: a.id,
        item_id: it.item_id,
        connector: connectorName,
        connector_image: connectorImage,
        type,
        subtype: a.subtype || null,
        name: a.name || a.marketingName || 'Conta',
        number: a.number || null,
        balance,
        currency: a.currencyCode || 'BRL',
        credit:
          type === 'CREDIT'
            ? {
                limit: num(a.creditData?.creditLimit),
                available: num(a.creditData?.availableCreditLimit),
                due_date: a.creditData?.balanceDueDate || null,
                minimum: num(a.creditData?.minimumPayment)
              }
            : null
      });

      let txs = [];
      try {
        txs = await listTransactions(apiKey, a.id, fromStr, toStr);
      } catch {
        /* sem transações */
      }
      for (const t of txs) {
        allTx.push({ ...t, _type: type, _account: a.name || a.marketingName || 'Conta', _connector: connectorName });
      }
    }

    try {
      const invs = await listInvestments(apiKey, it.item_id);
      for (const inv of invs) investTotal += num(inv.balance);
    } catch {
      /* item sem investimentos */
    }
  }

  // Série diária de gastos (últimos `days` dias).
  const series = [];
  const seriesMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = ymd(d);
    const bucket = { day: key, expense: 0 };
    series.push(bucket);
    seriesMap.set(key, bucket);
  }

  const byCat = new Map();
  let monthExpense = 0;
  let monthIncome = 0;
  let cardMonth = 0;
  let bankOutMonth = 0;

  for (const t of allTx) {
    const dateKey = ymd(new Date(t.date));
    const amount = num(t.amount);
    const exp = txExpense(t._type, amount);
    const inc = txIncome(t._type, amount);
    const bucket = seriesMap.get(dateKey);
    if (bucket) bucket.expense += exp;
    if (dateKey.slice(0, 7) === monthKey) {
      monthExpense += exp;
      monthIncome += inc;
      if (t._type === 'CREDIT') cardMonth += exp;
      else bankOutMonth += exp;
      if (exp > 0) {
        const cat = t.category || 'Outros';
        byCat.set(cat, (byCat.get(cat) || 0) + exp);
      }
    }
  }

  allTx.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = allTx.slice(0, 20).map((t) => {
    const amount = num(t.amount);
    const exp = txExpense(t._type, amount);
    const inc = txIncome(t._type, amount);
    return {
      id: t.id,
      description: t.description || 'Lançamento',
      date: t.date,
      category: t.category || null,
      account: t._account,
      connector: t._connector,
      direction: exp > 0 ? 'out' : inc > 0 ? 'in' : 'neutral',
      value: exp > 0 ? exp : inc > 0 ? inc : Math.abs(amount)
    };
  });

  const categories = [...byCat.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const upcoming = accountsOut
    .filter((a) => a.type === 'CREDIT' && a.balance > 0)
    .map((a) => ({
      connector: a.connector,
      name: a.name,
      amount: a.balance,
      due_date: a.credit?.due_date || null,
      minimum: a.credit?.minimum || 0
    }))
    .sort((x, y) => String(x.due_date || '9999').localeCompare(String(y.due_date || '9999')));

  return {
    generated_at: new Date().toISOString(),
    month: monthKey,
    net_worth: bankTotal + investTotal - creditOwed,
    bank_total: bankTotal,
    invest_total: investTotal,
    credit_owed: creditOwed,
    credit_limit: creditLimit,
    credit_available: creditAvailable,
    month_expense: monthExpense,
    month_income: monthIncome,
    card_month: cardMonth,
    bank_out_month: bankOutMonth,
    series,
    categories,
    accounts: accountsOut,
    connectors,
    recent,
    upcoming
  };
}
