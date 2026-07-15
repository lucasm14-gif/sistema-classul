import React, { useCallback, useEffect, useState } from 'react';
import { KanbanSquare, Settings as SettingsIcon, LogOut, Archive, Users, ChartColumn } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Board from './components/Board';
import Settings from './components/Settings';
import Login from './components/Login';
import Archived from './components/Archived';
import Clients from './components/Clients';
import { ToastProvider } from './components/Toast';
import { getToken, clearToken, AuthError } from './api';

const TABS = [
  { id: 'board', label: 'Pedidos', icon: KanbanSquare },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'dashboard', label: 'Faturamento', icon: ChartColumn },
  { id: 'archived', label: 'Arquivados', icon: Archive },
  { id: 'settings', label: 'Configurações', icon: SettingsIcon }
];

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [tab, setTab] = useState('board');

  const handleAuthError = useCallback((err) => {
    if (err instanceof AuthError) {
      clearToken();
      setAuthed(false);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!authed) setTab('board');
  }, [authed]);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <ToastProvider>
      <div className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-black/5">
          <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img src="/logo.png" alt="Classul" className="w-11 h-11 object-contain shrink-0" />
              <div className="hidden sm:block leading-tight">
                <h1 className="font-extrabold tracking-tight text-brand-950 text-lg">Classul</h1>
                <p className="text-[11px] font-semibold text-slate-400 -mt-0.5">Gestão de Pedidos</p>
              </div>
            </div>

            <nav className="flex items-center gap-1 bg-black/[0.04] rounded-full p-1">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-sm font-bold transition-all ${
                    tab === id
                      ? 'bg-white text-brand-800 shadow-sm'
                      : 'text-slate-500 hover:text-brand-900'
                  }`}
                >
                  <Icon size={16} strokeWidth={2.5} />
                  <span className="hidden md:inline">{label}</span>
                </button>
              ))}
            </nav>

            <button
              onClick={() => {
                clearToken();
                setAuthed(false);
              }}
              title="Sair"
              className="p-2.5 rounded-full text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden">
          {tab === 'board' && <Board onAuthError={handleAuthError} />}
          {tab === 'clients' && <Clients onAuthError={handleAuthError} />}
          {tab === 'dashboard' && <Dashboard onAuthError={handleAuthError} />}
          {tab === 'archived' && <Archived onAuthError={handleAuthError} />}
          {tab === 'settings' && <Settings onAuthError={handleAuthError} />}
        </main>
      </div>
    </ToastProvider>
  );
}
