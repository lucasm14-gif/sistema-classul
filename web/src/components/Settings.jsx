import React, { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Save, Plug, Send, List } from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';

const label = 'block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2';
const input =
  'w-full border-2 border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white';

export default function Settings({ onAuthError }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [instances, setInstances] = useState(null);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [testNumber, setTestNumber] = useState('');
  const [testing, setTesting] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setForm(await api.getSettings());
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    }
  }, [onAuthError, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (!form) return <p className="p-6 text-sm font-medium text-slate-400">Carregando…</p>;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggle = (key) => () => setForm((f) => ({ ...f, [key]: f[key] === '1' ? '0' : '1' }));

  const save = async () => {
    setSaving(true);
    try {
      setForm(await api.saveSettings(form));
      toast('Configurações salvas!', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const listInstances = async () => {
    setLoadingInstances(true);
    setInstances(null);
    try {
      await api.saveSettings(form); // garante que URL/key digitadas sejam usadas
      const data = await api.listInstances();
      const arr = Array.isArray(data) ? data : data?.instances || [];
      const names = arr
        .map((i) => i?.name || i?.instanceName || i?.instance?.instanceName)
        .filter(Boolean);
      setInstances(names);
      if (!names.length) toast('Nenhuma instância encontrada nessa Evolution API.', 'info');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error', 8000);
    } finally {
      setLoadingInstances(false);
    }
  };

  const sendTest = async () => {
    if (!testNumber.trim()) {
      toast('Digite um número para o teste (ex: 5551999999999).', 'info');
      return;
    }
    setTesting(true);
    try {
      await api.saveSettings(form);
      await api.testMessage(testNumber);
      toast('Mensagem de teste enviada! Confira o WhatsApp. ✅', 'success');
    } catch (err) {
      if (!onAuthError(err)) toast(err.message, 'error', 8000);
    } finally {
      setTesting(false);
    }
  };

  const templateHelp = (
    <p className="text-[11px] font-medium text-slate-400 mt-1.5">
      Variáveis: {'{nome}'} {'{pedido}'} {'{produto}'} {'{valor}'} {'{entrega}'} {'{descricao}'}
    </p>
  );

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5 overflow-y-auto h-full animate-fade-up">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-brand-950">Configurações</h2>
        <p className="text-xs font-medium text-slate-400">Conexão com o WhatsApp e mensagens automáticas.</p>
      </div>

      {/* Evolution API */}
      <section className="bg-white rounded-3xl shadow-sm border border-black/5 p-6 sm:p-7">
        <h3 className="font-extrabold tracking-tight text-brand-950 mb-1 flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
            <Plug size={15} />
          </span>
          Conexão Evolution API
        </h3>
        <p className="text-xs font-medium text-slate-400 mb-5">
          Servidor que conecta o sistema ao seu WhatsApp. A instância precisa estar conectada (QR code
          escaneado) no painel da Evolution.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label}>URL do servidor</label>
            <input className={input} value={form.evolution_url} onChange={set('evolution_url')} placeholder="https://evolution.seudominio.com.br" />
          </div>
          <div>
            <label className={label}>API Key</label>
            <input className={input} value={form.evolution_apikey} onChange={set('evolution_apikey')} placeholder="Chave global ou da instância" />
          </div>
          <div>
            <label className={label}>Nome da instância</label>
            <input className={input} value={form.evolution_instance} onChange={set('evolution_instance')} placeholder="ex: classul" />
            <button
              onClick={listInstances}
              className="mt-2 flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:text-brand-900 transition-colors"
            >
              {loadingInstances ? <LoaderCircle size={13} className="animate-spin" /> : <List size={13} />}
              Listar instâncias disponíveis
            </button>
            {instances && instances.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {instances.map((name) => (
                  <button
                    key={name}
                    onClick={() => setForm((f) => ({ ...f, evolution_instance: name }))}
                    className={`text-xs font-bold px-3 py-1.5 rounded-full border-2 transition-colors ${
                      form.evolution_instance === name
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-brand-400'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 pt-5 border-t border-black/5 flex gap-2 items-end">
          <div className="flex-1">
            <label className={label}>Testar envio (seu número)</label>
            <input className={input} value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="5551999999999" />
          </div>
          <button
            onClick={sendTest}
            disabled={testing}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-extrabold px-5 py-2.5 rounded-full shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {testing ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
            Enviar teste
          </button>
        </div>
      </section>

      {/* Mensagens automáticas */}
      <section className="bg-white rounded-3xl shadow-sm border border-black/5 p-6 sm:p-7">
        <h3 className="font-extrabold tracking-tight text-brand-950 mb-5">Mensagens automáticas</h3>

        {[
          { key: 'pronto', title: 'Quando o pedido entra em "Pronto"' },
          { key: 'entregue', title: 'Quando o pedido entra em "Enviado / Entregue"' }
        ].map(({ key, title }) => (
          <div key={key} className="mb-6 last:mb-0">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-bold text-brand-950">{title}</label>
              <button
                onClick={toggle(`msg_${key}_enabled`)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  form[`msg_${key}_enabled`] === '1' ? 'bg-brand-500' : 'bg-slate-300'
                }`}
                title={form[`msg_${key}_enabled`] === '1' ? 'Ativado' : 'Desativado'}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                    form[`msg_${key}_enabled`] === '1' ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
            <textarea
              className={`${input} h-28 resize-none ${form[`msg_${key}_enabled`] !== '1' ? 'opacity-50' : ''}`}
              value={form[`msg_${key}_template`]}
              onChange={set(`msg_${key}_template`)}
            />
            {templateHelp}
          </div>
        ))}
      </section>

      <div className="flex justify-end pb-10">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-950 hover:bg-black text-white text-sm font-extrabold px-7 py-3 rounded-full shadow-lg transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
          Salvar configurações
        </button>
      </div>
    </div>
  );
}
