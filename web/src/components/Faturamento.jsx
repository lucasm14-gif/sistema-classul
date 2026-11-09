import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleDollarSign, FileText, TrendingUp, TrendingDown, Ban, Package, Ruler, Users, MapPin, Wallet, Layers, Boxes,
  LoaderCircle, Search
} from 'lucide-react';
import { faturamentoApi } from '../api';
import { useToast } from './Toast';

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const brl0 = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const numero = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function rotulo(p, longo = false) {
  if (/^\d{4}$/.test(p)) return `Ano de ${p}`;
  const [y, m] = p.split('-');
  const nome = MESES[Number(m) - 1];
  return longo ? `${nome.charAt(0).toUpperCase()}${nome.slice(1)}/${y}` : `${nome}/${y.slice(2)}`;
}
const fmtDoc = (d) => {
  const s = String(d || '');
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return s;
};
const dataBR = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const mesAtual = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);

const card = 'bg-white rounded-3xl border border-black/5 shadow-sm';

function Tile({ icon: Icon, label, value, sub, tone = 'brand' }) {
  const tones = { brand: 'bg-brand-100 text-brand-700', slate: 'bg-black/[0.04] text-slate-500', amber: 'bg-sun-100 text-yellow-700' };
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tones[tone]}`}>
          <Icon size={15} />
        </span>
        <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-2xl font-extrabold tracking-tight text-brand-950 leading-none">{value}</p>
      {sub && <div className="text-xs font-semibold text-slate-400 mt-1.5">{sub}</div>}
    </div>
  );
}

// Variação em relação a outro período (texto + ícone, nunca só cor).
function Variacao({ atual, base, rotuloBase }) {
  if (!base) return <span>sem {rotuloBase} para comparar</span>;
  const pct = ((atual - base) / base) * 100;
  const sobe = pct >= 0;
  const Icon = sobe ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${sobe ? 'text-brand-700' : 'text-flame-600'}`}>
      <Icon size={12} /> {sobe ? '+' : ''}
      {pct.toFixed(0)}% vs {rotuloBase} ({brl0(base)})
    </span>
  );
}

