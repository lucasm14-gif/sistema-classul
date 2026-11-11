import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Lock, ShieldCheck, FileText, Plus, Search, X, LoaderCircle, Send, Download, FileDown, Ban, PenLine,
  RefreshCw, Users, Package, Settings2, CheckCircle2, AlertTriangle, Clock, Trash2, Upload, KeyRound,
  Wifi, MessageCircle, Hash, FileSearch, Building2, User
} from 'lucide-react';
import { nfeApi, NfeLockError, getNfeToken, setNfeToken } from '../api';
import { useToast } from './Toast';

const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5';
// Padrão da Classul: o que se digita aparece em MAIÚSCULAS (o servidor grava assim).
// O placeholder continua normal; o e-mail usa inputEmail.
const input =
  'w-full border-2 border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white disabled:bg-slate-50 disabled:text-slate-400 not-placeholder-shown:uppercase';
const inputEmail = input.replace(' not-placeholder-shown:uppercase', '');
const btn = 'inline-flex items-center justify-center gap-2 rounded-xl font-bold text-sm px-4 py-2.5 transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-brand-600 hover:bg-brand-700 text-white`;
const btnGhost = `${btn} bg-white border-2 border-slate-200 text-slate-600 hover:border-brand-500 hover:text-brand-700`;
const btnDanger = `${btn} bg-flame-600 hover:bg-flame-700 text-white`;
const card = 'bg-white rounded-3xl border border-black/5 shadow-sm';
const inputAuto = input.replace('w-full ', 'w-auto ');

const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const fmtDoc = (d) => {
  const s = digits(d);
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d || '';
};
const fmtData = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const fmtChave = (c) => String(c || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const num = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
};

const SITUACAO = {
  autorizada: { txt: 'Autorizada', cls: 'bg-brand-100 text-brand-700', Icon: CheckCircle2 },
  cancelada: { txt: 'Cancelada', cls: 'bg-slate-200 text-slate-600', Icon: Ban },
  rejeitada: { txt: 'Rejeitada', cls: 'bg-flame-100 text-flame-700', Icon: AlertTriangle },
  pendente: { txt: 'Aguardando SEFAZ', cls: 'bg-sun-100 text-yellow-700', Icon: Clock },
  enviando: { txt: 'Enviando', cls: 'bg-sun-100 text-yellow-700', Icon: Clock },
  denegada: { txt: 'Denegada', cls: 'bg-flame-100 text-flame-700', Icon: Ban },
  inutilizada: { txt: 'Inutilizada', cls: 'bg-slate-200 text-slate-500', Icon: Ban }
};

