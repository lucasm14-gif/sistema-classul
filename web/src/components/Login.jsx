import React, { useState } from 'react';
import { Lock, LoaderCircle } from 'lucide-react';
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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center font-black text-2xl text-white mb-3">
            C
          </div>
          <h1 className="text-xl font-bold text-slate-900">Classul</h1>
          <p className="text-sm text-slate-500">Gestão de Pedidos</p>
        </div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Senha de acesso</label>
        <div className="relative mb-3">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Digite a senha (API_TOKEN)"
            autoFocus
            className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg py-2.5 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading && <LoaderCircle size={16} className="animate-spin" />}
          Entrar
        </button>
      </form>
    </div>
  );
}
