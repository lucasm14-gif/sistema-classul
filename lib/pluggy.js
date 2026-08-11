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

// No plano gratuito (Meu Pluggy) todas as conexões chegam pelo conector agregador,
// então `connector.name` vem como "MeuPluggy" para todos os bancos. Nesses casos
// tentamos descobrir a instituição real pelos nomes das contas/cartões.
const GENERIC_CONNECTOR = /^\s*(meu\s*pluggy|pluggy|connector\s*200)\s*$/i;

const BANK_KEYWORDS = [
  ['nubank', 'Nubank'],
  ['nu pagamentos', 'Nubank'],
  ['nuinvest', 'NuInvest'],
  ['mercado pago', 'Mercado Pago'],
  ['mercadopago', 'Mercado Pago'],
  ['banco inter', 'Inter'],
  ['inter', 'Inter'],
  ['itau', 'Itaú'],
  ['itaú', 'Itaú'],
  ['bradesco', 'Bradesco'],
  ['santander', 'Santander'],
  ['caixa', 'Caixa'],
  ['banco do brasil', 'Banco do Brasil'],
  ['c6 bank', 'C6 Bank'],
  ['c6', 'C6 Bank'],
  ['picpay', 'PicPay'],
  ['pagbank', 'PagBank'],
  ['pagseguro', 'PagBank'],
  ['will bank', 'Will Bank'],
  ['neon', 'Neon'],
  ['banco original', 'Original'],
  ['safra', 'Safra'],
  ['sicoob', 'Sicoob'],
  ['sicredi', 'Sicredi'],
  ['btg', 'BTG Pactual'],
  ['banrisul', 'Banrisul'],
  ['votorantim', 'BV'],
  ['stone', 'Stone'],
  ['ame digital', 'Ame'],
  ['rico', 'Rico'],
  ['clear', 'Clear'],
  ['xp investimentos', 'XP'],
  ['nomad', 'Nomad'],
  ['wise', 'Wise']
];

// Descobre o nome a exibir para uma conexão, na ordem:
// 1) apelido definido pelo usuário  2) conector real (quando não é o agregador)
// 3) banco inferido dos nomes das contas  4) nome da conta  5) genérico.
export function resolveConnectorName({ label, connectorName, accounts = [], fallback = 'Conexão' }) {
  const nick = String(label || '').trim();
  if (nick) return nick;

  const real = String(connectorName || '').trim();
  if (real && !GENERIC_CONNECTOR.test(real)) return real;

  const haystack = accounts
    .map((a) => `${a.name || ''} ${a.marketingName || ''} ${a.owner || ''}`)
    .join(' ')
    .toLowerCase();
  for (const [needle, name] of BANK_KEYWORDS) {
    if (haystack.includes(needle)) return name;
  }

  const first = accounts.find((a) => a.marketingName || a.name);
  if (first) return String(first.marketingName || first.name).trim().slice(0, 40);
  // Aqui `real` só pode ser o nome genérico do agregador (ou vazio): usar o
  // fallback neutro é melhor do que repetir "MeuPluggy" em toda conexão.
  return fallback;
}

