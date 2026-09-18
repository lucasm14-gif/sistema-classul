import React, { useCallback, useEffect, useState } from 'react';
import {
  Server,
  KeyRound,
  Copy,
  RefreshCw,
  LoaderCircle,
  Wrench,
  ArrowDownLeft,
  ArrowUpRight,
  Radio,
  ChevronDown
} from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';

const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2';
const input =
  'w-full border-2 border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white';

const MOTORES = [
  { id: 'interno', titulo: 'Bot deste sistema', ajuda: 'A IA de pré-atendimento configurada aqui em cima.' },
  { id: 'hermes', titulo: 'Hermes (VPS)', ajuda: 'As mensagens vão para o Hermes, que responde pelas ferramentas.' },
  { id: 'off', titulo: 'Ninguém', ajuda: 'Nenhum bot responde — só atendimento humano.' }
];

export default function HermesSettings({ onAuthError }) {
  const [cfg, setCfg] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState('');
  const [showTools, setShowTools] = useState(false);
  const [url, setUrl] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const data = await api.hermesConfig();
      setCfg(data);
      setUrl(data.webhook_url || '');
      setEvents(await api.hermesEvents(20));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (!cfg) return null;

  const salvar = async (patch, aviso) => {
    setBusy('save');
    try {
      await api.hermesSaveConfig(patch);
      await load();
      if (aviso) toast(aviso, 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const copiar = async (texto, nome) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast(`${nome} copiado!`, 'success');
    } catch {
      toast('Não consegui copiar — selecione e copie na mão.', 'info');
    }
  };

  const trocarChave = async () => {
    if (!window.confirm('Gerar uma chave nova? O Hermes para de acessar o sistema até você colar a nova chave nele.'))
      return;
    setBusy('token');
    try {
      await api.hermesRotateToken();
      await load();
      toast('Chave nova gerada. Cole no Hermes.', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const testar = async () => {
    setBusy('test');
    try {
      const r = await api.hermesTest();
      if (r.sent) toast('O Hermes respondeu! Conexão funcionando. ✅', 'success');
      else toast(`O Hermes não respondeu: ${r.error || `HTTP ${r.status}`}`, 'error', 8000);
      setEvents(await api.hermesEvents(20));
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error', 8000);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="bg-white rounded-3xl shadow-sm border border-black/5 p-6 sm:p-7">
      <h3 className="font-extrabold tracking-tight text-brand-950 mb-1 flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
          <Server size={15} />
        </span>
        Hermes (bot na VPS)
        <button
          onClick={() => salvar({ enabled: !cfg.enabled }, cfg.enabled ? 'Conexão desligada.' : 'Conexão ligada!')}
          className={`ml-auto w-11 h-6 rounded-full transition-colors relative ${
            cfg.enabled ? 'bg-brand-500' : 'bg-slate-300'
          }`}
          title={cfg.enabled ? 'Ligado' : 'Desligado'}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
              cfg.enabled ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </h3>
      <p className="text-xs font-medium text-slate-400 mb-5">
        Dá ao Hermes controle do sistema: ele lê e cria pedidos, consulta clientes, manda WhatsApp e recebe um aviso
        sempre que algo muda aqui. Enquanto estiver desligado, a chave não vale para nada.
      </p>

      {/* Chave e endereços */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={label}>Chave do Hermes</label>
          <div className="flex gap-2">
            <input className={`${input} font-mono text-xs`} value={cfg.token} readOnly />
            <button
              onClick={() => copiar(cfg.token, 'Chave')}
              title="Copiar chave"
              className="shrink-0 px-3 rounded-xl border-2 border-slate-200 text-slate-500 hover:text-brand-700 hover:border-brand-400 transition-colors"
            >
              <Copy size={15} />
            </button>
            <button
              onClick={trocarChave}
              title="Gerar chave nova"
              className="shrink-0 px-3 rounded-xl border-2 border-slate-200 text-slate-500 hover:text-flame-600 hover:border-flame-400 transition-colors"
            >
              {busy === 'token' ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
          </div>
          <p className="text-[11px] font-medium text-slate-400 mt-1.5 flex items-center gap-1">
            <KeyRound size={11} /> O Hermes manda ela em <span className="font-mono">Authorization: Bearer …</span> — e o
            sistema assina os avisos com ela.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Endereço do sistema (para o Hermes chamar)</label>
          <div className="flex gap-2">
            <input className={`${input} font-mono text-xs`} value={cfg.endpoints.call} readOnly />
            <button
              onClick={() => copiar(cfg.base_url, 'Endereço')}
              title="Copiar endereço"
              className="shrink-0 px-3 rounded-xl border-2 border-slate-200 text-slate-500 hover:text-brand-700 hover:border-brand-400 transition-colors"
            >
              <Copy size={15} />
            </button>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Webhook do Hermes (para o sistema avisar ele)</label>
          <div className="flex gap-2">
            <input
              className={input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => url !== cfg.webhook_url && salvar({ webhook_url: url })}
              placeholder="https://seu-vps.com.br/classul/webhook"
            />
            <button
              onClick={testar}
              disabled={busy === 'test'}
              className="shrink-0 flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-extrabold px-5 rounded-xl transition-colors disabled:opacity-60"
            >
              {busy === 'test' ? <LoaderCircle size={15} className="animate-spin" /> : <Radio size={15} />}
              Testar
            </button>
          </div>
          <p className="text-[11px] font-medium text-slate-400 mt-1.5">
            URL que o Hermes expõe na VPS. É nela que chegam os avisos de pedido criado, mudança de etapa, lead novo e —
            se ele estiver no comando — as mensagens dos clientes.
          </p>
        </div>
      </div>

      {/* Quem responde o WhatsApp */}
      <div className="mt-5 pt-5 border-t border-black/5">
        <label className={label}>Quem faz o pré-atendimento no WhatsApp</label>
        <div className="grid sm:grid-cols-3 gap-2">
          {MOTORES.map((m) => (
            <button
              key={m.id}
              onClick={() => salvar({ engine: m.id }, `Pré-atendimento: ${m.titulo}.`)}
              className={`text-left p-3 rounded-2xl border-2 transition-colors ${
                cfg.engine === m.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-slate-200 hover:border-brand-300 bg-white'
              }`}
            >
              <span
                className={`block text-sm font-extrabold ${
                  cfg.engine === m.id ? 'text-brand-800' : 'text-slate-500'
                }`}
              >
                {m.titulo}
              </span>
              <span className="block text-[11px] font-medium text-slate-400 mt-0.5 leading-snug">{m.ajuda}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Ferramentas */}
      <div className="mt-5 pt-5 border-t border-black/5">
        <button
          onClick={() => setShowTools((v) => !v)}
          className="flex items-center gap-2 text-xs font-extrabold text-brand-700 hover:text-brand-900 transition-colors"
        >
          <Wrench size={13} />
          {cfg.tools.length} ferramentas que o Hermes pode usar
          <ChevronDown size={13} className={`transition-transform ${showTools ? 'rotate-180' : ''}`} />
        </button>
        {showTools && (
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            {cfg.tools.map((t) => (
              <div key={t.name} className="p-2.5 rounded-xl bg-black/[0.03]">
                <span className="block text-xs font-extrabold text-brand-900 font-mono">{t.name}</span>
                <span className="block text-[11px] font-medium text-slate-400 leading-snug mt-0.5">
                  {t.description}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Últimas trocas */}
      {events.length > 0 && (
        <div className="mt-5 pt-5 border-t border-black/5">
          <label className={label}>Últimas trocas com o Hermes</label>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-[11px] font-medium py-1.5 px-2 rounded-lg hover:bg-black/[0.03]">
                {e.direction === 'entrada' ? (
                  <ArrowDownLeft size={13} className="shrink-0 text-brand-600" />
                ) : (
                  <ArrowUpRight size={13} className="shrink-0 text-slate-400" />
                )}
                <span className={`font-mono font-bold ${e.ok ? 'text-brand-900' : 'text-flame-600'}`}>{e.name}</span>
                <span className="text-slate-400 truncate flex-1">{e.error || e.args || ''}</span>
                <span className="text-slate-300 shrink-0">
                  {new Date(e.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
