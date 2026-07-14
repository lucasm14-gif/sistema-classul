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
    <div className="relative min-h-screen bg-brand-950 flex items-center justify-center p-4 overflow-hidden">
      {/* blobs decorativos com as cores da marca */}
      <div className="pointer-events-none absolute -top-32 -left-32 w-[34rem] h-[34rem] rounded-full bg-brand-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 w-[30rem] h-[30rem] rounded-full bg-brand-400/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 w-72 h-72 rounded-full bg-flame-500/15 blur-3xl" />

      <div className="relative w-full max-w-md animate-fade-up">
        <form
          onSubmit={submit}
          className="bg-white/95 backdrop-blur rounded-[2rem] shadow-2xl shadow-black/40 p-10"
        >
          <div className="flex flex-col items-center mb-8 text-center">
            <img src="/logo.png" alt="Classul" className="w-28 h-28 object-contain drop-shadow-sm mb-2" />
            <h1 className="text-2xl font-extrabold tracking-tight text-brand-950">Bem-vindo de volta</h1>
            <p className="text-sm text-slate-500 mt-1">Gestão de Pedidos da Classul</p>
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
              className="w-full border-2 border-slate-200 rounded-2xl pl-11 pr-4 py-3.5 text-sm font-medium outline-none transition-colors focus:border-brand-500 bg-white"
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
            className="group w-full bg-brand-600 hover:bg-brand-700 text-white font-extrabold rounded-2xl py-3.5 flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand-600/30 hover:shadow-xl hover:shadow-brand-600/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
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
        <p className="text-center text-xs text-white/40 mt-6 font-medium">
          classul.com.br · placas e brindes
        </p>
      </div>
    </div>
  );
}
