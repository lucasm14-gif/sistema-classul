import React, { useCallback, useEffect, useState } from 'react';
import { KanbanSquare, Settings as SettingsIcon, LogOut, Archive } from 'lucide-react';
import Board from './components/Board';
import Settings from './components/Settings';
import Login from './components/Login';
import Archived from './components/Archived';
import { ToastProvider } from './components/Toast';
import { getToken, clearToken, AuthError } from './api';

const TABS = [
  { id: 'board', label: 'Pedidos', icon: KanbanSquare },
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
      <div className="min-h-screen bg-slate-100 flex flex-col">
        <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-lg">
              C
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Classul</h1>
              <p className="text-xs text-slate-400 leading-tight">Gestão de Pedidos</p>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === id ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
            <button
              onClick={() => {
                clearToken();
                setAuthed(false);
              }}
              title="Sair"
              className="ml-2 p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <LogOut size={16} />
            </button>
          </nav>
        </header>

        <main className="flex-1 overflow-hidden">
          {tab === 'board' && <Board onAuthError={handleAuthError} />}
          {tab === 'archived' && <Archived onAuthError={handleAuthError} />}
          {tab === 'settings' && <Settings onAuthError={handleAuthError} />}
        </main>
      </div>
    </ToastProvider>
  );
}