function Badge({ situacao }) {
  const s = SITUACAO[situacao] || { txt: situacao, cls: 'bg-slate-100 text-slate-500', Icon: FileText };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${s.cls}`}>
      <s.Icon size={12} /> {s.txt}
    </span>
  );
}

function Modal({ title, onClose, children, wide }) {
  return createPortal(
    <div className="fixed inset-0 bg-brand-950/60 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white rounded-[1.75rem] shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[92vh] flex flex-col overflow-hidden animate-fade-up`}
      >
        <div className="px-6 py-4 flex items-center justify-between border-b border-black/5">
          <h2 className="font-extrabold tracking-tight text-brand-950">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-brand-950 hover:bg-black/5">
            <X size={19} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 bg-[#F7F8F3]">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// Baixa um Blob com nome, ou mostra numa janela já aberta no clique (sem bloqueio de pop-up).
function abrirBlob(blob, nome, janela) {
  const url = URL.createObjectURL(blob);
  if (janela) {
    janela.location.href = url;
  } else if (nome) {
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
  } else {
    window.open(url, '_blank');
  }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/* ------------------------------------------------------------------ PIN */

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
      const res = creating ? await nfeApi.setPin(pin) : await nfeApi.unlock(pin);
      setNfeToken(res.token);
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const pinInput = 'w-full text-center tracking-[0.4em] text-lg font-bold rounded-2xl border border-black/10 px-4 py-3 outline-none focus:border-brand-500 mb-3';
  return (
    <div className="h-full flex items-center justify-center p-6 animate-fade-up">
      <form onSubmit={submit} className={`${card} p-8 w-full max-w-sm text-center`}>
        <span className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center mx-auto mb-4">
          {creating ? <ShieldCheck size={26} /> : <Lock size={26} />}
        </span>
        <h2 className="text-xl font-extrabold tracking-tight text-brand-950">{creating ? 'Criar PIN das notas' : 'Notas bloqueadas'}</h2>
        <p className="text-xs font-medium text-slate-400 mt-1 mb-6">
          {creating ? 'Este PIN protege o certificado digital e a emissão de notas.' : 'Digite o PIN para emitir e ver as notas.'}
        </p>
        <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="PIN" className={pinInput} />
        {creating && (
          <input type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="Repita o PIN" className={pinInput} />
        )}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full py-3 mt-2 rounded-2xl`}>
          {busy ? 'Aguarde…' : creating ? 'Criar e entrar' : 'Desbloquear'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ Cliente */

const clienteVazio = {
  documento: '', nome: '', ie: '', contribuinte: 0, email: '', telefone: '', cep: '', logradouro: '', numero: '',
  complemento: '', bairro: '', municipio: '', cod_municipio: '', uf: ''
};

// Enter num campo vai para o próximo; no último, cai no botão de salvar (que tem data-enter)
// e o Enter seguinte salva. Textarea continua aceitando Enter normalmente.
function avancarComEnter(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented) return;
  const t = e.target;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return;
  e.preventDefault();
  const campos = [
    ...e.currentTarget.querySelectorAll('input:not([disabled]):not([type=file]):not([readonly]), select:not([disabled]), button[data-enter]')
  ].filter((el) => el.offsetParent !== null);
  const prox = campos[campos.indexOf(t) + 1];
  if (prox) {
    prox.focus();
    if (prox.select && prox.tagName === 'INPUT') prox.select();
  }
}

const SITUACAO_IE = [
  [0, 'Não contribuinte de ICMS'],
  [1, 'Contribuinte (tem inscrição estadual)'],
  [2, 'Isento de inscrição estadual']
];

function ClienteForm({ cliente, onSaved, onCancel, onError }) {
  const inicial = { ...clienteVazio, ...(cliente || {}) };
  const [f, setF] = useState(inicial);
  const [tipo, setTipo] = useState(digits(inicial.documento).length === 11 ? 'pf' : 'pj');
  const [busy, setBusy] = useState('');
  const [aviso, setAviso] = useState('');
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const pj = tipo === 'pj';
  const docRef = useRef(null);

  useEffect(() => {
    docRef.current?.focus();
  }, [tipo]);

  const consultados = useRef({ cnpj: '', cep: '' });
  const numeroRef = useRef(null);
  const ruaRef = useRef(null);
  const cepRef = useRef(null);

  // CEP → rua, bairro, cidade, UF e código IBGE. ViaCEP; se falhar, BrasilAPI.
  const buscarCep = async (cep = f.cep, { forcar = false } = {}) => {
    const c = digits(cep);
    if (c.length !== 8 || (!forcar && consultados.current.cep === c)) return null;
    consultados.current.cep = c;
    setBusy('cep');
    try {
      let r = await fetch(`https://viacep.com.br/ws/${c}/json/`).then((x) => x.json()).catch(() => null);
      if (!r || r.erro) {
        const b = await fetch(`https://brasilapi.com.br/api/cep/v2/${c}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        r = b && { logradouro: b.street, bairro: b.neighborhood, localidade: b.city, uf: b.state, ibge: '' };
      }
      if (!r) throw new Error('CEP não encontrado. Confira os números.');
      let ibge = r.ibge;
      if (!ibge && r.localidade) {
        // BrasilAPI não traz o IBGE no CEP: busca pela cidade.
        const cidades = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${r.uf}`).then((x) => x.json()).catch(() => []);
        const alvo = r.localidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
        ibge = cidades.find((m) => m.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === alvo)?.codigo_ibge || '';
      }
      setF((p) => ({
        ...p,
        cep: c.replace(/^(\d{5})(\d{3})$/, '$1-$2'),
        logradouro: p.logradouro || r.logradouro || '',
        bairro: p.bairro || r.bairro || '',
        municipio: r.localidade || p.municipio,
        cod_municipio: ibge ? String(ibge) : p.cod_municipio,
        uf: r.uf || p.uf
      }));
      // Se a pessoa estava no CEP, já leva para o número (ou para a rua, se o CEP for geral da cidade).
      if (document.activeElement === cepRef.current) {
        setTimeout(() => {
          const alvo = r.logradouro ? numeroRef.current : ruaRef.current;
          alvo?.focus();
          alvo?.select?.();
        }, 0);
      }
      return r.uf;
    } catch (err) {
      onError(err.message);
      return null;
    } finally {
      setBusy((b) => (b === 'cep' ? '' : b));
    }
  };

  // IE no cadastro de contribuintes da SEFAZ (usa o certificado da Classul).
  const buscarIE = async (uf = f.uf, silencioso = false, doc = f.documento) => {
    const d = digits(doc);
    if (d.length !== 14 || !uf) {
      if (!silencioso) onError(d.length !== 14 ? 'Preencha o CNPJ.' : 'Preencha o CEP antes (para saber o estado).');
      return;
    }
    setBusy('ie');
    try {
      const r = await nfeApi.buscarIE(d, uf);
      if (r.encontrado) {
        setF((p) => ({ ...p, ie: r.ie, contribuinte: r.situacao === 'habilitado' ? 1 : p.contribuinte }));
        setAviso(`IE ${r.ie} encontrada na SEFAZ-${uf} (${r.situacao}).`);
      } else {
        setF((p) => ({ ...p, contribuinte: p.ie ? p.contribuinte : 0 }));
        setAviso(r.motivo);
      }
    } catch (err) {
      if (!silencioso) onError(err.message, err);
      else setAviso(err.message);
    } finally {
      setBusy((b) => (b === 'ie' ? '' : b));
    }
  };

  // CNPJ → razão social, endereço, cidade (IBGE), telefone, e-mail e inscrição estadual.
  // Fonte: CNPJ.ws (traz a IE de qualquer estado); se falhar, BrasilAPI + cadastro da SEFAZ.
  const buscarCnpj = async (doc = f.documento, { forcar = false } = {}) => {
    const d = digits(doc);
    if (d.length !== 14 || (!forcar && consultados.current.cnpj === d)) return;
    consultados.current.cnpj = d;
    setBusy('cnpj');
    setAviso('');
    try {
      let dados = null;
      const ws = await fetch(`https://publica.cnpj.ws/cnpj/${d}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (ws?.estabelecimento) {
        const e = ws.estabelecimento;
        const ies = (e.inscricoes_estaduais || []).filter((i) => i.ativo && i.estado?.sigla === e.estado?.sigla);
        dados = {
          nome: ws.razao_social,
          situacao: e.situacao_cadastral,
          logradouro: [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' '),
          numero: e.numero,
          complemento: e.complemento,
          bairro: e.bairro,
          cep: e.cep,
          municipio: e.cidade?.nome,
          ibge: e.cidade?.ibge_id,
          uf: e.estado?.sigla,
          telefone: [e.ddd1, e.telefone1].filter(Boolean).join(''),
          email: e.email,
          ie: ies[0]?.inscricao_estadual || '',
          ieConsultada: true
        };
      } else {
        const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (!r) throw new Error('Não achei este CNPJ na Receita. Confira os números ou preencha à mão.');
        dados = {
          nome: r.razao_social,
          situacao: r.descricao_situacao_cadastral,
          logradouro: [r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(' '),
          numero: r.numero,
          complemento: r.complemento,
          bairro: r.bairro,
          cep: r.cep,
          municipio: r.municipio,
          ibge: r.codigo_municipio_ibge,
          uf: r.uf,
          telefone: digits(r.ddd_telefone_1),
          email: r.email,
          ie: '',
          ieConsultada: false
        };
      }
      const avisos = [];
      if (dados.situacao && !/^ativa$/i.test(dados.situacao)) avisos.push(`Atenção: na Receita este CNPJ está ${String(dados.situacao).toUpperCase()}.`);
      setF((p) => ({
        ...p,
        nome: p.nome || dados.nome || '',
        logradouro: p.logradouro || dados.logradouro || '',
        numero: p.numero || dados.numero || '',
        complemento: p.complemento || dados.complemento || '',
        bairro: p.bairro || dados.bairro || '',
        cep: p.cep || String(digits(dados.cep)).replace(/^(\d{5})(\d{3})$/, '$1-$2'),
        municipio: dados.municipio || p.municipio,
        cod_municipio: dados.ibge ? String(dados.ibge) : p.cod_municipio,
        uf: dados.uf || p.uf,
        telefone: p.telefone || digits(dados.telefone),
        email: p.email || String(dados.email || '').toLowerCase(),
        ie: p.ie || dados.ie,
        contribuinte: p.ie || dados.ie ? 1 : dados.ieConsultada ? 0 : p.contribuinte
      }));
      if (dados.cep) consultados.current.cep = digits(dados.cep);
      if (!dados.ibge && dados.cep) await buscarCep(dados.cep, { forcar: true });
      if (dados.ie) avisos.push(`Inscrição estadual ${dados.ie} encontrada (${dados.uf}) — marcado como contribuinte de ICMS.`);
      else if (dados.ieConsultada) avisos.push(`Sem inscrição estadual ativa em ${dados.uf}: fica como não contribuinte.`);
      setAviso(avisos.join(' ') || 'Dados preenchidos pela Receita. Confira.');
      if (!dados.ieConsultada && dados.uf) await buscarIE(dados.uf, true, d);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy((b) => (b === 'cnpj' ? '' : b));
    }
  };

  // Veio da busca da emissão com o CNPJ já digitado: preenche sozinho ao abrir.
  useEffect(() => {
    if (!cliente?.id && digits(inicial.documento).length === 14 && !inicial.nome) buscarCnpj(inicial.documento);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trocarTipo = (t) => {
    setTipo(t);
    setAviso('');
    // Cadastro novo: troca de tipo recomeça (os dados da empresa não servem para a pessoa física).
    setF((p) => (cliente?.id ? { ...p, documento: '', ie: '', contribuinte: 0 } : { ...clienteVazio }));
  };

  const docOk = digits(f.documento).length === (pj ? 14 : 11);
  const save = async () => {
    if (!docOk) return onError(pj ? 'O CNPJ tem 14 números.' : 'O CPF tem 11 números.');
    setBusy('save');
    try {
      onSaved(await nfeApi.saveCliente(cliente?.id, { ...f, contribuinte: Number(f.contribuinte) }));
    } catch (err) {
      onError(err.message, err);
    } finally {
      setBusy('');
    }
  };

  const spin = (k) => busy === k && <LoaderCircle size={14} className="animate-spin text-slate-400" />;
  return (
    <div className="grid grid-cols-6 gap-3" onKeyDown={avancarComEnter}>
      <div className="col-span-6 flex gap-2">
        {[['pj', 'Empresa (CNPJ)'], ['pf', 'Pessoa física (CPF)']].map(([t, l]) => (
          <button key={t} type="button" tabIndex={-1} onClick={() => trocarTipo(t)} className={tipo === t ? btnPrimary : btnGhost}>
            {t === 'pj' ? <Building2 size={15} /> : <User size={15} />} {l}
          </button>
        ))}
      </div>

      <div className="col-span-6 sm:col-span-2">
        <label className={label}>{pj ? 'CNPJ' : 'CPF'} *</label>
        <div className="flex items-center gap-2">
          <input
            ref={docRef}
            className={input}
            value={f.documento}
            onChange={(e) => {
              const v = e.target.value;
              setF((p) => ({ ...p, documento: v }));
              // Assim que o CNPJ fica completo, já busca o resto.
              if (pj && digits(v).length === 14) buscarCnpj(v);
            }}
            onBlur={() => {
              setF((p) => ({ ...p, documento: fmtDoc(p.documento) }));
              if (pj) buscarCnpj();
              const d = digits(f.documento);
              if (d && d.length !== (pj ? 14 : 11)) setAviso(pj ? 'O CNPJ tem 14 números.' : 'O CPF tem 11 números.');
            }}
            placeholder={pj ? '00.000.000/0000-00' : '000.000.000-00'}
            inputMode="numeric"
          />
          {spin('cnpj')}
        </div>
      </div>
      <div className="col-span-6 sm:col-span-4">
        <label className={label}>{pj ? 'Razão social' : 'Nome completo'} *</label>
        <input className={input} value={f.nome} onChange={set('nome')} />
      </div>

      {pj && (
        <>
          <div className="col-span-6 sm:col-span-3">
            <label className={label}>Situação no ICMS</label>
            <select className={input} value={f.contribuinte} onChange={(e) => setF((p) => ({ ...p, contribuinte: Number(e.target.value), ie: Number(e.target.value) === 1 ? p.ie : '' }))}>
              {SITUACAO_IE.map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </select>
          </div>
          <div className="col-span-6 sm:col-span-3">
            <label className={label}>Inscrição estadual {Number(f.contribuinte) === 1 ? '*' : ''}</label>
            <div className="flex gap-2">
              <input
                className={input}
                value={f.ie || ''}
                onChange={(e) => setF((p) => ({ ...p, ie: e.target.value, contribuinte: digits(e.target.value) && !p.contribuinte ? 1 : p.contribuinte }))}
                disabled={Number(f.contribuinte) === 2}
                placeholder={Number(f.contribuinte) === 2 ? 'isento' : 'só números'}
                inputMode="numeric"
              />
              <button type="button" tabIndex={-1} className={btnGhost} title="Buscar a IE na SEFAZ" onClick={() => buscarIE()} disabled={busy === 'ie'}>
                {busy === 'ie' ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />} SEFAZ
              </button>
            </div>
          </div>
        </>
      )}
      {aviso && <div className="col-span-6 rounded-xl bg-brand-50 text-brand-800 px-3 py-2 text-xs font-semibold">{aviso}</div>}

      <div className="col-span-3 sm:col-span-2">
        <label className={label}>CEP *</label>
        <div className="flex items-center gap-2">
          <input
            ref={cepRef}
            className={input}
            value={f.cep}
            onChange={(e) => {
              const v = e.target.value;
              setF((p) => ({ ...p, cep: v }));
              if (digits(v).length === 8) buscarCep(v);
            }}
            onBlur={() => buscarCep()}
            inputMode="numeric"
            placeholder="00000-000"
          />
          {spin('cep')}
        </div>
      </div>
      <div className="col-span-3 sm:col-span-4">
        <label className={label}>Cidade / UF</label>
        <div className={`${input} bg-slate-50 text-slate-500 truncate`}>
          {f.municipio ? `${f.municipio} - ${f.uf}` : 'preenchida pelo CEP'}
          {f.cod_municipio && <span className="text-[10px] text-slate-400"> · IBGE {f.cod_municipio}</span>}
        </div>
      </div>
      <div className="col-span-6 sm:col-span-4">
        <label className={label}>Endereço (rua) *</label>
        <input ref={ruaRef} className={input} value={f.logradouro} onChange={set('logradouro')} />
      </div>
      <div className="col-span-2">
        <label className={label}>Número</label>
        <input ref={numeroRef} className={input} value={f.numero} onChange={set('numero')} placeholder="S/N" />
      </div>
      <div className="col-span-4 sm:col-span-3">
        <label className={label}>Bairro *</label>
        <input className={input} value={f.bairro} onChange={set('bairro')} />
      </div>
      <div className="col-span-6 sm:col-span-3">
        <label className={label}>Complemento</label>
        <input className={input} value={f.complemento || ''} onChange={set('complemento')} placeholder="sala, apto, bloco…" />
      </div>
      <div className="col-span-6 sm:col-span-3">
        <label className={label}>Telefone / WhatsApp</label>
        <input className={input} value={f.telefone || ''} onChange={set('telefone')} inputMode="tel" placeholder="(51) 99999-9999" />
      </div>
      <div className="col-span-6 sm:col-span-3">
        <label className={label}>E-mail</label>
        <input className={inputEmail} value={f.email || ''} onChange={set('email')} type="email" placeholder="opcional" />
      </div>
      <div className="col-span-6 flex justify-between items-center gap-2 mt-2">
        <span className="text-[11px] text-slate-400">Enter passa para o próximo campo.</span>
        <div className="flex gap-2">
          {onCancel && <button type="button" className={btnGhost} onClick={onCancel}>Cancelar</button>}
          <button type="button" data-enter className={`${btnPrimary} focus:ring-4 focus:ring-brand-500/40 outline-none`} onClick={save} disabled={busy === 'save'}>
            {busy === 'save' ? <LoaderCircle size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Salvar cliente
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ busca inteligente

// Normaliza para comparar: sem acento, minúsculo e "12 x 17" vira "12x17".
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/g, '$1x$2')
    .replace(/c\/\s*/g, 'com ');

// Como as pessoas falam × como está escrito no cadastro do C&K.
const SINONIMOS = {
  homenagem: ['placa'], inauguracao: ['placa'], jazigo: ['placa'], placa: ['placa', 'plaqueta'], plaqueta: ['placa', 'cracha'],
  inox: ['inox', 'aco'], aco: ['aco', 'inox'], metal: ['aco', 'metal', 'latao'], dourada: ['latao', 'dour'], latao: ['latao'],
  pin: ['pin', 'boton'], pins: ['pin', 'boton'], boton: ['boton', 'pin'], botom: ['boton'], botton: ['boton'], broche: ['boton', 'pin', 'broche'],
  estojo: ['estojo', 'est'], caixa: ['estojo'], veludo: ['vel'], com: ['com'], trofeu: ['trofeu'], medalha: ['medalha'],
  cracha: ['cracha'], acrilico: ['acril'], quadro: ['moldura', 'quadro'], moldura: ['moldura'], ima: ['magneto', 'ima'], tapete: ['tapete', 'capacho']
};

function pontuar(produto, tokens) {
  const palavras = norm(`${produto.codigo || ''} ${produto.descricao}`).split(/[^a-z0-9.,/]+/).filter(Boolean);
  let total = 0;
  for (const t of tokens) {
    const alvos = [t, ...(SINONIMOS[t] || [])];
    let melhor = 0;
    for (const w of palavras) {
      for (const a of alvos) {
        if (w === a) melhor = Math.max(melhor, a === t ? 6 : 4);
        else if (w.startsWith(a)) melhor = Math.max(melhor, a === t ? 4 : 3);
        else if (w.length >= 3 && a.startsWith(w)) melhor = Math.max(melhor, 3);
        else if (a.length >= 3 && w.includes(a)) melhor = Math.max(melhor, 2);
      }
    }
    if (!melhor) return 0; // todo termo digitado precisa aparecer
    total += melhor;
  }
  return total + Math.log2((produto.uso || 0) + 1);
}

function buscarProdutos(produtos, texto, limite = 8) {
  const tokens = norm(texto).split(/[^a-z0-9.,/]+/).filter((t) => t && t !== 'de' && t !== 'tam' && t !== 'cm');
  // Sempre em ordem alfabética; digitar só filtra.
  const alfa = (a, b) => String(a.descricao).localeCompare(String(b.descricao), 'pt-BR', { sensitivity: 'base' });
  if (!tokens.length) return [...produtos].sort(alfa).slice(0, limite);
  return produtos.filter((p) => pontuar(p, tokens) > 0).sort(alfa).slice(0, limite);
}

// Lista com setas ↑ ↓, Enter escolhe e Esc fecha.
function useNavegacao(itens, onEscolher) {
  const [ativo, setAtivo] = useState(0);
  useEffect(() => setAtivo(0), [itens.length]);
  const onKeyDown = (e) => {
    if (!itens.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => (a + 1) % itens.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => (a - 1 + itens.length) % itens.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onEscolher(itens[Math.min(ativo, itens.length - 1)]);
    }
  };
  return { ativo, setAtivo, onKeyDown };
}

// Destaca no texto os termos digitados (comparação sem acento e sem maiúscula).
const simples = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function Realce({ texto, termos }) {
  const t = simples(termos).split(/[\s,]+/).filter((x) => x.length >= 2);
  const base = simples(texto);
  if (!t.length || base.length !== texto.length) return texto;
  const marcas = new Array(texto.length).fill(false);
  for (const termo of t) {
    let i = base.indexOf(termo);
    while (i >= 0) {
      for (let k = i; k < i + termo.length; k++) marcas[k] = true;
      i = base.indexOf(termo, i + termo.length);
    }
  }
  const partes = [];
  let atual = '';
  let marcado = marcas[0];
  [...texto].forEach((ch, i) => {
    if (marcas[i] !== marcado) {
      partes.push([atual, marcado]);
      atual = '';
      marcado = marcas[i];
    }
    atual += ch;
  });
  partes.push([atual, marcado]);
  return partes.map(([p, m], i) => (m ? <span key={i} className="text-brand-600 underline decoration-2 underline-offset-2">{p}</span> : <span key={i}>{p}</span>));
}

/* ------------------------------------------------------------------ Cliente na emissão */

function ClientePicker({ value, onChange, onError }) {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState(false);
  const escolher = (c) => {
    onChange(c);
    setAberto(false);
    setBusca('');
  };
  const nav = useNavegacao(aberto ? lista : [], escolher);

  // Só a resposta da última busca vale (uma resposta lenta antiga não sobrescreve a nova).
  const pedido = useRef(0);
  useEffect(() => {
    if (!aberto) return undefined;
    const meu = ++pedido.current;
    const t = setTimeout(
      () =>
        nfeApi
          .clientes(busca)
          .then((l) => meu === pedido.current && setLista(l))
          .catch((e) => onError(e.message, e)),
      busca ? 200 : 0
    );
    return () => clearTimeout(t);
  }, [busca, aberto, onError]);

  if (value) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-2xl border-2 border-brand-200 bg-brand-50/50 px-4 py-3">
        <div className="min-w-0">
          <div className="font-extrabold text-brand-950 truncate">{value.nome}</div>
          <div className="text-xs font-semibold text-slate-500">
            {fmtDoc(value.documento)} · {value.municipio} - {value.uf}
            {Number(value.contribuinte) === 1 ? ` · IE ${value.ie}` : Number(value.contribuinte) === 2 ? ' · isento de IE' : ''}
          </div>
        </div>
        <button className="text-xs font-bold text-brand-700 hover:underline shrink-0" onClick={() => onChange(null)}>
          trocar
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${input} pl-9`}
            placeholder="Digite o nome, CPF ou CNPJ do cliente"
            value={busca}
            autoFocus
            onFocus={() => setAberto(true)}
            onBlur={() => setTimeout(() => setAberto(false), 150)}
            onChange={(e) => {
              setBusca(e.target.value);
              setAberto(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAberto(false);
              // Nada encontrado: Enter já abre o cadastro com o que foi digitado.
              if (e.key === 'Enter' && busca.trim() && !lista.length) {
                e.preventDefault();
                setNovo(true);
                return;
              }
              nav.onKeyDown(e);
            }}
          />
        </div>
        <button className={btnGhost} onClick={() => setNovo(true)}>
          <Plus size={15} /> Novo
        </button>
      </div>
      {aberto && (
        <div className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xl">
          {!busca && lista.length > 0 && <div className="px-4 pt-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Clientes de A a Z</div>}
          {lista.map((c, i) => (
            <button
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => nav.setAtivo(i)}
              onClick={() => escolher(c)}
              className={`w-full text-left px-4 py-2.5 border-b border-black/5 last:border-0 ${i === nav.ativo ? 'bg-brand-50' : ''}`}
            >
              <div className="font-bold text-sm text-brand-950 truncate"><Realce texto={c.nome} termos={busca} /></div>
              <div className="text-xs text-slate-500">{fmtDoc(c.documento)} · {c.municipio} - {c.uf}</div>
            </button>
          ))}
          {busca && !lista.length && (
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => setNovo(true)} className="w-full text-left px-4 py-3 text-sm font-bold text-brand-700 hover:bg-brand-50">
              + Cadastrar novo cliente {digits(busca).length >= 11 ? fmtDoc(busca) : `"${busca}"`}
            </button>
          )}
        </div>
      )}
      {novo && (
        <Modal title="Novo cliente" onClose={() => setNovo(false)} wide>
          <ClienteForm
            cliente={digits(busca).length >= 11 ? { documento: digits(busca) } : busca ? { nome: busca } : null}
            onCancel={() => setNovo(false)}
            onError={onError}
            onSaved={(c) => {
              setNovo(false);
              escolher(c);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Produto na emissão */

function ProdutoBusca({ produtos, onEscolher, onNovo, inputRef, onEnterVazio }) {
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const sugestoes = useMemo(() => buscarProdutos(produtos, texto, 300), [produtos, texto]);
  const escolher = (p) => {
    onEscolher(p);
    setTexto('');
  };
  const nav = useNavegacao(aberto ? sugestoes : [], escolher);

  return (
    <div className="relative">
      <div className="relative">
        <Package size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          className={`${input} pl-9 pr-24`}
          placeholder='Digite o produto: "12x17", "estojo 20x16", "medalha"…'
          value={texto}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAberto(false);
            // Campo vazio + Enter: a nota já tem itens, então segue para o botão de emitir.
            if (e.key === 'Enter' && !texto.trim() && onEnterVazio?.()) {
              e.preventDefault();
              setAberto(false);
              return;
            }
            if (e.key === 'Enter' && !sugestoes.length && texto.trim()) {
              e.preventDefault();
              onNovo(texto.trim());
              return;
            }
            nav.onKeyDown(e);
          }}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-300 hidden sm:block">↑ ↓ Enter</span>
      </div>
      {aberto && (
        <div className="absolute z-20 mt-1 w-full max-h-96 overflow-y-auto rounded-2xl border border-black/10 bg-white shadow-xl">
          {!texto && <div className="px-4 pt-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Produtos de A a Z</div>}
          {sugestoes.map((p, i) => (
            <button
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => nav.setAtivo(i)}
              onClick={() => escolher(p)}
              className={`w-full text-left px-4 py-2.5 border-b border-black/5 last:border-0 flex items-center justify-between gap-3 ${i === nav.ativo ? 'bg-brand-50' : ''}`}
            >
              <div className="min-w-0">
                <div className="font-bold text-sm text-brand-950 truncate"><Realce texto={p.descricao} termos={texto} /></div>
                <div className="text-[11px] text-slate-500">
                  {p.codigo ? `cód. ${p.codigo} · ` : ''}NCM {p.ncm} · {p.cfop_dentro === '5101' ? 'fabricação' : 'revenda'}
                  {p.uso ? ` · saiu ${p.uso}×` : ''}
                </div>
              </div>
              <span className="text-sm font-extrabold text-brand-700 shrink-0">{p.valor ? brl(p.valor) : ''}</span>
            </button>
          ))}
          {texto.trim() && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onNovo(texto.trim())}
              className="w-full text-left px-4 py-2.5 text-sm font-bold text-brand-700 hover:bg-brand-50"
            >
              + Cadastrar "{texto.trim()}" como produto novo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Emitir */

// inicial: { tipo: 'corrigir' | 'copiar', nota?, cliente?, itens, pagamento, frete, inf_cpl }
function Emitir({ config, inicial, onEmitida, onError, toast }) {
  const [produtos, setProdutos] = useState([]);
  const [cliente, setCliente] = useState(inicial?.cliente || null);
  const [ultima, setUltima] = useState(null);
  const [itens, setItens] = useState(() => (inicial?.itens || []).map((i, k) => ({ ...i, _k: `i${k}` })));
  const [tPag, setTPag] = useState(inicial?.pagamento?.tPag || config.pagamento_padrao || '17');
  const [frete, setFrete] = useState(inicial?.frete ? String(inicial.frete).replace('.', ',') : '');
  const [infCpl, setInfCpl] = useState(inicial?.inf_cpl ?? config.inf_cpl ?? '');
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [novoProduto, setNovoProduto] = useState(null);
  const [foco, setFoco] = useState(null);
  // Fluxo só no Enter: cliente → produto → qtd → valor → próximo produto → (vazio) → Emitir.
  const produtoRef = useRef(null);
  const emitirRef = useRef(null);
  const valorRefs = useRef({});
  const qtdRefs = useRef({});
  // Item recém-adicionado: cursor direto na quantidade.
  useEffect(() => {
    if (!foco) return;
    const el = qtdRefs.current[foco];
    if (el) {
      el.focus();
      el.select();
    }
    setFoco(null);
  }, [foco, itens]);
  const focar = (el) => {
    el?.focus();
    el?.select?.();
  };
  const escolherCliente = (c) => {
    setCliente(c);
    if (c) focar(produtoRef.current);
  };
  const enterPara = (alvo) => (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focar(typeof alvo === 'function' ? alvo() : alvo);
  };
  const corrigindo = inicial?.tipo === 'corrigir' ? inicial.nota : null;

  const carregarProdutos = useCallback(
    () => nfeApi.produtos().then((p) => setProdutos(p.filter((x) => x.ativo))).catch((e) => onError(e.message, e)),
    [onError]
  );
  useEffect(() => {
    carregarProdutos();
  }, [carregarProdutos]);

  // Na nota rejeitada, o cliente vem do id guardado nos dados.
  useEffect(() => {
    if (corrigindo?.dados?.cliente_id && !cliente) {
      nfeApi.clientes(corrigindo.cliente_doc || '').then((l) => setCliente(l.find((c) => c.id === corrigindo.dados.cliente_id) || null)).catch(() => {});
    }
  }, [corrigindo, cliente]);

  // Última compra do cliente escolhido (para repetir com um clique).
  useEffect(() => {
    setUltima(null);
    if (!cliente?.id || corrigindo) return;
    nfeApi.ultimaDoCliente(cliente.id).then(setUltima).catch(() => {});
  }, [cliente, corrigindo]);

  const fora = cliente && cliente.uf !== config.emitente.uf;

  const itemDoProduto = (p) => ({
    _k: `n${Date.now()}${Math.random()}`, produto_id: p.id, codigo: p.codigo, descricao: p.descricao, ncm: p.ncm, cest: p.cest,
    cfop_dentro: p.cfop_dentro, cfop_fora: p.cfop_fora, unidade: p.unidade, origem: p.origem, csosn: p.csosn,
    aliq_tributos: p.aliq_tributos, quantidade: 1, valor_unitario: p.valor ? String(p.valor).replace('.', ',') : '', desconto: '', info_adicional: ''
  });
  const addProduto = (p) => {
    const item = itemDoProduto(p);
    setItens((l) => [...l, item]);
    setFoco(item._k);
  };
  const repetirUltima = () => {
    setItens(ultima.itens.map((i, k) => ({ ...i, _k: `u${Date.now()}${k}`, valor_unitario: String(i.valor_unitario).replace('.', ','), desconto: i.desconto ? String(i.desconto).replace('.', ',') : '' })));
    toast(`Itens da nota ${ultima.numero} copiados. Confira quantidades e valores.`, 'info');
  };
  const setItem = (k, campo) => (e) => setItens((l) => l.map((i) => (i._k === k ? { ...i, [campo]: e.target.value } : i)));

  const totalProdutos = itens.reduce((s, i) => s + num(i.quantidade) * num(i.valor_unitario) - num(i.desconto), 0);
  const total = totalProdutos + num(frete);
  const faltaValor = itens.some((i) => !(num(i.valor_unitario) > 0) || !(num(i.quantidade) > 0));

  const emitir = async () => {
    if (!cliente) return onError('Escolha o cliente.');
    if (!itens.length) return onError('Adicione pelo menos um produto.');
    if (faltaValor) return onError('Tem item sem quantidade ou valor.');
    const amb = config.ambiente === 1 ? 'PRODUÇÃO (vale como nota fiscal de verdade)' : 'homologação (teste, sem valor fiscal)';
    if (!confirm(`Emitir a nota ${corrigindo ? `nº ${corrigindo.numero} de novo` : `nº ${config.proximo_numero}`} de ${brl(total)} para ${cliente.nome}?\n\nAmbiente: ${amb}`)) return;
    setBusy(true);
    setResultado(null);
    try {
      const nota = await nfeApi.emitir({
        nota_id: corrigindo?.id || null,
        cliente_id: cliente.id,
        itens: itens.map(({ _k, ...i }) => ({ ...i, quantidade: num(i.quantidade), valor_unitario: num(i.valor_unitario), desconto: num(i.desconto), cfop: fora ? i.cfop_fora : i.cfop_dentro })),
        pagamento: { tPag },
        frete: num(frete),
        inf_cpl: infCpl
      });
      setResultado(nota);
      if (nota.situacao === 'autorizada') {
        toast(`Nota ${nota.numero} autorizada!`, 'success');
        onEmitida(nota);
      }
    } catch (err) {
      onError(err.message, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {config.ambiente !== 1 && (
        <div className="rounded-2xl bg-sun-100 text-yellow-800 px-4 py-3 text-sm font-semibold">
          Ambiente de <b>homologação</b>: as notas são de teste e não têm valor fiscal. Mude para produção em Configurar quando os testes estiverem ok.
        </div>
      )}
      {corrigindo && (
        <div className="rounded-2xl bg-flame-50 text-flame-700 px-4 py-3 text-sm font-semibold">
          Corrigindo a nota nº {corrigindo.numero} (rejeitada: {corrigindo.motivo}). Ela será reenviada com o mesmo número.
        </div>
      )}
      {inicial?.tipo === 'copiar' && (
        <div className="rounded-2xl bg-brand-50 text-brand-800 px-4 py-3 text-sm font-semibold">
          Nova nota baseada na nº {inicial.nota.numero}. Confira cliente, quantidades e valores antes de emitir.
        </div>
      )}

      <section className={`${card} p-5`}>
        <h3 className={label}>1 · Cliente</h3>
        <ClientePicker value={cliente} onChange={escolherCliente} onError={onError} />
        {fora && <p className="text-xs font-semibold text-slate-500 mt-2">Cliente de outro estado: a nota sai como "venda fora do estado" (CFOP 6xxx).</p>}
        {ultima && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#F7F8F3] px-4 py-2.5">
            <div className="text-xs font-semibold text-slate-600">
              Última compra: nota {ultima.numero} em {fmtData(ultima.dh_emissao).slice(0, 8)} · {brl(ultima.valor_total)} ·{' '}
              {ultima.itens.map((i) => `${num(i.quantidade)}× ${i.descricao}`).join(', ').slice(0, 90)}
            </div>
            <button className="text-xs font-extrabold text-brand-700 hover:underline" onClick={repetirUltima}>
              Repetir itens
            </button>
          </div>
        )}
      </section>

      <section className={`${card} p-5`}>
        <h3 className={label}>2 · Produtos</h3>
        <ProdutoBusca
          produtos={produtos}
          inputRef={produtoRef}
          onEscolher={addProduto}
          onNovo={(descricao) => setNovoProduto({ descricao })}
          onEnterVazio={() => {
            if (!itens.length) return false;
            focar(emitirRef.current);
            return true;
          }}
        />
        <p className="text-[11px] font-semibold text-slate-400 mt-1.5">
          Dica: só no Enter — escolha o produto, Enter, quantidade, Enter, valor, Enter. Com o campo vazio, Enter vai para Emitir.
        </p>
        {!produtos.length && <p className="text-xs text-slate-400 mt-2">Nenhum produto cadastrado ainda: importe do C&K em Configurar ou cadastre pelo campo acima.</p>}
        <div className="space-y-2 mt-3">
          {itens.map((i, idx) => {
            const subtotal = num(i.quantidade) * num(i.valor_unitario) - num(i.desconto);
            return (
              <div key={i._k} className="grid grid-cols-12 gap-2 items-end rounded-2xl bg-[#F7F8F3] p-3">
                <div className="col-span-12 sm:col-span-5">
                  <label className={label}>Item {idx + 1}</label>
                  <input className={input} value={i.descricao} onChange={setItem(i._k, 'descricao')} />
                  <div className="text-[10px] font-semibold text-slate-400 mt-1">
                    NCM {i.ncm} · CFOP {fora ? i.cfop_fora : i.cfop_dentro} · {i.unidade}
                  </div>
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <label className={label}>Qtd</label>
                  <input
                    className={input}
                    value={i.quantidade}
                    onChange={setItem(i._k, 'quantidade')}
                    onKeyDown={enterPara(() => valorRefs.current[i._k])}
                    inputMode="decimal"
                    ref={(el) => (qtdRefs.current[i._k] = el)}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className={label}>Valor un.</label>
                  <input
                    className={`${input} ${!(num(i.valor_unitario) > 0) ? '!border-flame-300' : ''}`}
                    value={i.valor_unitario}
                    onChange={setItem(i._k, 'valor_unitario')}
                    onKeyDown={enterPara(() => produtoRef.current)}
                    ref={(el) => (valorRefs.current[i._k] = el)}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </div>
                <div className="col-span-3 sm:col-span-2">
                  <label className={label}>Desconto</label>
                  <input className={input} value={i.desconto} onChange={setItem(i._k, 'desconto')} onKeyDown={enterPara(() => produtoRef.current)} inputMode="decimal" placeholder="0,00" />
                </div>
                <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-2 pb-2">
                  <span className="text-sm font-extrabold text-brand-950">{brl(subtotal)}</span>
                  <button className="p-1.5 text-slate-400 hover:text-flame-600" title="Tirar item" onClick={() => setItens((l) => l.filter((x) => x._k !== i._k))}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="col-span-12">
                  <input className={input} value={i.info_adicional || ''} onChange={setItem(i._k, 'info_adicional')} placeholder="Informação adicional do item (opcional, ex.: texto da placa)" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={`${card} p-5 grid grid-cols-6 gap-3`}>
        <h3 className={`${label} col-span-6`}>3 · Pagamento e observações</h3>
        <div className="col-span-6 sm:col-span-3">
          <label className={label}>Forma de pagamento</label>
          <select className={input} value={tPag} onChange={(e) => setTPag(e.target.value)}>
            {(config.formas_pagamento || []).map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className={label}>Frete cobrado (opcional)</label>
          <input className={input} value={frete} onChange={(e) => setFrete(e.target.value)} placeholder="0,00" inputMode="decimal" />
        </div>
        <div className="col-span-6">
          <label className={label}>Informações complementares</label>
          <textarea className={`${input} min-h-[70px]`} value={infCpl} onChange={(e) => setInfCpl(e.target.value)} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {['*PAGAMENTO JA EFETUADO; ', '*PAGAMENTO VIA PIX CHAVE CNPJ 18605962000130; '].map((t) => (
              <button key={t} className="text-[11px] font-bold text-brand-700 hover:underline" onClick={() => setInfCpl((v) => (v.includes(t.trim()) ? v : t + v))}>
                + {t.replace(/[*;]/g, '').trim().toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className={`${card} p-5 flex flex-wrap items-center justify-between gap-3 sticky bottom-3 z-10`}>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Total da nota · {itens.length} {itens.length === 1 ? 'item' : 'itens'}
          </div>
          <div className="text-2xl font-extrabold text-brand-950">{brl(total)}</div>
        </div>
        <button ref={emitirRef} className={`${btnPrimary} px-6 py-3 focus:ring-4 focus:ring-brand-500/40 outline-none`} onClick={emitir} disabled={busy || !cliente || !itens.length}>
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
          {busy ? 'Enviando para a SEFAZ…' : corrigindo ? `Reenviar nota ${corrigindo.numero}` : `Emitir nota nº ${config.proximo_numero}`}
        </button>
      </div>

      {resultado && resultado.situacao !== 'autorizada' && (
        <div className={`${card} p-5 border-flame-200`}>
          <div className="flex items-center gap-2 mb-1">
            <Badge situacao={resultado.situacao} /> <span className="font-extrabold text-brand-950">Nota nº {resultado.numero}</span>
          </div>
          <p className="text-sm text-slate-600">{resultado.motivo}</p>
          {resultado.situacao === 'pendente' && (
            <p className="text-xs text-slate-500 mt-2">A SEFAZ não respondeu a tempo. Abra a nota na lista e clique em "Consultar SEFAZ" — nunca emita de novo antes de consultar.</p>
          )}
          {resultado.situacao === 'rejeitada' && <p className="text-xs text-slate-500 mt-2">Corrija o que a SEFAZ apontou e clique em reenviar: o número é o mesmo.</p>}
        </div>
      )}

      {novoProduto && (
        <Modal title="Novo produto" onClose={() => setNovoProduto(null)} wide>
          <ProdutoForm
            produto={novoProduto}
            onError={onError}
            onCancel={() => setNovoProduto(null)}
            onSaved={(p) => {
              setNovoProduto(null);
              carregarProdutos();
              addProduto(p);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Detalhe da nota */

function NotaModal({ id, onClose, onChanged, onCorrigir, onCopiar, onError, toast }) {
  const [nota, setNota] = useState(null);
  const [acao, setAcao] = useState('');
  const [texto, setTexto] = useState('');
  const [fone, setFone] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(
    () =>
      nfeApi
        .nota(id)
        .then((n) => {
          setNota(n);
          setFone((f) => f || n.cliente_telefone || '');
        })
        .catch((e) => onError(e.message, e)),
    [id, onError]
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (nome, fn, ok) => {
    setBusy(nome);
    try {
      const r = await fn();
      if (ok) toast(ok, 'success');
      return r;
    } catch (err) {
      onError(err.message, err);
      return null;
    } finally {
      setBusy('');
    }
  };

  if (!nota) {
    return (
      <Modal title="Nota fiscal" onClose={onClose}>
        <LoaderCircle className="animate-spin mx-auto text-slate-400" />
      </Modal>
    );
  }

  const autorizada = nota.situacao === 'autorizada';
  const temXml = ['autorizada', 'cancelada'].includes(nota.situacao) || nota.origem === 'cnk';
  const nomeArq = `NFe-${String(nota.numero).padStart(6, '0')}`;

  return (
    <Modal title={`NF-e nº ${nota.numero} · série ${nota.serie}${nota.ambiente === 2 ? ' · homologação' : ''}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge situacao={nota.situacao} />
            <span className="text-2xl font-extrabold text-brand-950">{brl(nota.valor_total)}</span>
          </div>
          <div className="mt-3 text-sm">
            <div className="font-bold text-brand-950">{nota.cliente_nome}</div>
            <div className="text-slate-500">{fmtDoc(nota.cliente_doc)} · {nota.cliente_uf} · emitida em {fmtData(nota.dh_emissao)}</div>
            {nota.chave && <div className="mt-2 font-mono text-[11px] text-slate-500 break-all">Chave: {fmtChave(nota.chave)}</div>}
            {nota.protocolo && <div className="font-mono text-[11px] text-slate-500">Protocolo: {nota.protocolo}</div>}
            {nota.motivo && nota.situacao !== 'autorizada' && <div className="mt-2 text-sm font-semibold text-flame-700">{nota.c_stat ? `${nota.c_stat} · ` : ''}{nota.motivo}</div>}
            {nota.origem === 'cnk' && <div className="mt-2 text-xs font-semibold text-slate-400">Importada do C&K</div>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {temXml && (
            <>
              <button className={btnGhost} disabled={busy} onClick={() => run('pdf', async () => {
                const janela = window.open('', '_blank');
                try {
                  abrirBlob(await nfeApi.danfe(id), null, janela);
                } catch (err) {
                  janela?.close();
                  throw err;
                }
              })}>
                {busy === 'pdf' ? <LoaderCircle size={15} className="animate-spin" /> : <FileText size={15} />} Ver PDF
              </button>
              <button className={btnGhost} disabled={busy} onClick={() => run('pdfd', async () => abrirBlob(await nfeApi.danfe(id), `${nomeArq}.pdf`))}>
                <FileDown size={15} /> Baixar PDF
              </button>
              <button className={btnGhost} disabled={busy} onClick={() => run('xml', async () => abrirBlob(await nfeApi.xml(id), `${nota.chave}.xml`))}>
                <Download size={15} /> XML
              </button>
              <button className={btnGhost} onClick={() => setAcao(acao === 'zap' ? '' : 'zap')}>
                <MessageCircle size={15} /> WhatsApp
              </button>
            </>
          )}
          {['pendente', 'enviando'].includes(nota.situacao) && (
            <button className={btnPrimary} disabled={busy} onClick={() => run('cons', async () => {
              const r = await nfeApi.consultar(id);
              setNota(r.nota);
              onChanged();
              toast(`SEFAZ: ${r.consulta.xMotivo}`, 'info');
            })}>
              {busy === 'cons' ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />} Consultar SEFAZ
            </button>
          )}
          {nota.situacao === 'rejeitada' && (
            <button className={btnPrimary} onClick={() => onCorrigir(nota)}>
              <PenLine size={15} /> Corrigir e reenviar
            </button>
          )}
          {['autorizada', 'cancelada'].includes(nota.situacao) && (
            <button className={btnGhost} disabled={busy} onClick={() => run('copia', () => onCopiar(nota))}>
              {busy === 'copia' ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />} Emitir outra igual
            </button>
          )}
          {autorizada && nota.origem !== 'cnk' && (
            <>
              <button className={btnGhost} onClick={() => setAcao(acao === 'cce' ? '' : 'cce')}>
                <PenLine size={15} /> Carta de correção
              </button>
              <button className={`${btnGhost} hover:!border-flame-500 hover:!text-flame-600`} onClick={() => setAcao(acao === 'cancelar' ? '' : 'cancelar')}>
                <Ban size={15} /> Cancelar nota
              </button>
            </>
          )}
        </div>

        {acao === 'zap' && (
          <div className={`${card} p-4 flex gap-2 items-end`}>
            <div className="flex-1">
              <label className={label}>WhatsApp do cliente</label>
              <input className={input} value={fone} onChange={(e) => setFone(e.target.value)} placeholder="(51) 99999-9999" />
            </div>
            <button className={btnPrimary} disabled={busy || !digits(fone)} onClick={() => run('zap', () => nfeApi.whatsapp(id, fone), 'PDF e XML enviados no WhatsApp.')}>
              {busy === 'zap' ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />} Enviar
            </button>
          </div>
        )}
        {(acao === 'cce' || acao === 'cancelar') && (
          <div className={`${card} p-4 space-y-2`}>
            <label className={label}>{acao === 'cce' ? 'O que está sendo corrigido' : 'Motivo do cancelamento'} (mín. 15 letras)</label>
            <textarea className={`${input} min-h-[80px]`} value={texto} onChange={(e) => setTexto(e.target.value)} />
            {acao === 'cce' && (
              <p className="text-[11px] text-slate-500">
                A carta de correção não pode mudar valores, quantidades, impostos, o cliente ou a data. Para isso, cancele e emita outra.
              </p>
            )}
            {acao === 'cancelar' && <p className="text-[11px] text-slate-500">Na SEFAZ RS o cancelamento é aceito em até 24 horas depois da autorização.</p>}
            <div className="flex justify-end">
              <button
                className={acao === 'cancelar' ? btnDanger : btnPrimary}
                disabled={busy || texto.trim().length < 15}
                onClick={async () => {
                  if (acao === 'cancelar' && !confirm(`Cancelar a nota nº ${nota.numero}? Não dá para desfazer.`)) return;
                  const r = await run(acao, () => (acao === 'cce' ? nfeApi.cce(id, texto) : nfeApi.cancelar(id, texto)), acao === 'cce' ? 'Carta de correção registrada.' : 'Nota cancelada na SEFAZ.');
                  if (r) {
                    setNota(r);
                    setAcao('');
                    setTexto('');
                    onChanged();
                  }
                }}
              >
                {busy === acao && <LoaderCircle size={15} className="animate-spin" />} {acao === 'cce' ? 'Enviar carta de correção' : 'Cancelar na SEFAZ'}
              </button>
            </div>
          </div>
        )}

        {nota.eventos?.length > 0 && (
          <div className={`${card} p-4`}>
            <h3 className={label}>Eventos</h3>
            {nota.eventos.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 py-2 border-b border-black/5 last:border-0 text-sm">
                <div>
                  <div className="font-bold text-brand-950">{e.tipo === 'cce' ? `Carta de correção ${e.seq}` : 'Cancelamento'} · {fmtData(e.created_at)}</div>
                  <div className="text-xs text-slate-500">{e.texto}</div>
                  <div className="text-xs text-slate-400">{e.c_stat} · {e.motivo}{e.created_by ? ` · por ${e.created_by}` : ''}</div>
                </div>
                {e.protocolo && (
                  <button className="text-xs font-bold text-brand-700 hover:underline" onClick={() => run('ev', async () => abrirBlob(await nfeApi.eventoXml(e.id), `evento-${e.id}.xml`))}>
                    XML
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Lista */

function Lista({ config, onAbrir, onNova, refreshKey, onError }) {
  const [notas, setNotas] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState('');
  const [mes, setMes] = useState('');
  const [ambiente, setAmbiente] = useState(String(config.ambiente));
  const pedidoNotas = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const meu = ++pedidoNotas.current;
      nfeApi
        .notas({ q: busca, situacao, mes, ambiente, limit: 200 })
        .then((l) => meu === pedidoNotas.current && setNotas(l))
        .catch((e) => onError(e.message, e));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, situacao, mes, ambiente, refreshKey, onError]);
  useEffect(() => {
    nfeApi.resumo().then(setResumo).catch(() => {});
  }, [refreshKey]);

  const mesKey = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const mesAtual = resumo?.meses?.find((m) => m.mes === mesKey);
  const pend = resumo?.pendencias || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`${card} p-4`}>
          <div className={label}>Notas no mês</div>
          <div className="text-2xl font-extrabold text-brand-950">{mesAtual?.qtd ?? 0}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={label}>Faturado em notas</div>
          <div className="text-2xl font-extrabold text-brand-950">{brl(mesAtual?.total || 0)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={label}>Próximo número</div>
          <div className="text-2xl font-extrabold text-brand-950">{config.proximo_numero} <span className="text-xs text-slate-400">série {config.serie}</span></div>
        </div>
        <div
          className={`${card} p-4 ${pend.pendente || pend.rejeitada ? 'ring-2 ring-sun-300 cursor-pointer' : ''}`}
          onClick={() => (pend.pendente || pend.enviando ? setSituacao('pendente') : pend.rejeitada ? setSituacao('rejeitada') : null)}
        >
          <div className={label}>Precisam de atenção</div>
          <div className="text-2xl font-extrabold text-brand-950">{(pend.pendente || 0) + (pend.rejeitada || 0) + (pend.enviando || 0)}</div>
        </div>
      </div>

      <div className={`${card} p-4 flex flex-wrap gap-2`}>
        <button className={btnPrimary} onClick={onNova}>
          <Plus size={15} /> Nova nota
        </button>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${input} pl-9`} placeholder="Número, cliente, CPF/CNPJ ou chave" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <select className={inputAuto} value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="">Todas</option>
          {Object.entries(SITUACAO).map(([k, v]) => (
            <option key={k} value={k}>{v.txt}</option>
          ))}
        </select>
        <input type="month" className={inputAuto} value={mes} onChange={(e) => setMes(e.target.value)} />
        <select className={inputAuto} value={ambiente} onChange={(e) => setAmbiente(e.target.value)}>
          <option value="1">Produção</option>
          <option value="2">Homologação</option>
        </select>
      </div>

      <div className={`${card} overflow-hidden`}>
        {!notas ? (
          <div className="p-10 flex justify-center"><LoaderCircle className="animate-spin text-slate-400" /></div>
        ) : !notas.length ? (
          <div className="p-10 text-center text-sm text-slate-400">Nenhuma nota aqui ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-extrabold uppercase tracking-widest text-slate-400 border-b border-black/5">
                  <th className="px-4 py-3">Nº</th>
                  <th className="px-4 py-3">Emissão</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.id} onClick={() => onAbrir(n.id)} className="border-b border-black/5 last:border-0 hover:bg-brand-50/50 cursor-pointer">
                    <td className="px-4 py-3 font-extrabold text-brand-950">{n.numero}<span className="text-[10px] text-slate-400 font-bold"> /{n.serie}</span></td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtData(n.dh_emissao)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-brand-950 truncate max-w-[280px]">{n.cliente_nome}</div>
                      <div className="text-[11px] text-slate-400">{fmtDoc(n.cliente_doc)} · {n.cliente_uf}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{brl(n.valor_total)}</td>
                    <td className="px-4 py-3"><Badge situacao={n.situacao} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Cadastros */

function Clientes({ onError }) {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState(null);
  const [editando, setEditando] = useState(undefined);
  const pedido = useRef(0);
  const load = useCallback(() => {
    const meu = ++pedido.current;
    return nfeApi
      .clientes(busca)
      .then((l) => meu === pedido.current && setLista(l))
      .catch((e) => onError(e.message, e));
  }, [busca, onError]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${input} pl-9`} placeholder="Buscar por nome ou CPF/CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <button className={btnPrimary} onClick={() => setEditando(null)}><Plus size={15} /> Novo cliente</button>
      </div>
      <div className={`${card} divide-y divide-black/5`}>
        {(lista || []).map((c) => (
          <button key={c.id} onClick={() => setEditando(c)} className="w-full text-left px-5 py-3 hover:bg-brand-50/50">
            <div className="font-bold text-brand-950">{c.nome}</div>
            <div className="text-xs text-slate-500">
              {fmtDoc(c.documento)} · {c.municipio} - {c.uf}
              {c.ie ? ` · IE ${c.ie}` : ''}
              {c.telefone ? ` · ${c.telefone}` : ''}
              {c.origem === 'cnk' ? ' · do C&K' : ''}
            </div>
          </button>
        ))}
        {lista && !lista.length && <div className="p-8 text-center text-sm text-slate-400">Nenhum cliente encontrado.</div>}
      </div>
      {editando !== undefined && (
        <Modal title={editando ? editando.nome : 'Novo cliente'} onClose={() => setEditando(undefined)} wide>
          <ClienteForm cliente={editando} onError={onError} onCancel={() => setEditando(undefined)} onSaved={() => { setEditando(undefined); load(); }} />
        </Modal>
      )}
    </div>
  );
}

const produtoVazio = { codigo: '', descricao: '', ncm: '', cfop_dentro: '5101', cfop_fora: '6101', unidade: 'UND', valor: '', cest: '', origem: '0', csosn: '102', aliq_tributos: '', ativo: 1 };

function ProdutoForm({ produto, onSaved, onCancel, onError }) {
  const [f, setF] = useState(() => ({
    ...produtoVazio,
    ...(produto || {}),
    valor: produto?.valor ? String(produto.valor).replace('.', ',') : '',
    aliq_tributos: produto?.aliq_tributos ? String(produto.aliq_tributos).replace('.', ',') : ''
  }));
  const [busy, setBusy] = useState(false);
  const [ncmInfo, setNcmInfo] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value }));
  const descRef = useRef(null);
  useEffect(() => {
    descRef.current?.focus();
  }, []);

  // Confere o NCM na tabela oficial (BrasilAPI) e mostra a descrição.
  const conferirNcm = useCallback(async (ncm) => {
    const d = digits(ncm);
    if (d.length !== 8) return setNcmInfo(d ? { erro: 'O NCM tem 8 números.' } : null);
    try {
      const r = await fetch(`https://brasilapi.com.br/api/ncm/v1/${d}`);
      setNcmInfo(r.ok ? { ok: (await r.json()).descricao } : { erro: 'Este NCM não existe na tabela oficial.' });
    } catch {
      setNcmInfo(null);
    }
  }, []);
  useEffect(() => {
    if (produto?.ncm) conferirNcm(produto.ncm);
  }, [produto, conferirNcm]);

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await nfeApi.saveProduto(produto?.id, { ...f, ncm: digits(f.ncm), valor: num(f.valor), aliq_tributos: num(f.aliq_tributos) }));
    } catch (err) {
      onError(err.message, err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-6 gap-3" onKeyDown={avancarComEnter}>
      <div className="col-span-6 sm:col-span-4">
        <label className={label}>Descrição *</label>
        <input ref={descRef} className={input} value={f.descricao} onChange={set('descricao')} placeholder="ex.: PLACA AÇO TAM 12X17CM C/ EST" />
      </div>
      <div className="col-span-6 sm:col-span-2">
        <label className={label}>Código</label>
        <input className={input} value={f.codigo || ''} onChange={set('codigo')} placeholder="opcional" />
      </div>
      <div className="col-span-3 sm:col-span-2">
        <label className={label}>NCM *</label>
        <input className={input} value={f.ncm} onChange={set('ncm')} onBlur={() => conferirNcm(f.ncm)} placeholder="8310.00.00" inputMode="numeric" />
      </div>
      <div className="col-span-3 sm:col-span-2">
        <label className={label}>Unidade</label>
        <select className={input} value={f.unidade} onChange={set('unidade')}>
          {['UND', 'UN', 'PC', 'CJ', 'KIT', 'PAR', 'CX', 'M', 'M2'].concat([f.unidade]).filter((v, i, a) => v && a.indexOf(v) === i).map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>
      <div className="col-span-6 sm:col-span-2">
        <label className={label}>Preço padrão</label>
        <input className={input} value={f.valor} onChange={set('valor')} inputMode="decimal" placeholder="0,00" />
      </div>
      {ncmInfo && (
        <div className={`col-span-6 rounded-xl px-3 py-2 text-xs font-semibold ${ncmInfo.ok ? 'bg-brand-50 text-brand-800' : 'bg-flame-50 text-flame-700'}`}>
          {ncmInfo.ok ? `NCM: ${ncmInfo.ok}` : ncmInfo.erro}
        </div>
      )}
      <div className="col-span-6 sm:col-span-3">
        <label className={label}>Tipo de venda (CFOP)</label>
        <select className={input} value={f.cfop_dentro} onChange={(e) => setF((p) => ({ ...p, cfop_dentro: e.target.value, cfop_fora: '6' + e.target.value.slice(1) }))}>
          <option value="5101">Fabricado pela Classul · 5101 / 6101</option>
          <option value="5102">Comprado pronto (revenda) · 5102 / 6102</option>
          {!['5101', '5102'].includes(f.cfop_dentro) && <option value={f.cfop_dentro}>{f.cfop_dentro} / {f.cfop_fora}</option>}
        </select>
      </div>
      <div className="col-span-3 sm:col-span-1">
        <label className={label}>% tributos</label>
        <input className={input} value={f.aliq_tributos} onChange={set('aliq_tributos')} placeholder="0" inputMode="decimal" title="Valor aproximado dos tributos (Lei 12.741)" />
      </div>
      <div className="col-span-3 sm:col-span-2">
        <label className={label}>CSOSN</label>
        <select className={input} value={f.csosn} onChange={set('csosn')}>
          <option value="102">102 · Simples, sem crédito</option>
          <option value="103">103 · isenção</option>
          <option value="400">400 · não tributada</option>
        </select>
      </div>
      <div className="col-span-3 sm:col-span-2">
        <label className={label}>CEST (se tiver)</label>
        <input className={input} value={f.cest || ''} onChange={set('cest')} inputMode="numeric" />
      </div>
      <label className="col-span-3 sm:col-span-2 flex items-center gap-2 text-sm font-semibold text-slate-600 mt-5">
        <input type="checkbox" checked={Boolean(f.ativo)} onChange={set('ativo')} /> Ativo (aparece na emissão)
      </label>
      <div className="col-span-6 flex justify-between items-center gap-2 mt-2">
        <span className="text-[11px] text-slate-400">Enter passa para o próximo campo.</span>
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={onCancel}>Cancelar</button>
          <button type="button" data-enter className={`${btnPrimary} focus:ring-4 focus:ring-brand-500/40 outline-none`} onClick={save} disabled={busy}>
            {busy && <LoaderCircle size={15} className="animate-spin" />} Salvar produto
          </button>
        </div>
      </div>
    </div>
  );
}

function Produtos({ onError }) {
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState('');
  const visiveis = useMemo(() => (lista ? (busca ? buscarProdutos(lista, busca, 200) : lista) : []), [lista, busca]);
  const [editando, setEditando] = useState(undefined);
  const load = useCallback(() => nfeApi.produtos().then(setLista).catch((e) => onError(e.message, e)), [onError]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${input} pl-9`} placeholder='Buscar: "12x17", "estojo", código…' value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <button className={btnPrimary} onClick={() => setEditando(null)}><Plus size={15} /> Novo produto</button>
      </div>
      <p className="text-xs font-semibold text-slate-500">NCM e CFOP saem daqui em toda nota. Os mais vendidos aparecem primeiro na emissão.</p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-extrabold uppercase tracking-widest text-slate-400 border-b border-black/5">
              <th className="px-4 py-3">Código</th><th className="px-4 py-3">Descrição</th><th className="px-4 py-3">NCM</th><th className="px-4 py-3">CFOP</th><th className="px-4 py-3 text-right">Preço</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => (
              <tr key={p.id} onClick={() => setEditando(p)} className={`border-b border-black/5 last:border-0 hover:bg-brand-50/50 cursor-pointer ${p.ativo ? '' : 'opacity-40'}`}>
                <td className="px-4 py-2.5 font-mono text-xs">{p.codigo}</td>
                <td className="px-4 py-2.5 font-semibold text-brand-950">
                  {p.descricao}
                  {p.uso > 0 && <span className="ml-2 text-[10px] font-bold text-slate-400">saiu {p.uso}×</span>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.ncm}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.cfop_dentro}/{p.cfop_fora}</td>
                <td className="px-4 py-2.5 text-right">{brl(p.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista && !lista.length && <div className="p-8 text-center text-sm text-slate-400">Nenhum produto. Importe do C&K em Configurar ou cadastre aqui.</div>}
      </div>
      {editando !== undefined && (
        <Modal title={editando ? editando.descricao : 'Novo produto'} onClose={() => setEditando(undefined)} wide>
          <ProdutoForm produto={editando} onError={onError} onCancel={() => setEditando(undefined)} onSaved={() => { setEditando(undefined); load(); }} />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Logo do DANFE */

function LogoConfig({ config, onSaved, onError, toast }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => {
    let u = '';
    if (config.logo === 'nenhuma') {
      setUrl('');
      return undefined;
    }
    nfeApi
      .logo()
      .then((b) => {
        u = URL.createObjectURL(b);
        setUrl(u);
      })
      .catch(() => setUrl(''));
    return () => u && URL.revokeObjectURL(u);
  }, [config.logo]);

  const salvar = async (imagem, msg) => {
    setBusy(true);
    try {
      await nfeApi.saveLogo(imagem);
      toast(msg, 'success');
      onSaved();
    } catch (err) {
      onError(err.message, err);
    } finally {
      setBusy(false);
    }
  };
  const enviar = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (!/image\/(png|jpeg)/.test(file.type)) return onError('Use uma imagem PNG ou JPG.');
    const dataUrl = await new Promise((ok, erro) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = erro;
      r.readAsDataURL(file);
    });
    await salvar(dataUrl, 'Logo nova salva. Ela já sai nos PDFs das notas.');
    fileRef.current.value = '';
  };

  return (
    <section className={`${card} p-5 space-y-3`}>
      <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><FileText size={17} /> Logo no PDF da nota</h3>
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 rounded-2xl bg-white border border-black/10 flex items-center justify-center overflow-hidden shrink-0">
          {url ? <img src={url} alt="Logo do DANFE" className="max-w-full max-h-full object-contain" /> : <span className="text-[11px] text-slate-400">sem logo</span>}
        </div>
        <p className="text-sm text-slate-500">
          {config.logo === 'padrao' && 'Usando o carimbo da Classul, o mesmo das notas do C&K.'}
          {config.logo === 'propria' && 'Usando a logo que você enviou.'}
          {config.logo === 'nenhuma' && 'O PDF sai sem logo.'} Vale para todas as notas, inclusive as antigas.
        </p>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="text-sm" onChange={enviar} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        {config.logo !== 'padrao' && (
          <button className={btnGhost} disabled={busy} onClick={() => salvar('padrao', 'Voltou para o carimbo da Classul.')}>Usar o carimbo da Classul</button>
        )}
        {config.logo !== 'nenhuma' && (
          <button className={btnGhost} disabled={busy} onClick={() => salvar('nenhuma', 'O PDF vai sair sem logo.')}>Tirar a logo</button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Configurar */

function Configurar({ config, onSaved, onError, toast }) {
  const [busy, setBusy] = useState('');
  const [senha, setSenha] = useState('');
  const fileRef = useRef(null);
  const importRef = useRef(null);
  const [serie, setSerie] = useState(String(config.serie));
  const [proximo, setProximo] = useState(String(config.proximo_numero));
  const [infCpl, setInfCpl] = useState(config.inf_cpl);
  const [pag, setPag] = useState(config.pagamento_padrao);
  const [sefaz, setSefaz] = useState(null);
  const [inut, setInut] = useState({ serie: String(config.serie), inicio: '', fim: '', justificativa: '' });
  const [chave, setChave] = useState('');
  const [consulta, setConsulta] = useState(null);
  const [progresso, setProgresso] = useState('');
  const [pins, setPins] = useState({ atual: '', novo: '' });

  const run = async (nome, fn) => {
    setBusy(nome);
    try {
      return await fn();
    } catch (err) {
      onError(err.message, err);
      return null;
    } finally {
      setBusy('');
    }
  };

  const enviarCert = () =>
    run('cert', async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('Escolha o arquivo .pfx.');
      if (!senha) throw new Error('Digite a senha do certificado.');
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const info = await nfeApi.saveCert(btoa(bin), senha);
      setSenha('');
      fileRef.current.value = '';
      toast(`Certificado de ${info.nome} salvo.`, 'success');
      onSaved();
    });

  const trocarAmbiente = (amb) =>
    run('amb', async () => {
      if (amb === 1 && !confirm('Mudar para PRODUÇÃO? A partir daí as notas emitidas valem de verdade.')) return;
      await nfeApi.saveConfig({ ambiente: amb });
      toast(amb === 1 ? 'Agora emitindo em produção.' : 'Agora em homologação (teste).', 'success');
      onSaved();
    });

  const importar = () =>
    run('imp', async () => {
      const file = importRef.current?.files?.[0];
      if (!file) throw new Error('Escolha o arquivo classul-importacao-cnk.json.');
      const dados = JSON.parse(await file.text());
      const total = { clientes: 0, produtos: 0, notas: 0, ignoradas: 0 };
      const somar = (r) => Object.keys(total).forEach((k) => (total[k] += r[k] || 0));
      const lotes = [];
      for (let i = 0; i < (dados.clientes || []).length; i += 150) lotes.push({ clientes: dados.clientes.slice(i, i + 150) });
      lotes.push({ produtos: dados.produtos || [] });
      for (let i = 0; i < (dados.notas || []).length; i += 120) lotes.push({ notas: dados.notas.slice(i, i + 120), canceladas: dados.canceladas || [] });
      for (let i = 0; i < lotes.length; i++) {
        setProgresso(`Importando… ${Math.round(((i + 1) / lotes.length) * 100)}%`);
        somar(await nfeApi.importar(lotes[i]));
      }
      setProgresso(`Importados: ${total.clientes} clientes, ${total.produtos} produtos, ${total.notas} notas${total.ignoradas ? ` (${total.ignoradas} ignorados por dados incompletos)` : ''}.`);
      importRef.current.value = '';
      onSaved();
    });

  const amb = config.ambiente;
  const c = config.cert;
  const vence = c ? Math.ceil((new Date(c.valido_ate) - Date.now()) / 864e5) : null;

  return (
    <div className="grid lg:grid-cols-2 gap-4 max-w-5xl">
      <section className={`${card} p-5 space-y-3`}>
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><KeyRound size={17} /> Certificado digital A1</h3>
        {c ? (
          <div className={`rounded-2xl px-4 py-3 text-sm ${vence < 30 ? 'bg-flame-50 text-flame-700' : 'bg-brand-50 text-brand-800'}`}>
            <div className="font-bold">{c.nome}</div>
            <div className="text-xs">CNPJ {fmtDoc(c.cnpj)} · {c.emissor}</div>
            <div className="text-xs font-bold mt-1">Válido até {new Date(c.valido_ate).toLocaleDateString('pt-BR')} ({vence} dias)</div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhum certificado ainda. Envie o arquivo <b>.pfx</b> e a senha. Ele fica guardado criptografado no servidor.</p>
        )}
        <input ref={fileRef} type="file" accept=".pfx,.p12" className="text-sm" />
        <input type="password" className={input} placeholder="Senha do certificado" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
        <button className={btnPrimary} onClick={enviarCert} disabled={busy === 'cert'}>
          {busy === 'cert' ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />} {c ? 'Trocar certificado' : 'Enviar certificado'}
        </button>
      </section>

      <section className={`${card} p-5 space-y-3`}>
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><Settings2 size={17} /> Ambiente e numeração</h3>
        <div className="flex gap-2">
          <button className={amb === 2 ? btnPrimary : btnGhost} onClick={() => trocarAmbiente(2)} disabled={busy === 'amb'}>Homologação (teste)</button>
          <button className={amb === 1 ? btnDanger : btnGhost} onClick={() => trocarAmbiente(1)} disabled={busy === 'amb'}>Produção</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Série</label><input className={input} value={serie} onChange={(e) => setSerie(e.target.value)} /></div>
          <div><label className={label}>Próximo número</label><input className={input} value={proximo} onChange={(e) => setProximo(e.target.value)} /></div>
        </div>
        <p className="text-[11px] text-slate-500">O C&K usa a série 1. Usando a série 2 aqui, os dois nunca repetem número.</p>
        <button className={btnGhost} disabled={busy === 'num'} onClick={() => run('num', async () => {
          if (String(config.serie) !== serie) await nfeApi.saveConfig({ serie: Number(serie) });
          await nfeApi.saveConfig({ proximo_numero: Number(proximo) });
          toast('Numeração salva.', 'success');
          onSaved();
        })}>Salvar numeração</button>
        <div className="flex items-center gap-2 pt-2 border-t border-black/5">
          <button className={btnGhost} disabled={busy === 'sefaz' || !c} onClick={() => run('sefaz', async () => setSefaz(await nfeApi.sefazStatus()))}>
            {busy === 'sefaz' ? <LoaderCircle size={15} className="animate-spin" /> : <Wifi size={15} />} Testar SEFAZ
          </button>
          {sefaz && <span className={`text-sm font-bold ${sefaz.online ? 'text-brand-700' : 'text-flame-600'}`}>{sefaz.cStat} · {sefaz.xMotivo}</span>}
        </div>
      </section>

      <section className={`${card} p-5 space-y-3`}>
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><FileText size={17} /> Padrões da nota</h3>
        <div>
          <label className={label}>Forma de pagamento padrão</label>
          <select className={input} value={pag} onChange={(e) => setPag(e.target.value)}>
            {(config.formas_pagamento || []).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Informações complementares padrão</label>
          <textarea className={`${input} min-h-[80px]`} value={infCpl} onChange={(e) => setInfCpl(e.target.value)} />
        </div>
        <div className="text-[11px] text-slate-500">
          Emitente: {config.emitente.razao_social} · IE {config.emitente.ie} · {config.emitente.logradouro}, {config.emitente.numero} - {config.emitente.municipio}/{config.emitente.uf}
        </div>
        <button className={btnGhost} disabled={busy === 'pad'} onClick={() => run('pad', async () => {
          await nfeApi.saveConfig({ inf_cpl: infCpl, pagamento_padrao: pag });
          toast('Padrões salvos.', 'success');
          onSaved();
        })}>Salvar padrões</button>
      </section>

      <LogoConfig config={config} onSaved={onSaved} onError={onError} toast={toast} />

      <section className={`${card} p-5 space-y-3`}>
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><Upload size={17} /> Importar do C&K</h3>
        <p className="text-sm text-slate-500">Escolha o arquivo <b>classul-importacao-cnk.json</b> (clientes, produtos e o histórico de notas). Pode importar de novo depois: nada é duplicado.</p>
        <input ref={importRef} type="file" accept=".json" className="text-sm" />
        <button className={btnPrimary} onClick={importar} disabled={busy === 'imp'}>
          {busy === 'imp' ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />} Importar
        </button>
        {progresso && <p className="text-sm font-semibold text-brand-700">{progresso}</p>}
      </section>

      <section className={`${card} p-5 space-y-3`}>
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><FileSearch size={17} /> Consultar uma chave na SEFAZ</h3>
        <p className="text-sm text-slate-500">Serve para as notas que ficaram "ENVIADA" no C&K: diz se a nota existe, foi cancelada ou nunca chegou.</p>
        <input className={input} value={chave} onChange={(e) => setChave(e.target.value)} placeholder="44 números da chave" />
        <button className={btnGhost} disabled={busy === 'chave' || digits(chave).length !== 44} onClick={() => run('chave', async () => setConsulta(await nfeApi.consultarChave(chave)))}>
          {busy === 'chave' ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />} Consultar
        </button>
        {consulta && (
          <div className="rounded-2xl bg-[#F7F8F3] px-4 py-3 text-sm">
            <div className="font-bold">Nota {consulta.numero} · série {consulta.serie}: <Badge situacao={consulta.situacao === 'inexistente' ? 'rejeitada' : consulta.situacao} /></div>
            <div className="text-xs text-slate-500 mt-1">{consulta.cStat} · {consulta.xMotivo}</div>
            {consulta.situacao === 'inexistente' && <div className="text-xs font-semibold text-flame-700 mt-1">Nunca foi autorizada: inutilize este número ao lado.</div>}
          </div>
        )}
      </section>

      <section className={`${card} p-5 space-y-3`}>
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><Hash size={17} /> Inutilizar números</h3>
        <p className="text-sm text-slate-500">Para números que foram pulados e nunca viraram nota. A SEFAZ exige que eles sejam inutilizados.</p>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={label}>Série</label><input className={input} value={inut.serie} onChange={(e) => setInut({ ...inut, serie: e.target.value })} /></div>
          <div><label className={label}>Do nº</label><input className={input} value={inut.inicio} onChange={(e) => setInut({ ...inut, inicio: e.target.value })} /></div>
          <div><label className={label}>Até o nº</label><input className={input} value={inut.fim} onChange={(e) => setInut({ ...inut, fim: e.target.value })} placeholder="igual" /></div>
        </div>
        <input className={input} value={inut.justificativa} onChange={(e) => setInut({ ...inut, justificativa: e.target.value })} placeholder="Motivo (mín. 15 letras)" />
        <button className={btnDanger} disabled={busy === 'inut' || !inut.inicio || inut.justificativa.trim().length < 15} onClick={() => run('inut', async () => {
          const fim = inut.fim || inut.inicio;
          if (!confirm(`Inutilizar a série ${inut.serie}, números ${inut.inicio} a ${fim}? Não dá para desfazer.`)) return;
          const r = await nfeApi.inutilizar({ serie: Number(inut.serie), inicio: Number(inut.inicio), fim: Number(fim), justificativa: inut.justificativa });
          toast(`Inutilizado. Protocolo ${r.protocolo}.`, 'success');
          setInut({ ...inut, inicio: '', fim: '', justificativa: '' });
          onSaved();
        })}>
          {busy === 'inut' ? <LoaderCircle size={15} className="animate-spin" /> : <Ban size={15} />} Inutilizar
        </button>
      </section>

      <section className={`${card} p-5 space-y-3`}>
        <h3 className="font-extrabold text-brand-950 flex items-center gap-2"><Lock size={17} /> Trocar PIN</h3>
        <div className="grid grid-cols-2 gap-2">
          <input type="password" inputMode="numeric" className={input} placeholder="PIN atual" value={pins.atual} onChange={(e) => setPins({ ...pins, atual: e.target.value.replace(/\D/g, '') })} />
          <input type="password" inputMode="numeric" className={input} placeholder="Novo PIN" value={pins.novo} onChange={(e) => setPins({ ...pins, novo: e.target.value.replace(/\D/g, '') })} />
        </div>
        <button className={btnGhost} disabled={busy === 'pin' || pins.novo.length < 4} onClick={() => run('pin', async () => {
          const r = await nfeApi.setPin(pins.novo, pins.atual);
          setNfeToken(r.token);
          setPins({ atual: '', novo: '' });
          toast('PIN trocado.', 'success');
        })}>Trocar PIN</button>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Aba */

const SUBTABS = [
  { id: 'notas', label: 'Notas', Icon: FileText },
  { id: 'emitir', label: 'Emitir', Icon: Send },
  { id: 'clientes', label: 'Clientes', Icon: Users },
  { id: 'produtos', label: 'Produtos', Icon: Package },
  { id: 'config', label: 'Configurar', Icon: Settings2 }
];

export default function Notas({ onAuthError }) {
  const toast = useToast();
  const [gate, setGate] = useState('loading'); // loading | create | unlock | open
  const [config, setConfig] = useState(null);
  const [sub, setSub] = useState('notas');
  const [aberta, setAberta] = useState(null);
  const [inicial, setInicial] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const onError = useCallback(
    (msg, err) => {
      if (err && onAuthError(err)) return;
      if (err instanceof NfeLockError) {
        setNfeToken('');
        setGate('unlock');
        return;
      }
      toast(msg, 'error', 7000);
    },
    [onAuthError, toast]
  );

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await nfeApi.config());
      setGate('open');
    } catch (err) {
      if (err instanceof NfeLockError) {
        const s = await nfeApi.status().catch(() => ({ has_pin: true }));
        setGate(s.has_pin ? 'unlock' : 'create');
      } else onError(err.message, err);
    }
  }, [onError]);

  useEffect(() => {
    if (!getNfeToken()) {
      nfeApi.status().then((s) => setGate(s.has_pin ? 'unlock' : 'create')).catch((e) => onError(e.message, e));
    } else loadConfig();
  }, [loadConfig, onError]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    loadConfig();
  }, [loadConfig]);

  if (gate === 'loading') return <div className="h-full flex items-center justify-center"><LoaderCircle className="animate-spin text-slate-400" /></div>;
  if (gate === 'create' || gate === 'unlock') return <PinScreen mode={gate} onDone={loadConfig} toast={toast} />;
  if (!config) return null;

  const semCert = !config.has_cert;
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-brand-950">Notas fiscais</h1>
          <p className="text-xs font-semibold text-slate-400">
            NF-e emitida direto na SEFAZ RS · {config.ambiente === 1 ? <span className="text-flame-600">produção</span> : <span className="text-yellow-600">homologação (teste)</span>} · série {config.serie}
          </p>
        </div>
        <div className="flex gap-1 rounded-2xl bg-white border border-black/5 p-1 shadow-sm overflow-x-auto">
          {SUBTABS.map(({ id, label: l, Icon }) => (
            <button
              key={id}
              onClick={() => {
                setSub(id);
                if (id !== 'emitir') setInicial(null);
              }}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold whitespace-nowrap ${sub === id ? 'bg-brand-500/15 text-brand-700' : 'text-slate-500 hover:text-brand-900'}`}
            >
              <Icon size={15} /> {l}
            </button>
          ))}
        </div>
      </div>

      {semCert && sub !== 'config' && (
        <button onClick={() => setSub('config')} className="w-full text-left mb-4 rounded-2xl bg-sun-100 text-yellow-800 px-4 py-3 text-sm font-semibold">
          Falta o certificado digital. Clique aqui para enviar o arquivo .pfx em Configurar.
        </button>
      )}

      {sub === 'notas' && (
        <Lista
          config={config}
          onAbrir={setAberta}
          onNova={() => {
            setInicial(null);
            setSub('emitir');
          }}
          refreshKey={refreshKey}
          onError={onError}
        />
      )}
      {sub === 'emitir' && (
        <Emitir
          key={inicial ? `${inicial.tipo}-${inicial.nota?.id}` : 'nova'}
          config={config}
          inicial={inicial}
          onError={onError}
          toast={toast}
          onEmitida={(n) => {
            setInicial(null);
            refresh();
            setSub('notas');
            setAberta(n.id);
          }}
        />
      )}
      {sub === 'clientes' && <Clientes onError={onError} />}
      {sub === 'produtos' && <Produtos onError={onError} />}
      {sub === 'config' && <Configurar config={config} onSaved={refresh} onError={onError} toast={toast} />}

      {aberta && (
        <NotaModal
          id={aberta}
          onClose={() => setAberta(null)}
          onChanged={refresh}
          onError={onError}
          toast={toast}
          onCorrigir={(n) => {
            setAberta(null);
            setInicial({ tipo: 'corrigir', nota: n, itens: n.dados?.itens, pagamento: n.dados?.pagamento, frete: n.dados?.frete, inf_cpl: n.dados?.inf_cpl });
            setSub('emitir');
          }}
          onCopiar={async (n) => {
            const c = await nfeApi.copiaNota(n.id);
            setAberta(null);
            setInicial({ tipo: 'copiar', nota: n, ...c, inf_cpl: undefined });
            setSub('emitir');
          }}
        />
      )}
    </div>
  );
}
