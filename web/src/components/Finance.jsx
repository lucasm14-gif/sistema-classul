import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PluggyConnect } from 'react-pluggy-connect';
import {
  Lock,
  ShieldCheck,
  Wallet,
  Landmark,
  CreditCard,
  TrendingDown,
  TrendingUp,
  PiggyBank,
  Plus,
  RefreshCw,
  LockKeyhole,
  Trash2,
  Pencil,
  KeyRound,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ExternalLink
} from 'lucide-react';
import { api, FinanceLockError, getFinanceToken, setFinanceToken } from '../api';
import { useToast } from './Toast';

const fmtBRL = (n) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function dayShort(iso) {
  const [, m, d] = String(iso).split('-');
  return d && m ? `${d}/${m}` : iso;
}

function dateBR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
}

/* ------------------------------ Trava por PIN ------------------------------ */

function PinScreen({ mode, onDone, toast }) {
  const creating = mode === 'create';
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pin.length < 4) return toast('O PIN precisa ter pelo menos 4 dígitos.', 'error');
    if (creating && pin !== confirm) return toast('Os PINs não conferem.', 'error');
    setBusy(true);
    try {
      const res = creating ? await api.financeSetPin(pin) : await api.financeUnlock(pin);
      setFinanceToken(res.token);
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-6 animate-fade-up">
      <form
        onSubmit={submit}
        className="bg-white rounded-3xl border border-black/5 shadow-sm p-8 w-full max-w-sm text-center"
      >
        <span className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center mx-auto mb-4">
          {creating ? <ShieldCheck size={26} /> : <Lock size={26} />}
        </span>
        <h2 className="text-xl font-extrabold tracking-tight text-brand-950">
          {creating ? 'Criar senha das finanças' : 'Finanças bloqueadas'}
        </h2>
        <p className="text-xs font-medium text-slate-400 mt-1 mb-6">
          {creating
            ? 'Defina um PIN para proteger esta aba. Será pedido sempre que abrir.'
            : 'Digite o PIN para ver seus saldos e gráficos.'}
        </p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
          placeholder="PIN"
          className="w-full text-center tracking-[0.4em] text-lg font-bold rounded-2xl border border-black/10 px-4 py-3 outline-none focus:border-brand-500 mb-3"
        />
        {creating && (
          <input
            type="password"
            inputMode="numeric"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 12))}
            placeholder="Repita o PIN"
            className="w-full text-center tracking-[0.4em] text-lg font-bold rounded-2xl border border-black/10 px-4 py-3 outline-none focus:border-brand-500 mb-3"
          />
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full mt-2 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 transition-colors disabled:opacity-50"
        >
          {busy ? 'Aguarde…' : creating ? 'Criar e entrar' : 'Desbloquear'}
        </button>
      </form>
    </div>
  );
}

/* --------------------------- Configuração Pluggy --------------------------- */