// Nome amigável (PT) da classe de um investimento, a partir do type da Pluggy.
function investClass(type) {
  const map = {
    FIXED_INCOME: 'Renda Fixa',
    MUTUAL_FUND: 'Fundos',
    EQUITY: 'Ações',
    ETF: 'ETF',
    SECURITY: 'Títulos',
    COE: 'COE',
    PENSION: 'Previdência',
    CRYPTO: 'Cripto'
  };
  return map[String(type || '').toUpperCase()] || 'Outros';
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

// Agrega um conjunto de contas/lançamentos/investimentos num "recorte" do painel.
// O mesmo cálculo roda para o consolidado e para cada instituição, de modo que
// filtrar por banco recalcula TUDO (totais, gráfico, categorias, ativos), não só listas.
function buildSlice(accounts, txs, invs, { days, now, monthKey, prevMonthKey }) {
  let bankTotal = 0;
  let creditOwed = 0;
  let creditLimit = 0;
  let creditAvailable = 0;
  let investTotal = 0;

  for (const a of accounts) {
    if (a.type === 'CREDIT') {
      creditOwed += a.balance;
      creditLimit += a.credit?.limit || 0;
      creditAvailable += a.credit?.available || 0;
    } else {
      bankTotal += a.balance;
    }
  }
  for (const iv of invs) investTotal += iv.balance;

  // Série diária de gastos e entradas (últimos `days` dias).
  const series = [];
  const seriesMap = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = ymd(d);
    const bucket = { day: key, expense: 0, income: 0 };
    series.push(bucket);
    seriesMap.set(key, bucket);
  }

  const byCat = new Map();
  let monthExpense = 0;
  let monthIncome = 0;
  let cardMonth = 0;
  let bankOutMonth = 0;
  let prevMonthExpense = 0;

  for (const t of txs) {
    const dateKey = ymd(new Date(t.date));
    const exp = txExpense(t.account_type, t.amount);
    const inc = txIncome(t.account_type, t.amount);
    const bucket = seriesMap.get(dateKey);
    if (bucket) {
      bucket.expense += exp;
      bucket.income += inc;
    }
    const mk = dateKey.slice(0, 7);
    if (mk === monthKey) {
      monthExpense += exp;
      monthIncome += inc;
      if (t.account_type === 'CREDIT') cardMonth += exp;
      else bankOutMonth += exp;
      if (exp > 0) {
        const cat = t.category || 'Outros';
        byCat.set(cat, (byCat.get(cat) || 0) + exp);
      }
    } else if (mk === prevMonthKey) {
      prevMonthExpense += exp;
    }
  }

  const categories = [...byCat.entries()]
    .map(([name, total]) => ({ name, total, share: monthExpense > 0 ? total / monthExpense : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const recent = [...txs]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 25)
    .map((t) => {
      const exp = txExpense(t.account_type, t.amount);
      const inc = txIncome(t.account_type, t.amount);
      return {
        id: t.id,
        description: t.description,
        date: t.date,
        category: t.category,
        account: t.account_name,
        connector: t.connector,
        item_id: t.item_id,
        direction: exp > 0 ? 'out' : inc > 0 ? 'in' : 'neutral',
        value: exp > 0 ? exp : inc > 0 ? inc : Math.abs(t.amount)
      };
    });

  // Contas bancárias agrupadas por instituição (participação % no total).
  const bankMap = new Map();
  for (const a of accounts) {
    if (a.type === 'CREDIT') continue;
    const g = bankMap.get(a.connector) || {
      item_id: a.item_id,
      name: a.connector,
      image: a.connector_image,
      total: 0,
      count: 0
    };
    g.total += a.balance;
    g.count += 1;
    bankMap.set(a.connector, g);
  }
  const banks = [...bankMap.values()]
    .map((g) => ({ ...g, share: bankTotal > 0 ? g.total / bankTotal : 0 }))
    .sort((a, b) => b.total - a.total);

  // Cartões individuais, do maior saldo devedor ao menor.
  const cards = accounts
    .filter((a) => a.type === 'CREDIT')
    .map((a) => ({
      id: a.id,
      item_id: a.item_id,
      connector: a.connector,
      image: a.connector_image,
      name: a.name,
      number: a.number,
      balance: a.balance,
      limit: a.credit?.limit || 0,
      available: a.credit?.available || 0,
      usage: a.credit?.limit > 0 ? Math.max(0, a.balance) / a.credit.limit : 0,
      due_date: a.credit?.due_date || null,
      minimum: a.credit?.minimum || 0
    }))
    .sort((a, b) => b.balance - a.balance);

  // Investimentos por classe de ativo e por instituição.
  const groupInv = (keyFn, extra = () => ({})) => {
    const m = new Map();
    for (const iv of invs) {
      const k = keyFn(iv);
      const g = m.get(k) || { name: k, total: 0, count: 0, ...extra(iv) };
      g.total += iv.balance;
      g.count += 1;
      m.set(k, g);
    }
    return [...m.values()]
      .map((g) => ({ ...g, share: investTotal > 0 ? g.total / investTotal : 0 }))
      .sort((a, b) => b.total - a.total);
  };
  const investments = groupInv((iv) => iv.asset_class);
  const investmentsByInstitution = groupInv(
    (iv) => iv.connector,
    (iv) => ({ image: iv.connector_image, item_id: iv.item_id })
  );

  const upcoming = cards
    .filter((c) => c.balance > 0)
    .map((c) => ({
      connector: c.connector,
      name: c.name,
      amount: c.balance,
      due_date: c.due_date,
      minimum: c.minimum
    }))
    .sort((x, y) => String(x.due_date || '9999').localeCompare(String(y.due_date || '9999')));

  return {
    net_worth: bankTotal + investTotal - creditOwed,
    bank_total: bankTotal,
    invest_total: investTotal,
    credit_owed: creditOwed,
    credit_limit: creditLimit,
    credit_available: creditAvailable,
    credit_usage: creditLimit > 0 ? Math.max(0, creditOwed) / creditLimit : 0,
    month_expense: monthExpense,
    month_income: monthIncome,
    prev_month_expense: prevMonthExpense,
    // variação % do gasto do mês contra o mês anterior (null quando não há base)
    expense_trend: prevMonthExpense > 0 ? (monthExpense - prevMonthExpense) / prevMonthExpense : null,
    card_month: cardMonth,
    bank_out_month: bankOutMonth,
    tx_count: txs.length,
    series,
    categories,
    accounts,
    banks,
    cards,
    investments,
    investments_by_institution: investmentsByInstitution,
    recent,
    upcoming
  };
}

// Monta o painel consolidado a partir dos itens conectados.
// `items` = linhas de finance_items ({ item_id, connector_name, connector_image }).
// Devolve o recorte total + um recorte por instituição (chaveado por item_id).
export async function buildFinanceSummary(apiKey, items, { days = 30 } = {}) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  // A janela vai até o início do mês anterior para permitir comparar mês a mês.
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const windowStart = new Date(Math.min(startOfPrevMonth.getTime(), now.getTime() - days * 86400000));
  const fromStr = ymd(windowStart);
  const toStr = ymd(now);
  const monthKey = ymd(startOfMonth).slice(0, 7);
  const prevMonthKey = ymd(startOfPrevMonth).slice(0, 7);

  const connectors = [];
  const allAccounts = [];
  const allTx = [];
  const allInv = [];

  for (const it of items) {
    let item = null;
    try {
      item = await getItem(apiKey, it.item_id);
    } catch {
      /* item pode ter sido removido no Pluggy — segue com o que temos salvo */
    }
    // As contas vêm primeiro: no Meu Pluggy o conector é sempre o agregador, e é
    // pelos nomes das contas que descobrimos o banco real.
    let accounts = [];
    try {
      accounts = await listAccounts(apiKey, it.item_id);
    } catch {
      /* sem contas neste item */
    }

    const rawConnector = item?.connector?.name || it.connector_name || '';
    const connectorName = resolveConnectorName({
      label: it.label,
      connectorName: rawConnector,
      accounts,
      fallback: `Conexão ${connectors.length + 1}`
    });
    const connectorImage = item?.connector?.imageUrl || it.connector_image || null;
    connectors.push({
      item_id: it.item_id,
      name: connectorName,
      label: it.label || null,
      raw_connector: rawConnector || null,
      // sinaliza para a interface que o nome foi inferido e pode ser corrigido
      generic: !it.label && GENERIC_CONNECTOR.test(rawConnector),
      image: connectorImage,
      status: item?.status || null,
      execution_status: item?.executionStatus || null,
      last_update: item?.lastUpdatedAt || item?.updatedAt || null,
      error: item?.error?.message || null
    });

    for (const a of accounts) {
      const type = a.type;
      const accountName = a.name || a.marketingName || 'Conta';
      allAccounts.push({
        id: a.id,
        item_id: it.item_id,
        connector: connectorName,
        connector_image: connectorImage,
        type,
        subtype: a.subtype || null,
        name: accountName,
        number: a.number || null,
        balance: num(a.balance),
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
        allTx.push({
          id: t.id,
          description: t.description || 'Lançamento',
          date: t.date,
          category: t.category || null,
          amount: num(t.amount),
          account_id: a.id,
          account_name: accountName,
          account_type: type,
          item_id: it.item_id,
          connector: connectorName
        });
      }
    }

    try {
      const invs = await listInvestments(apiKey, it.item_id);
      for (const inv of invs) {
        allInv.push({
          item_id: it.item_id,
          connector: connectorName,
          connector_image: connectorImage,
          asset_class: investClass(inv.type || inv.subtype),
          name: inv.name || 'Investimento',
          balance: num(inv.balance)
        });
      }
    } catch {
      /* item sem investimentos */
    }
  }

  const ctx = { days, now, monthKey, prevMonthKey };
  const total = buildSlice(allAccounts, allTx, allInv, ctx);

  const byConnector = {};
  for (const c of connectors) {
    const slice = buildSlice(
      allAccounts.filter((a) => a.item_id === c.item_id),
      allTx.filter((t) => t.item_id === c.item_id),
      allInv.filter((i) => i.item_id === c.item_id),
      ctx
    );
    byConnector[c.item_id] = slice;
    // números de destaque que o chip do filtro mostra
    c.bank_total = slice.bank_total;
    c.credit_owed = slice.credit_owed;
    c.invest_total = slice.invest_total;
    c.net_worth = slice.net_worth;
    c.month_expense = slice.month_expense;
    c.account_count = slice.accounts.length;
  }

  return {
    generated_at: new Date().toISOString(),
    month: monthKey,
    prev_month: prevMonthKey,
    window_days: days,
    connectors,
    total,
    by_connector: byConnector
  };
}
