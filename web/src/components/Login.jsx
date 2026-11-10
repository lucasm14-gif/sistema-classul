import React, { useState } from 'react';
import { Lock, LoaderCircle, ArrowRight } from 'lucide-react';
import { setToken } from './../api';

export default function Login({ onSuccess }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/orders', {
        headers: { Authorization: `Bearer ${value.trim()}` }
      });
      if (res.status === 401) {
        setError('Senha incorreta.');
        return;
      }
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setToken(value.trim());
      onSuccess();
    } catch (err) {
      setError('Não foi possível conectar ao servidor. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative h-dvh flex items-center justify-center p-4 overflow-hidden">
      <div className="backdrop" aria-hidden="true" />
      <div className="frame absolute inset-2 sm:inset-3 rounded-[2rem] sm:rounded-[2.5rem]" aria-hidden="true" />

      <div className="relative z-[1] w-full max-w-md animate-fade-up">
        <form
          onSubmit={submit}
          className="bg-white rounded-[2.25rem] border border-black/5 shadow-sm p-8 sm:p-10"
        >
          <div className="mb-9">
            <div className="flex items-center justify-between mb-10">
              <img src="/logo.png" alt="Classul" className="w-12 h-12 object-contain" />
              <span className="font-mono text-[11px] uppercase text-slate-400">Gestão de pedidos</span>
            </div>
            <h1 className="text-[2.6rem] leading-[1] font-medium tracking-[-0.045em] text-brand-950">
              Bem-vindo
              <br />
              <span className="text-slate-400">de volta.</span>
            </h1>
          </div>

          <label className="block text-[11px] font-extrabold text-slate-400 uppercase tracking-widest mb-2">
            Senha de acesso
          </label>
          <div className="relative mb-4">
            <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Digite a senha"
              autoFocus
              className="w-full border-2 border-slate-200 rounded-full pl-11 pr-4 py-3.5 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white"
            />
          </div>
          {error && (
            <p className="text-sm font-semibold text-flame-600 bg-flame-50 border border-flame-100 rounded-xl px-4 py-2.5 mb-4">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="group w-full bg-brand-600 hover:bg-brand-700 text-white font-extrabold rounded-full py-3.5 flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {loading ? (
              <LoaderCircle size={18} className="animate-spin" />
            ) : (
              <>
                Entrar
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>
        <p className="text-center text-xs text-slate-400 mt-6 font-medium">
          classul.com.br · placas e brindes
        </p>
      </div>
    </div>
  );
}