function CredentialsForm({ onSaved, toast }) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .financeConfig()
      .then((c) => {
        setClientId(c.client_id || '');
        setHasSecret(Boolean(c.has_secret));
      })
      .catch(() => {});
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!clientId.trim()) return toast('Informe o Client ID.', 'error');
    if (!hasSecret && !secret.trim()) return toast('Informe o Client Secret.', 'error');
    setBusy(true);
    try {
      await api.financeSaveConfig({ client_id: clientId.trim(), client_secret: secret.trim() });
      toast('Credenciais salvas!', 'success');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto animate-fade-up">
      <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-7">
        <h2 className="text-lg font-extrabold tracking-tight text-brand-950 mb-1">Conectar ao Open Finance</h2>
        <p className="text-xs font-medium text-slate-400 mb-5">
          Use o <b>Meu Pluggy</b> (gratuito para uso pessoal). Crie sua conta, gere as credenciais e cole abaixo.
        </p>
        <ol className="text-sm text-slate-600 space-y-2 mb-6 list-decimal list-inside">
          <li>
            Acesse{' '}
            <a
              href="https://meu.pluggy.ai"
              target="_blank"
              rel="noreferrer"
              className="font-bold text-brand-700 inline-flex items-center gap-1"
            >
              meu.pluggy.ai <ExternalLink size={12} />
            </a>{' '}
            e crie sua conta.
          </li>
          <li>No painel, gere o <b>Client ID</b> e o <b>Client Secret</b> da API.</li>
          <li>Cole os dois aqui embaixo e salve.</li>
        </ol>
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Client ID</label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="w-full mt-1 rounded-2xl border border-black/10 px-4 py-2.5 outline-none focus:border-brand-500 font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Client Secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={hasSecret ? '•••••••• (já salvo — deixe em branco para manter)' : 'seu client secret'}
              className="w-full mt-1 rounded-2xl border border-black/10 px-4 py-2.5 outline-none focus:border-brand-500 font-mono text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 transition-colors disabled:opacity-50"
          >
            {busy ? 'Salvando…' : 'Salvar credenciais'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------- Dashboard -------------------------------- */

// Ícones próprios dos bancos (em web/public/banks). Têm prioridade sobre a
// imagem da Pluggy, que no plano gratuito é sempre o logo do agregador.
const LOCAL_BANK_ICONS = {
  inter: '/banks/inter.jpg',
  nubank: '/banks/nubank.png',
  'mercado pago': '/banks/mercado-pago.png'
};

function localBankIcon(name) {
  const key = String(name || '')
    .trim()
    .toLowerCase();
  return LOCAL_BANK_ICONS[key] || null;
}

// Mostra, em cascata, o ícone local do banco → a imagem da Pluggy → as iniciais.
function BankLogo({ src, name, size = 'w-9 h-9' }) {
  const candidates = [localBankIcon(name), src].filter(Boolean);
  const [idx, setIdx] = useState(0);
  const url = candidates[idx];
  if (url) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setIdx((i) => i + 1)}
        className={`${size} rounded-xl object-contain bg-white border border-black/5 shrink-0`}
      />
    );
  }
  return (
    <span
      className={`${size} rounded-xl bg-brand-100 text-brand-700 text-[10px] font-extrabold flex items-center justify-center shrink-0`}
    >
      {(name || '?').slice(0, 2).toUpperCase()}
    </span>
  );
}

function ShareBar({ pct, tone = 'brand', className = '' }) {
  const c = tone === 'flame' ? 'bg-flame-500' : tone === 'sun' ? 'bg-sun-400' : 'bg-brand-500';
  return (
    <span className={`block h-1.5 rounded-full bg-black/[0.06] overflow-hidden ${className}`}>
      <span className={`block h-full ${c} rounded-full`} style={{ width: `${Math.min(100, Math.max(2, pct * 100))}%` }} />
    </span>
  );
}

