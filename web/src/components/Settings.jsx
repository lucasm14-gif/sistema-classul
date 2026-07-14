import React, { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Save, Plug, Send, List } from 'lucide-react';
import { api } from '../api';
import { useToast } from './Toast';

const label = 'block text-[11px] font-bold text-slate-500 uppercase mb-1.5';
const input =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

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

  if (!form) return <p className="p-6 text-sm text-slate-400">Carregando…</p>;

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
    <p className="text-[11px] text-slate-400 mt-1">
      Variáveis: {'{nome}'} {'{pedido}'} {'{produto}'} {'{valor}'} {'{entrega}'} {'{descricao}'}
    </p>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 overflow-y-auto h-full">
      {/* Evolution API */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="font-bold text-slate-800 mb-1 flex items-center gap-2">
          <Plug size={17} className="text-emerald-600" /> Conexão Evolution API
        </h2>
        <p className="text-xs text-slate-400 mb-4">
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
              className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
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
                    className={`text-xs px-2 py-1 rounded-lg border ${
                      form.evolution_instance === name
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:border-emerald-400'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 flex gap-2 items-end">
          <div className="flex-1">
            <label className={label}>Testar envio (seu número)</label>
            <input className={input} value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="5551999999999" />
          </div>
          <button
            onClick={sendTest}
            disabled={testing}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
          >
            {testing ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}
            Enviar teste
          </button>
        </div>
      </section>

      {/* Mensagens automáticas */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="font-bold text-slate-800 mb-4">Mensagens automáticas</h2>

        {[
          { key: 'pronto', title: 'Quando o pedido entra em "Pronto"' },
          { key: 'entregue', title: 'Quando o pedido entra em "Enviado / Entregue"' }
        ].map(({ key, title }) => (
          <div key={key} className="mb-5 last:mb-0">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-700">{title}</label>
              <button
                onClick={toggle(`msg_${key}_enabled`)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  form[`msg_${key}_enabled`] === '1' ? 'bg-emerald-500' : 'bg-slate-300'
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

      <div className="flex justify-end pb-8">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold px-6 py-2.5 rounded-lg disabled:opacity-60"
        >
          {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
          Salvar configurações
        </button>
      </div>
    </div>
  );
}