// Barras por mês: uma série, verde da marca; o mês escolhido em tom forte.
function GraficoMeses({ meses, selecionado, onSelect }) {
  const [hover, setHover] = useState(null);
  const ultimos = meses.slice(-12);
  const max = Math.max(...ultimos.map((m) => m.total), 1);
  const ativo = hover || (ultimos.some((m) => m.mes === selecionado) ? selecionado : null);
  const info = ultimos.find((m) => m.mes === ativo);
  return (
    <section className={`${card} p-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
        <div>
          <h3 className="font-extrabold tracking-tight text-brand-950">Faturamento por mês</h3>
          <p className="text-xs font-medium text-slate-400">Notas autorizadas nos últimos 12 meses · clique num mês para ver o detalhe</p>
        </div>
        {info && (
          <p className="text-xs font-bold text-slate-500">
            {rotulo(info.mes, true)}: <span className="text-brand-950">{brl(info.total)}</span> · {info.qtd} nota{info.qtd !== 1 ? 's' : ''}
          </p>
        )}
      </div>
      <div className="flex items-end gap-1.5 sm:gap-2.5 h-44">
        {ultimos.map((m) => {
          const h = m.total > 0 ? Math.max(4, (m.total / max) * 100) : 2;
          const sel = m.mes === selecionado;
          return (
            <button
              key={m.mes}
              onClick={() => onSelect(m.mes)}
              onMouseEnter={() => setHover(m.mes)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(m.mes)}
              onBlur={() => setHover(null)}
              aria-label={`${rotulo(m.mes, true)}: ${brl(m.total)}, ${m.qtd} notas`}
              className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full group"
            >
              <div
                style={{ height: `${h}%` }}
                className={`w-full max-w-[40px] rounded-t transition-colors ${sel ? 'bg-brand-600' : 'bg-brand-300 group-hover:bg-brand-400'}`}
              />
              <span className={`text-[10px] font-bold ${sel ? 'text-brand-800' : 'text-slate-400'}`}>{rotulo(m.mes)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Lista com barra proporcional (magnitude numa cor só).
function Ranking({ icon: Icon, titulo, dica, linhas, unidade = 'un.', vazio, mostrarUnidades = true, limite = 10 }) {
  const [todos, setTodos] = useState(false);
  const max = Math.max(...linhas.map((r) => r.total), 1);
  const total = linhas.reduce((s, r) => s + r.total, 0) || 1;
  const visiveis = todos ? linhas : linhas.slice(0, limite);
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="px-6 py-4 border-b border-black/5">
        <h3 className="font-extrabold tracking-tight text-brand-950 text-sm flex items-center gap-2">
          <Icon size={15} className="text-brand-600" /> {titulo}
        </h3>
        {dica && <p className="text-[11px] font-medium text-slate-400 mt-0.5">{dica}</p>}
      </div>
      {!linhas.length ? (
        <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">{vazio}</p>
      ) : (
        <div className="divide-y divide-black/5">
          {visiveis.map((r) => (
            <div key={r.chave} className="px-6 py-2.5 flex items-center gap-3 text-sm" title={`${r.chave}: ${brl(r.total)}`}>
              <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{r.chave}</span>
              {mostrarUnidades && r.unidades !== undefined && (
                <span className="text-[11px] font-bold text-slate-400 shrink-0 w-16 text-right">
                  {numero(r.unidades)} {unidade}
                </span>
              )}
              <span className="w-16 sm:w-20 h-2 rounded-full bg-brand-100 overflow-hidden shrink-0">
                <span className="block h-full bg-brand-500 rounded-full" style={{ width: `${(r.total / max) * 100}%` }} />
              </span>
              <span className="text-[11px] font-bold text-slate-400 w-9 text-right shrink-0">{Math.round((r.total / total) * 100)}%</span>
              <span className="font-extrabold text-brand-700 text-xs w-24 text-right shrink-0">{brl(r.total)}</span>
            </div>
          ))}
          {linhas.length > limite && (
            <button onClick={() => setTodos((v) => !v)} className="w-full px-6 py-2.5 text-xs font-bold text-brand-700 hover:bg-brand-50/50 text-left">
              {todos ? 'Mostrar menos' : `Ver todos (${linhas.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default function Faturamento({ onAuthError }) {
  const toast = useToast();
  const [periodo, setPeriodo] = useState(mesAtual());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(
    async (p) => {
      setCarregando(true);
      try {
        let r = await faturamentoApi.painel(p);
        setDados(r);
        // Primeira vez: os itens das notas antigas vão sendo lidos em partes.
        while (r.pendentes > 0) {
          r = await faturamentoApi.painel(p);
          setDados(r);
        }
      } catch (err) {
        if (!onAuthError(err)) toast(err.message, 'error');
      } finally {
        setCarregando(false);
      }
    },
    [onAuthError, toast]
  );

  useEffect(() => {
    carregar(periodo);
  }, [carregar, periodo]);

  const opcoes = useMemo(() => {
    const meses = (dados?.meses || []).map((m) => m.mes).reverse();
    if (!meses.includes(mesAtual())) meses.unshift(mesAtual());
    return { meses, anos: dados?.anos || [] };
  }, [dados]);

  const ultimas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const l = dados?.ultimas || [];
    if (!b) return l;
    return l.filter((n) => n.cliente.toLowerCase().includes(b) || String(n.numero) === b || n.itens.some((i) => i.descricao.toLowerCase().includes(b)));
  }, [dados, busca]);

  if (!dados) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400">
        <LoaderCircle className="animate-spin" />
        <p className="text-sm font-semibold">Carregando o faturamento…</p>
      </div>
    );
  }

  const r = dados.resumo;
  const ehAno = /^\d{4}$/.test(periodo);
  const placas = dados.categorias.find((c) => c.chave === 'Placas');

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Faturamento</h2>
          <p className="text-xs font-medium text-slate-400">
            Pelas notas fiscais autorizadas (produção), lendo o que foi vendido em cada nota. Canceladas ficam de fora.
          </p>
        </div>
        {carregando && <LoaderCircle size={16} className="animate-spin text-slate-400" />}
        <select
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          className="bg-white border border-black/5 rounded-full px-4 py-2.5 text-sm font-bold text-brand-950 outline-none shadow-sm focus:border-brand-400"
        >
          <optgroup label="Mês">
            {opcoes.meses.map((k) => (
              <option key={k} value={k}>{rotulo(k, true)}</option>
            ))}
          </optgroup>
          <optgroup label="Ano inteiro">
            {opcoes.anos.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {dados.pendentes > 0 && (
        <div className="rounded-2xl bg-sun-100 text-yellow-800 px-4 py-3 text-sm font-semibold flex items-center gap-2">
          <LoaderCircle size={15} className="animate-spin" /> Lendo os itens das notas antigas pela primeira vez… faltam {dados.pendentes}.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile
          icon={CircleDollarSign}
          label={`Faturado · ${ehAno ? periodo : rotulo(periodo)}`}
          value={brl(r.total)}
          sub={<Variacao atual={r.total} base={r.anterior.total} rotuloBase={ehAno ? r.anterior.periodo : rotulo(r.anterior.periodo)} />}
        />
        <Tile icon={FileText} label="Notas" value={String(r.notas)} sub={`${r.clientes} cliente${r.clientes !== 1 ? 's' : ''} · ${numero(r.unidades)} itens`} />
        <Tile icon={TrendingUp} label="Ticket médio" value={brl(r.ticket_medio)} sub="valor médio por nota" />
        {r.ano_passado ? (
          <Tile
            icon={Layers}
            label={`Mesmo mês de ${r.ano_passado.periodo.slice(0, 4)}`}
            value={brl(r.ano_passado.total)}
            sub={<Variacao atual={r.total} base={r.ano_passado.total} rotuloBase="o ano passado" />}
            tone="slate"
          />
        ) : (
          <Tile icon={Ban} label="Canceladas" value={String(r.canceladas)} sub={r.canceladas ? `${brl(r.valor_cancelado)} fora do total` : 'nenhuma no período'} tone={r.canceladas ? 'amber' : 'slate'} />
        )}
      </div>
      {r.ano_passado && r.canceladas > 0 && (
        <p className="text-xs font-semibold text-slate-400 -mt-2">
          {r.canceladas} nota{r.canceladas !== 1 ? 's' : ''} cancelada{r.canceladas !== 1 ? 's' : ''} no período ({brl(r.valor_cancelado)}) — fora do total.
        </p>
      )}

      <GraficoMeses meses={dados.meses} selecionado={periodo} onSelect={setPeriodo} />

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <Ranking
          icon={Boxes}
          titulo="O que foi vendido"
          dica="Cada item das notas, agrupado pelo tipo de produto."
          linhas={dados.categorias}
          vazio="Nenhuma venda neste período."
        />
        <Ranking
          icon={Ruler}
          titulo="Placas por tamanho"
          dica={placas ? `${numero(placas.unidades)} placas · ${brl(placas.total)} no período` : 'Medida lida da descrição da nota.'}
          linhas={dados.tamanhos}
          vazio="Nenhuma placa neste período."
        />
      </div>

      <Ranking
        icon={Package}
        titulo="Produtos mais vendidos"
        dica="Pela descrição exata que saiu na nota."
        linhas={dados.produtos}
        vazio="Nenhum produto neste período."
        limite={12}
      />

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <Ranking icon={Layers} titulo="Por material" linhas={dados.materiais} vazio="Sem material identificado." />
        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-black/5">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm flex items-center gap-2">
              <Users size={15} className="text-brand-600" /> Melhores clientes
            </h3>
          </div>
          {!dados.clientes.length ? (
            <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Nenhum cliente neste período.</p>
          ) : (
            <div className="divide-y divide-black/5">
              {dados.clientes.slice(0, 10).map((c, i) => (
                <div key={c.documento || c.nome} className="px-6 py-2.5 flex items-center gap-3 text-sm">
                  <span className="w-5 text-[11px] font-extrabold text-slate-300">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-bold text-brand-950">{c.nome}</div>
                    <div className="text-[11px] text-slate-400">{fmtDoc(c.documento)} · {c.notas} nota{c.notas !== 1 ? 's' : ''}</div>
                  </div>
                  <span className="font-extrabold text-brand-700 text-xs">{brl(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3 items-start">
        <Ranking icon={MapPin} titulo="Por estado" linhas={dados.ufs} vazio="—" mostrarUnidades={false} limite={6} />
        <Ranking icon={Users} titulo="Empresa ou pessoa física" linhas={dados.tipos} vazio="—" mostrarUnidades={false} />
        <Ranking icon={Wallet} titulo="Forma de pagamento" linhas={dados.pagamentos} vazio="—" mostrarUnidades={false} />
      </div>

      <section className={`${card} overflow-hidden`}>
        <div className="px-6 py-4 border-b border-black/5 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h3 className="font-extrabold tracking-tight text-brand-950 text-sm">Notas de {ehAno ? periodo : rotulo(periodo, true)}</h3>
            <p className="text-[11px] font-medium text-slate-400 mt-0.5">Nota a nota, com o que foi vendido (as 40 mais recentes).</p>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="cliente, nº ou produto"
              className="border-2 border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-sm font-medium outline-none focus:border-brand-500 bg-white"
            />
          </div>
        </div>
        {!ultimas.length ? (
          <p className="px-6 py-8 text-sm font-medium text-slate-400 text-center">Nenhuma nota.</p>
        ) : (
          <div className="divide-y divide-black/5">
            {ultimas.map((n) => (
              <div key={n.id} className="px-6 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-extrabold text-brand-600 text-xs w-14">{n.numero}/{n.serie}</span>
                  <span className="text-[11px] font-bold text-slate-400 w-10">{dataBR(n.dh_emissao)}</span>
                  <span className="flex-1 min-w-0 truncate font-bold text-brand-950">{n.cliente}</span>
                  <span className="font-extrabold text-brand-700 text-xs w-24 text-right">{brl(n.valor)}</span>
                </div>
                <div className="mt-1 pl-[6.5rem] flex flex-wrap gap-x-3 gap-y-0.5">
                  {n.itens.map((i, k) => (
                    <span key={k} className="text-[11px] text-slate-500">
                      <span className="font-bold text-slate-600">{numero(i.quantidade)}×</span> {i.descricao}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