// Variação do gasto contra o mês anterior. Subir gasto é ruim (vermelho).
function TrendChip({ value }) {
  if (value == null) return null;
  const up = value > 0;
  const pct = Math.abs(value) * 100;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ${
        up ? 'bg-flame-50 text-flame-700' : 'bg-brand-100 text-brand-700'
      }`}
      title="Comparado ao mês anterior"
    >
      {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {pct < 1000 ? pct.toFixed(0) : '999+'}%
    </span>
  );
}

function StatTile({ icon: Icon, label, value, sub, tone = 'brand', extra, bar }) {
  const tones = {
    brand: 'bg-brand-100 text-brand-700',
    slate: 'bg-black/[0.04] text-slate-500',
    flame: 'bg-flame-50 text-flame-700',
    sun: 'bg-sun-100 text-brand-800'
  };
  return (
    <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tones[tone]}`}>
          <Icon size={15} />
        </span>
        <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest truncate">{label}</p>
        {extra && <span className="ml-auto shrink-0">{extra}</span>}
      </div>
      <p className="text-2xl font-extrabold tracking-tight text-brand-950 leading-none">{value}</p>
      {bar}
      {sub && <p className="text-xs font-semibold text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

function ExpenseChart({ series }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...series.map((s) => s.expense), 1);
  const totalExp = series.reduce((sum, s) => sum + s.expense, 0);
  const totalInc = series.reduce((sum, s) => sum + s.income, 0);
  const active = hover ? series.find((s) => s.day === hover) : null;

  return (
    <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h3 className="font-extrabold tracking-tight text-brand-950">Gastos por dia</h3>
          <p className="text-xs font-medium text-slate-400">Últimos {series.length} dias · contas + cartões</p>
        </div>
        <div className="text-right">
          {active ? (
            <>
              <p className="text-sm font-extrabold text-brand-950 leading-none">{fmtBRL(active.expense)}</p>
              <p className="text-[11px] font-bold text-slate-400 mt-1">{dayShort(active.day)}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-extrabold text-flame-700 leading-none">−{fmtBRL(totalExp)}</p>
              <p className="text-[11px] font-bold text-brand-600 mt-1">+{fmtBRL(totalInc)} entradas</p>
            </>
          )}
        </div>
      </div>
      <div className="flex items-end gap-[3px] h-40" onMouseLeave={() => setHover(null)}>
        {series.map((s) => {
          const h = s.expense > 0 ? Math.max(6, (s.expense / max) * 100) : 3;
          return (
            <div
              key={s.day}
              onMouseEnter={() => setHover(s.day)}
              title={`${dayShort(s.day)}: ${fmtBRL(s.expense)}`}
              className="flex-1 flex flex-col justify-end h-full group cursor-default"
            >
              <div
                style={{ height: `${h}%` }}
                className={`w-full rounded-t transition-all ${
                  s.expense === 0
                    ? 'bg-black/[0.06]'
                    : hover === s.day
                      ? 'bg-flame-600'
                      : 'bg-flame-500/80 group-hover:bg-flame-600'
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-2">
        <span>{series.length ? dayShort(series[0].day) : ''}</span>
        <span>Hoje</span>
      </div>
    </div>
  );
}

function accountIcon(type) {
  return type === 'CREDIT' ? CreditCard : Landmark;
}

function Dashboard({ status, onLock, onReload, toast }) {
  const [data, setData] = useState(null);
  const [connectToken, setConnectToken] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bank, setBank] = useState('all');
  const [invView, setInvView] = useState('class');

  const handleErr = useCallback(
    (err) => {
      if (err instanceof FinanceLockError) {
        setFinanceToken('');
        onLock();
        return true;
      }
      toast(err.message, 'error');
      return false;
    },
    [onLock, toast]
  );

  const load = useCallback(
    async ({ silent } = {}) => {
      try {
        setData(await api.financeSummary());
      } catch (err) {
        if (!silent) handleErr(err);
      }
    },
    [handleErr]
  );

  useEffect(() => {
    if (status.has_credentials && status.item_count > 0) load();
  }, [status.has_credentials, status.item_count, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openConnect = async (itemId) => {
    try {
      const { token } = await api.financeConnectToken(itemId);
      setConnectToken(token);
    } catch (err) {
      handleErr(err);
    }
  };

  const onWidgetSuccess = async ({ item }) => {
    setConnectToken(null);
    try {
      await api.financeAddItem(item.id);
      toast('Banco conectado! Sincronizando…', 'success');
      await onReload();
      await load();
    } catch (err) {
      handleErr(err);
    }
  };

  const removeItem = async (itemId) => {
    if (!confirm('Remover esta conexão? Os dados dela somem do painel.')) return;
    try {
      await api.financeRemoveItem(itemId);
      setBank('all');
      await onReload();
      await load();
    } catch (err) {
      handleErr(err);
    }
  };

  const renameItem = async (c) => {
    const label = prompt('Nome do banco desta conexão:', c.label || c.name);
    if (label === null) return;
    try {
      await api.financeRenameItem(c.item_id, label.trim());
      await load();
    } catch (err) {
      handleErr(err);
    }
  };

  // Widget de conexão renderizado num portal no body: escapa de ancestrais com
  // `transform` (animate-fade-up) e `overflow`, que senão prendem o modal fixed
  // e deixam só o fundo escuro aparecendo.
  const connectModal =
    connectToken &&
    createPortal(
      <PluggyConnect
        connectToken={connectToken}
        onSuccess={onWidgetSuccess}
        onClose={() => setConnectToken(null)}
        onError={(err) => {
          setConnectToken(null);
          toast(err?.message || 'Não foi possível conectar.', 'error');
        }}
      />,
      document.body
    );

  // Sem credenciais ainda
  if (!status.has_credentials) {
    return (
      <div className="p-4 sm:p-6 h-full overflow-y-auto">
        <LockHeader onLock={onLock} />
        <CredentialsForm onSaved={onReload} toast={toast} />
      </div>
    );
  }

  // Sem bancos conectados
  if (status.item_count === 0 || (data && !data.connectors?.length)) {
    return (
      <div className="p-4 sm:p-6 h-full overflow-y-auto">
        <LockHeader onLock={onLock} />
        <div className="max-w-lg mx-auto text-center bg-white rounded-3xl border border-black/5 shadow-sm p-10 animate-fade-up">
          <span className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center mx-auto mb-4">
            <Landmark size={26} />
          </span>
          <h2 className="text-lg font-extrabold tracking-tight text-brand-950">Conecte seu primeiro banco</h2>
          <p className="text-sm font-medium text-slate-400 mt-1 mb-6">
            Abra o Open Finance, escolha seu banco e autorize. Depois puxamos saldos, cartões e gastos aqui.
          </p>
          <button
            onClick={() => openConnect(null)}
            className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 transition-colors"
          >
            <Plus size={18} /> Conectar banco
          </button>
        </div>
        {connectModal}
      </div>
    );
  }

  if (!data) return <p className="p-6 text-sm font-medium text-slate-400">Carregando finanças…</p>;

  // Recorte ativo: consolidado ou de uma instituição. Todo o painel abaixo lê daqui.
  const view = (bank !== 'all' && data.by_connector?.[bank]) || data.total;
  const scope = bank === 'all' ? null : data.connectors.find((c) => c.item_id === bank);
  const invRows = invView === 'class' ? view.investments : view.investments_by_institution;
  const assetTotal = Math.max(view.bank_total + view.invest_total, 1);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      {/* Cabeçalho + ações */}
      <div className="flex items-center gap-2 flex-wrap">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Minhas finanças</h2>
          <p className="text-xs font-medium text-slate-400">
            {scope ? `Filtrando por ${scope.name}` : 'Consolidado via Open Finance (Pluggy)'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] hover:bg-black/[0.07] text-slate-600 font-bold text-xs px-3 py-2 transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button
            onClick={() => openConnect(null)}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs px-3 py-2 transition-colors"
          >
            <Plus size={14} /> Banco
          </button>
          <button
            onClick={onLock}
            title="Bloquear"
            className="p-2 rounded-full text-slate-400 hover:text-brand-800 hover:bg-black/[0.04] transition-colors"
          >
            <LockKeyhole size={16} />
          </button>
        </div>
      </div>

      {/* Filtro por instituição — recalcula o painel inteiro */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setBank('all')}
          className={`shrink-0 inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 transition-colors ${
            bank === 'all'
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'bg-white border-black/5 text-slate-600 hover:border-brand-300'
          }`}
        >
          <Wallet size={16} className="shrink-0" />
          <span className="text-left leading-tight">
            <span className="block text-xs font-extrabold">Todos</span>
            <span className={`block text-[10px] font-bold ${bank === 'all' ? 'text-white/70' : 'text-slate-400'}`}>
              {fmtBRL(data.total.net_worth)}
            </span>
          </span>
        </button>
        {data.connectors.map((c) => {
          const on = bank === c.item_id;
          return (
            <button
              key={c.item_id}
              onClick={() => setBank(on ? 'all' : c.item_id)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 transition-colors ${
                on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-black/5 text-slate-600 hover:border-brand-300'
              }`}
            >
              <BankLogo src={c.image} name={c.name} size="w-6 h-6" />
              <span className="text-left leading-tight">
                <span className="block text-xs font-extrabold whitespace-nowrap">{c.name}</span>
                <span className={`block text-[10px] font-bold ${on ? 'text-white/70' : 'text-slate-400'}`}>
                  {fmtBRL(c.net_worth)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Placar principal */}
      <section className="bg-white rounded-3xl border border-black/5 shadow-sm p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">
              Patrimônio líquido{scope ? ` · ${scope.name}` : ''}
            </p>
            <p className="text-4xl font-extrabold tracking-tight text-brand-950 leading-none">{fmtBRL(view.net_worth)}</p>
            <p className="text-xs font-semibold text-slate-400 mt-2">
              {fmtBRL(view.bank_total)} em conta
              {view.invest_total > 0 && <> · {fmtBRL(view.invest_total)} investido</>}
              {view.credit_owed !== 0 && <> · −{fmtBRL(view.credit_owed)} em cartões</>}
            </p>
          </div>
          {view.invest_total > 0 && (
            <div className="w-full sm:w-56">
              <div className="flex h-2 rounded-full overflow-hidden bg-black/[0.06]">
                <span className="bg-brand-500 h-full" style={{ width: `${(view.bank_total / assetTotal) * 100}%` }} />
                <span className="bg-sun-400 h-full" style={{ width: `${(view.invest_total / assetTotal) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-1.5">
                <span className="text-brand-700">Conta {Math.round((view.bank_total / assetTotal) * 100)}%</span>
                <span className="text-brand-800">Investido {Math.round((view.invest_total / assetTotal) * 100)}%</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon={Landmark} label="Em conta" value={fmtBRL(view.bank_total)} sub="saldo disponível" />
        <StatTile
          icon={PiggyBank}
          label="Investido"
          value={fmtBRL(view.invest_total)}
          sub={view.invest_total > 0 ? `${view.investments.length} classe(s)` : 'sem investimentos'}
          tone="sun"
        />
        <StatTile
          icon={CreditCard}
          label="Fatura aberta"
          value={fmtBRL(view.credit_owed)}
          sub={view.credit_limit > 0 ? `${Math.round(view.credit_usage * 100)}% do limite usado` : 'sem cartões'}
          tone="flame"
          bar={view.credit_limit > 0 && <ShareBar pct={view.credit_usage} tone="flame" className="mt-2.5" />}
        />
        <StatTile
          icon={TrendingDown}
          label="Gasto do mês"
          value={fmtBRL(view.month_expense)}
          sub={`cartão ${fmtBRL(view.card_month)} · conta ${fmtBRL(view.bank_out_month)}`}
          tone="slate"
          extra={<TrendChip value={view.expense_trend} />}
        />
      </div>

      <ExpenseChart series={view.series || []} />

      {/* Composição: contas, cartões e ativos */}
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
              <Landmark size={15} />
            </span>
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">Contas bancárias</p>
          </div>
          <p className="text-2xl font-extrabold tracking-tight text-brand-700 leading-none mb-5">
            {fmtBRL(view.bank_total)}
          </p>
          <div className="space-y-4">
            {bank === 'all'
              ? (view.banks || []).map((b) => (
                  <button
                    key={b.name}
                    onClick={() => setBank(b.item_id)}
                    className="w-full text-left rounded-2xl hover:bg-black/[0.02] p-2 -m-2 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-1.5">
                      <BankLogo src={b.image} name={b.name} />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-brand-950 text-sm truncate">{b.name}</p>
                        <p className="text-[11px] font-medium text-slate-400">
                          {b.count} conta{b.count !== 1 ? 's' : ''} · {(b.share * 100).toFixed(1)}%
                        </p>
                      </div>
                      <span className="font-extrabold text-brand-700 text-sm">{fmtBRL(b.total)}</span>
                    </div>
                    <ShareBar pct={b.share} />
                  </button>
                ))
              : (view.accounts || [])
                  .filter((a) => a.type !== 'CREDIT')
                  .map((a) => (
                    <div key={a.id}>
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className="w-9 h-9 rounded-xl bg-black/[0.04] text-slate-500 flex items-center justify-center shrink-0">
                          <Landmark size={15} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-brand-950 text-sm truncate">{a.name}</p>
                          {a.number && <p className="text-[11px] font-medium text-slate-400">{a.number}</p>}
                        </div>
                        <span className="font-extrabold text-brand-700 text-sm">{fmtBRL(a.balance)}</span>
                      </div>
                      <ShareBar pct={view.bank_total > 0 ? a.balance / view.bank_total : 0} />
                    </div>
                  ))}
            {(bank === 'all' ? view.banks : view.accounts.filter((a) => a.type !== 'CREDIT')).length === 0 && (
              <p className="text-sm font-medium text-slate-400 text-center py-4">Nenhuma conta.</p>
            )}
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-flame-50 text-flame-700 flex items-center justify-center">
              <CreditCard size={15} />
            </span>
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">Cartões de crédito</p>
          </div>
          <p className="text-2xl font-extrabold tracking-tight text-flame-700 leading-none mb-3">
            {fmtBRL(view.credit_owed)}
          </p>
          {view.credit_limit > 0 && (
            <>
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-1.5">
                <span>{Math.round(view.credit_usage * 100)}% utilizado</span>
                <span>Limite: {fmtBRL(view.credit_limit)}</span>
              </div>
              <ShareBar pct={view.credit_usage} tone="flame" />
            </>
          )}
          <div className="space-y-3 mt-5">
            {(view.cards || []).map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <BankLogo src={c.image} name={c.connector} size="w-8 h-8" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-950 text-sm truncate">{c.name}</p>
                  <p className="text-[11px] font-medium text-slate-400 truncate">
                    {c.number || c.connector}
                    {c.due_date && ` · vence ${dateBR(c.due_date)}`}
                  </p>
                </div>
                <span className="font-extrabold text-flame-700 text-sm shrink-0">{fmtBRL(c.balance)}</span>
              </div>
            ))}
            {(view.cards || []).length === 0 && (
              <p className="text-sm font-medium text-slate-400 text-center py-4">Nenhum cartão.</p>
            )}
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
              <TrendingUp size={15} />
            </span>
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">Investimentos</p>
            <div className="ml-auto flex rounded-full bg-black/[0.04] p-0.5 text-[10px] font-extrabold">
              <button
                onClick={() => setInvView('class')}
                className={`px-2 py-1 rounded-full transition-colors ${
                  invView === 'class' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-400'
                }`}
              >
                Classes
              </button>
              <button
                onClick={() => setInvView('inst')}
                className={`px-2 py-1 rounded-full transition-colors ${
                  invView === 'inst' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-400'
                }`}
              >
                Bancos
              </button>
            </div>
          </div>
          <p className="text-2xl font-extrabold tracking-tight text-brand-700 leading-none mb-5">
            {fmtBRL(view.invest_total)}
          </p>
          <div className="space-y-4">
            {(invRows || []).map((iv) => (
              <div key={iv.name}>
                <div className="flex items-center gap-2 mb-1.5">
                  {invView === 'inst' && <BankLogo src={iv.image} name={iv.name} size="w-6 h-6" />}
                  <span className="flex-1 min-w-0 font-bold text-brand-950 text-sm truncate">
                    {iv.name} <span className="text-slate-400 font-medium">({iv.count})</span>
                  </span>
                  <span className="text-[11px] font-bold text-slate-400 shrink-0">{(iv.share * 100).toFixed(1)}%</span>
                  <span className="font-extrabold text-brand-700 text-sm shrink-0">{fmtBRL(iv.total)}</span>
                </div>
                <ShareBar pct={iv.share} tone="sun" />
              </div>
            ))}
            {(invRows || []).length === 0 && (
              <p className="text-sm font-medium text-slate-400 text-center py-4">Sem investimentos.</p>
            )}
          </div>
        </section>
      </div>

      {/* Categorias e faturas */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Gastos por categoria (mês)</h3>
            <span className="text-[11px] font-bold text-slate-400">{fmtBRL(view.month_expense)}</span>
          </div>
          {(view.categories || []).length === 0 ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Sem gastos no mês ainda.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {view.categories.map((c) => (
                <div key={c.name} className="px-6 py-3 flex items-center gap-3 text-sm">
                  <span className="flex-1 min-w-0 truncate font-bold text-brand-950 capitalize">{c.name}</span>
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">{(c.share * 100).toFixed(0)}%</span>
                  <span className="w-20 shrink-0">
                    <ShareBar pct={c.share} tone="flame" />
                  </span>
                  <span className="font-extrabold text-brand-700 text-xs w-20 text-right shrink-0">{fmtBRL(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Contas a pagar (cartões)</h3>
          </div>
          {(view.upcoming || []).length === 0 ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Nenhuma fatura em aberto.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {view.upcoming.map((u, i) => (
                <div key={i} className="px-6 py-3 flex items-center gap-3 text-sm">
                  <CalendarClock size={15} className="text-flame-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-brand-950 truncate">{u.connector}</p>
                    <p className="text-[11px] font-medium text-slate-400 truncate">{u.name}</p>
                  </div>
                  {u.due_date && (
                    <span className="text-[11px] font-bold text-slate-400 shrink-0">vence {dateBR(u.due_date)}</span>
                  )}
                  <span className="font-extrabold text-flame-700 text-xs w-20 text-right shrink-0">{fmtBRL(u.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Contas e cartões (lista completa do recorte) */}
      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Contas e cartões</h3>
          <span className="text-[11px] font-bold text-slate-400">{(view.accounts || []).length} no total</span>
        </div>
        <div className="divide-y divide-black/5">
          {(view.accounts || []).map((a) => {
            const Icon = accountIcon(a.type);
            return (
              <div key={a.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                <BankLogo src={a.connector_image} name={a.connector} size="w-8 h-8" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-950 truncate">{a.name}</p>
                  <p className="text-[11px] font-medium text-slate-400 truncate flex items-center gap-1">
                    <Icon size={11} /> {a.connector}
                    {a.number ? ` · ${a.number}` : ''}
                  </p>
                </div>
                <span className={`font-extrabold text-sm ${a.type === 'CREDIT' ? 'text-flame-700' : 'text-brand-700'}`}>
                  {fmtBRL(a.balance)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Lançamentos */}
      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Últimos lançamentos</h3>
          {scope && <span className="text-[11px] font-bold text-brand-600">{scope.name}</span>}
        </div>
        {(view.recent || []).length === 0 ? (
          <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Sem lançamentos no período.</p>
        ) : (
          <div className="divide-y divide-black/5">
            {view.recent.map((t) => (
              <div key={t.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                {t.direction === 'in' ? (
                  <ArrowDownRight size={15} className="text-brand-600 shrink-0" />
                ) : (
                  <ArrowUpRight size={15} className="text-flame-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-950 truncate">{t.description}</p>
                  <p className="text-[11px] font-medium text-slate-400 truncate">
                    {t.connector} · {t.account}
                    {t.category ? ` · ${t.category}` : ''}
                  </p>
                </div>
                <span className="text-[11px] font-medium text-slate-400 shrink-0">{dateBR(t.date)}</span>
                <span
                  className={`font-extrabold text-xs w-20 text-right shrink-0 ${
                    t.direction === 'in' ? 'text-brand-700' : 'text-flame-700'
                  }`}
                >
                  {t.direction === 'in' ? '+' : '−'}
                  {fmtBRL(t.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Conexões */}
      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Conexões</h3>
        </div>
        <div className="divide-y divide-black/5">
          {data.connectors.map((c) => (
            <div key={c.item_id} className="px-6 py-3 flex items-center gap-3 text-sm">
              <BankLogo src={c.image} name={c.name} size="w-8 h-8" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-brand-950 truncate">{c.name}</p>
                <p className="text-[11px] font-medium text-slate-400 truncate">
                  {c.account_count} conta{c.account_count !== 1 ? 's' : ''}
                  {c.last_update ? ` · atualizado ${dateBR(c.last_update)}` : ''}
                </p>
              </div>
              {c.generic && (
                <span
                  title="Nome não identificado pela Pluggy — clique no lápis para corrigir"
                  className="text-[10px] font-extrabold text-brand-800 bg-sun-100 px-2 py-0.5 rounded-full shrink-0"
                >
                  renomear
                </span>
              )}
              {c.error && (
                <span className="text-[10px] font-extrabold text-flame-700 bg-flame-50 px-2 py-0.5 rounded-full shrink-0">
                  erro
                </span>
              )}
              <button
                onClick={() => renameItem(c)}
                title="Renomear banco"
                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-black/[0.04]"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => openConnect(c.item_id)}
                title="Reconectar / atualizar"
                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-black/[0.04]"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => removeItem(c.item_id)}
                title="Remover"
                className="p-1.5 rounded-lg text-slate-400 hover:text-flame-600 hover:bg-flame-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <p className="text-center text-[11px] font-medium text-slate-400 pt-1">
        Dados atualizados em {new Date(data.generated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
      </p>

      {connectModal}
    </div>
  );
}

function LockHeader({ onLock }) {
  return (
    <div className="max-w-lg mx-auto flex justify-end mb-3">
      <button
        onClick={onLock}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-brand-800 transition-colors"
      >
        <LockKeyhole size={14} /> Bloquear
      </button>
    </div>
  );
}


/* --------------------------------- Raiz ---------------------------------- */

export default function Finance({ onAuthError }) {
  const [status, setStatus] = useState(null);
  const [unlocked, setUnlocked] = useState(() => Boolean(getFinanceToken()));
  const toast = useToast();

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.financeStatus();
      setStatus(s);
      return s;
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
      return null;
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const lock = useCallback(() => {
    setFinanceToken('');
    setUnlocked(false);
  }, []);

  if (!status) return <p className="p-6 text-sm font-medium text-slate-400">Carregando…</p>;

  // Primeira vez: criar o PIN.
  if (!status.has_pin) {
    return (
      <PinScreen
        mode="create"
        toast={toast}
        onDone={async () => {
          setUnlocked(true);
          await loadStatus();
        }}
      />
    );
  }

  // Tem PIN, mas a aba está bloqueada nesta sessão.
  if (!unlocked) {
    return (
      <PinScreen
        mode="unlock"
        toast={toast}
        onDone={async () => {
          setUnlocked(true);
          await loadStatus();
        }}
      />
    );
  }

  return <Dashboard status={status} onLock={lock} onReload={loadStatus} toast={toast} />;
}
