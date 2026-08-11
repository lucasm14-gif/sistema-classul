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

function StatTile({ icon: Icon, label, value, sub, tone = 'brand' }) {
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
        <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-2xl font-extrabold tracking-tight text-brand-950 leading-none">{value}</p>
      {sub && <p className="text-xs font-semibold text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

function ExpenseChart({ series }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...series.map((s) => s.expense), 1);
  return (
    <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
      <h3 className="font-extrabold tracking-tight text-brand-950 mb-1">Gastos por dia</h3>
      <p className="text-xs font-medium text-slate-400 mb-5">Contas + cartões</p>
      <div className="flex items-end gap-[3px] h-40">
        {series.map((s) => {
          const h = s.expense > 0 ? Math.max(6, (s.expense / max) * 100) : 3;
          const show = hover === s.day || (s.expense === max && s.expense > 0);
          return (
            <div
              key={s.day}
              onMouseEnter={() => setHover(s.day)}
              onMouseLeave={() => setHover(null)}
              title={`${dayShort(s.day)}: ${fmtBRL(s.expense)}`}
              className="flex-1 flex flex-col items-center justify-end gap-1 h-full group cursor-default"
            >
              {show && <span className="text-[9px] font-extrabold text-brand-950 whitespace-nowrap">{fmtBRL(s.expense)}</span>}
              <div
                style={{ height: `${h}%` }}
                className={`w-full rounded-t transition-all ${
                  s.expense === 0 ? 'bg-black/[0.06]' : 'bg-flame-500/80 group-hover:bg-flame-600'
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

function BankLogo({ src, name, size = 'w-9 h-9' }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className={`${size} rounded-xl object-contain bg-white border border-black/5 shrink-0`}
      />
    );
  }
  return (
    <span className={`${size} rounded-xl bg-brand-100 text-brand-700 text-[11px] font-extrabold flex items-center justify-center shrink-0`}>
      {(name || '?').slice(0, 2).toUpperCase()}
    </span>
  );
}

function ShareBar({ pct, tone = 'brand' }) {
  const c = tone === 'flame' ? 'bg-flame-500' : tone === 'sun' ? 'bg-sun-400' : 'bg-brand-500';
  return (
    <span className="block h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
      <span className={`block h-full ${c} rounded-full`} style={{ width: `${Math.min(100, Math.max(2, pct * 100))}%` }} />
    </span>
  );
}

function Dashboard({ status, onLock, onReload, toast }) {
  const [data, setData] = useState(null);
  const [connectToken, setConnectToken] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bank, setBank] = useState('all');

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
      await onReload();
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
  if (status.item_count === 0 || data?.empty) {
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

  const maxCat = Math.max(...(data.categories || []).map((c) => c.total), 1);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      <div className="flex items-center gap-2 flex-wrap">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Minhas finanças</h2>
          <p className="text-xs font-medium text-slate-400">Consolidado via Open Finance (Pluggy).</p>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon={Wallet} label="Patrimônio" value={fmtBRL(data.net_worth)} sub="contas + investimentos − cartões" />
        <StatTile icon={Landmark} label="Em conta" value={fmtBRL(data.bank_total)} sub="saldo somado" tone="slate" />
        <StatTile
          icon={CreditCard}
          label="Fatura aberta"
          value={fmtBRL(data.credit_owed)}
          sub={`limite livre ${fmtBRL(data.credit_available)}`}
          tone="flame"
        />
        <StatTile
          icon={TrendingDown}
          label="Gasto do mês"
          value={fmtBRL(data.month_expense)}
          sub={`cartão ${fmtBRL(data.card_month)} · conta ${fmtBRL(data.bank_out_month)}`}
          tone="sun"
        />
      </div>

      {data.invest_total > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile icon={PiggyBank} label="Investimentos" value={fmtBRL(data.invest_total)} sub="valor atual" />
          <StatTile icon={ArrowUpRight} label="Entradas (mês)" value={fmtBRL(data.month_income)} sub="recebido em conta" tone="brand" />
        </div>
      )}

      <ExpenseChart series={data.series || []} />

      {/* Composição por banco / cartão / classe */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Contas bancárias */}
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
              <Landmark size={15} />
            </span>
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">Contas bancárias</p>
          </div>
          <p className="text-2xl font-extrabold tracking-tight text-brand-700 leading-none mb-5">{fmtBRL(data.bank_total)}</p>
          <div className="space-y-4">
            {(data.banks || []).map((b) => (
              <button
                key={b.name}
                onClick={() => setBank(bank === b.name ? 'all' : b.name)}
                className={`w-full text-left rounded-2xl transition-colors ${bank === b.name ? 'bg-brand-50' : 'hover:bg-black/[0.02]'} p-2 -m-2`}
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
            ))}
            {(data.banks || []).length === 0 && (
              <p className="text-sm font-medium text-slate-400 text-center py-4">Nenhuma conta.</p>
            )}
          </div>
        </section>

        {/* Cartões de crédito */}
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-flame-50 text-flame-700 flex items-center justify-center">
              <CreditCard size={15} />
            </span>
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">Cartões de crédito</p>
          </div>
          <p className="text-2xl font-extrabold tracking-tight text-flame-700 leading-none mb-3">{fmtBRL(data.credit_owed)}</p>
          {data.credit_limit > 0 && (
            <>
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-1.5">
                <span>{Math.round((Math.max(0, data.credit_owed) / data.credit_limit) * 100)}% utilizado</span>
                <span>Limite: {fmtBRL(data.credit_limit)}</span>
              </div>
              <ShareBar pct={Math.max(0, data.credit_owed) / data.credit_limit} tone="flame" />
            </>
          )}
          <div className="space-y-3 mt-5">
            {(data.cards || []).map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-black/[0.04] text-slate-500 flex items-center justify-center shrink-0">
                  <CreditCard size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-950 text-sm truncate">{c.name}</p>
                  {c.number && <p className="text-[11px] font-medium text-slate-400">{c.number}</p>}
                </div>
                <span className="font-extrabold text-flame-700 text-sm">{fmtBRL(c.balance)}</span>
              </div>
            ))}
            {(data.cards || []).length === 0 && (
              <p className="text-sm font-medium text-slate-400 text-center py-4">Nenhum cartão.</p>
            )}
          </div>
        </section>

        {/* Investimentos */}
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
              <TrendingUp size={15} />
            </span>
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">Investimentos</p>
          </div>
          <p className="text-2xl font-extrabold tracking-tight text-brand-700 leading-none mb-5">{fmtBRL(data.invest_total)}</p>
          <div className="space-y-4">
            {(data.investments || []).map((iv) => (
              <div key={iv.name}>
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="flex-1 min-w-0 font-bold text-brand-950 text-sm truncate">
                    {iv.name} <span className="text-slate-400 font-medium">({iv.count})</span>
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">{(iv.share * 100).toFixed(1)}%</span>
                  <span className="font-extrabold text-brand-700 text-sm">{fmtBRL(iv.total)}</span>
                </div>
                <ShareBar pct={iv.share} />
              </div>
            ))}
            {(data.investments || []).length === 0 && (
              <p className="text-sm font-medium text-slate-400 text-center py-4">Sem investimentos.</p>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Gastos por categoria (mês)</h3>
          </div>
          {(data.categories || []).length === 0 ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Sem gastos no mês ainda.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {data.categories.map((c) => (
                <div key={c.name} className="px-6 py-3 flex items-center gap-3 text-sm">
                  <span className="flex-1 min-w-0 truncate font-bold text-brand-950 capitalize">{c.name}</span>
                  <span className="w-24 h-2 rounded-full bg-brand-100 overflow-hidden shrink-0">
                    <span className="block h-full bg-flame-500" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                  </span>
                  <span className="font-extrabold text-brand-700 text-xs w-20 text-right">{fmtBRL(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Contas a pagar (cartões)</h3>
          </div>
          {(data.upcoming || []).length === 0 ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Nenhuma fatura em aberto.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {data.upcoming.map((u, i) => (
                <div key={i} className="px-6 py-3 flex items-center gap-3 text-sm">
                  <CalendarClock size={15} className="text-flame-600 shrink-0" />
                  <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{u.connector}</span>
                  {u.due_date && (
                    <span className="text-[11px] font-bold text-slate-400 shrink-0">vence {dateBR(u.due_date)}</span>
                  )}
                  <span className="font-extrabold text-flame-700 text-xs w-20 text-right">{fmtBRL(u.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Filtro por banco */}
      {(data.connectors || []).length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setBank('all')}
            className={`inline-flex items-center gap-1.5 rounded-full text-xs font-bold px-3 py-2 transition-colors ${
              bank === 'all' ? 'bg-brand-600 text-white' : 'bg-black/[0.04] text-slate-600 hover:bg-black/[0.07]'
            }`}
          >
            Todos
          </button>
          {data.connectors.map((c) => (
            <button
              key={c.item_id}
              onClick={() => setBank(bank === c.name ? 'all' : c.name)}
              className={`inline-flex items-center gap-1.5 rounded-full text-xs font-bold px-3 py-2 transition-colors ${
                bank === c.name ? 'bg-brand-600 text-white' : 'bg-black/[0.04] text-slate-600 hover:bg-black/[0.07]'
              }`}
            >
              <BankLogo src={c.image} name={c.name} size="w-4 h-4" />
              {c.name}
            </button>
          ))}
        </div>
      )}

      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Contas e cartões</h3>
          {bank !== 'all' && <span className="text-[11px] font-bold text-brand-600">{bank}</span>}
        </div>
        <div className="divide-y divide-black/5">
          {(data.accounts || [])
            .filter((a) => bank === 'all' || a.connector === bank)
            .map((a) => {
            const Icon = accountIcon(a.type);
            return (
              <div key={a.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                <span className="w-8 h-8 rounded-xl bg-black/[0.04] text-slate-500 flex items-center justify-center shrink-0">
                  <Icon size={15} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-950 truncate">{a.name}</p>
                  <p className="text-[11px] font-medium text-slate-400 truncate">
                    {a.connector}
                    {a.type === 'CREDIT' ? ' · cartão' : ''}
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

      <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
          <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Últimos lançamentos</h3>
          {bank !== 'all' && <span className="text-[11px] font-bold text-brand-600">{bank}</span>}
        </div>
        {(data.recent || []).filter((t) => bank === 'all' || t.connector === bank).length === 0 ? (
          <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Sem lançamentos no período.</p>
        ) : (
          <div className="divide-y divide-black/5">
            {data.recent
              .filter((t) => bank === 'all' || t.connector === bank)
              .map((t) => (
              <div key={t.id} className="px-6 py-3 flex items-center gap-3 text-sm">
                {t.direction === 'in' ? (
                  <ArrowDownRight size={15} className="text-brand-600 shrink-0" />
                ) : (
                  <ArrowUpRight size={15} className="text-flame-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-950 truncate">{t.description}</p>
                  <p className="text-[11px] font-medium text-slate-400 truncate">
                    {t.account}
                    {t.category ? ` · ${t.category}` : ''}
                  </p>
                </div>
                <span className="text-[11px] font-medium text-slate-400 shrink-0">{dateBR(t.date)}</span>
                <span className={`font-extrabold text-xs w-20 text-right ${t.direction === 'in' ? 'text-brand-700' : 'text-flame-700'}`}>
                  {t.direction === 'in' ? '+' : '−'}
                  {fmtBRL(t.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {(data.connectors || []).length > 0 && (
        <section className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-black/5">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Conexões</h3>
          </div>
          <div className="divide-y divide-black/5">
            {data.connectors.map((c) => (
              <div key={c.item_id} className="px-6 py-3 flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{c.name}</span>
                {c.last_update && (
                  <span className="text-[11px] font-medium text-slate-400 shrink-0">
                    atualizado {dateBR(c.last_update)}
                  </span>
                )}
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
      )}

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
