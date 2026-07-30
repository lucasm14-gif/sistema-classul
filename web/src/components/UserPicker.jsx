import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserRound, Check, Plus, ChevronDown } from 'lucide-react';
import { api } from '../api';
import { getUser, setUser } from '../api';

const AVATAR_COLORS = ['#4a9c33', '#ee3b33', '#eabf00', '#2563eb', '#7c3aed', '#db2777', '#0891b2'];

export function colorFor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h] || AVATAR_COLORS[0];
}

export default function UserPicker({ onAuthError }) {
  const [current, setCurrent] = useState(getUser());
  const [employees, setEmployees] = useState([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef(null);

  const load = useCallback(() => {
    api
      .listEmployees()
      .then(setEmployees)
      .catch((err) => onAuthError?.(err));
  }, [onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (name) => {
    setUser(name);
    setCurrent(name);
    setOpen(false);
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createEmployee({ name });
      setNewName('');
      setAdding(false);
      load();
      choose(name);
    } catch (err) {
      onAuthError?.(err);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-black/[0.04] hover:bg-black/[0.07] transition-colors"
        title="Quem está usando"
      >
        {current ? (
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-white font-extrabold text-xs shrink-0"
            style={{ backgroundColor: colorFor(current) }}
          >
            {current.charAt(0).toUpperCase()}
          </span>
        ) : (
          <span className="w-7 h-7 rounded-full bg-slate-300 flex items-center justify-center text-white shrink-0">
            <UserRound size={15} />
          </span>
        )}
        <span className="hidden sm:block text-sm font-bold text-brand-950 max-w-[120px] truncate">
          {current || 'Quem é você?'}
        </span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 bg-white rounded-2xl shadow-2xl border border-black/5 p-2 z-50 animate-fade-up">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-2 py-1.5">
            Funcionário
          </p>
          <div className="max-h-64 overflow-y-auto">
            {employees.length === 0 && (
              <p className="text-xs text-slate-400 px-2 py-2">Nenhum cadastrado ainda.</p>
            )}
            {employees.map((e) => (
              <button
                key={e.id}
                onClick={() => choose(e.name)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-brand-50 transition-colors text-left"
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white font-extrabold text-xs shrink-0"
                  style={{ backgroundColor: e.color || colorFor(e.name) }}
                >
                  {e.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 text-sm font-semibold text-brand-950 truncate">{e.name}</span>
                {current === e.name && <Check size={15} className="text-brand-600" />}
              </button>
            ))}
          </div>

          {adding ? (
            <div className="flex gap-1.5 p-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                placeholder="Nome do funcionário"
                autoFocus
                className="flex-1 min-w-0 border-2 border-slate-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
              />
              <button
                onClick={add}
                className="px-3 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700"
              >
                OK
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full flex items-center gap-2 px-2 py-2 mt-1 rounded-xl text-brand-700 hover:bg-brand-50 text-sm font-bold border-t border-black/5"
            >
              <Plus size={15} /> Adicionar funcionário
            </button>
          )}
        </div>
      )}
    </div>
  );
}
