import React, { useCallback, useEffect, useState } from 'react';
import { Award, Layers, KanbanSquare, Settings as SettingsIcon, LogOut, Archive, Users, ChartColumn, Bot, MousePointerClick, Wallet, Sun, Moon, Puzzle, Inbox as InboxIcon } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Board from './components/Board';
import Settings from './components/Settings';
import Login from './components/Login';
import Archived from './components/Archived';
import Clients from './components/Clients';
import BotChats from './components/BotChats';
import Leads from './components/Leads';
import Extension from './components/Extension';
import Inbox from './components/Inbox';
import Arts from './components/Arts';
import SitePlates from './components/SitePlates';
import Finance from './components/Finance';
import Lucas, { BatSigil } from './components/Lucas';
import UserPicker from './components/UserPicker';
import { ToastProvider } from './components/Toast';
import { getToken, clearToken, AuthError } from './api';
import { isDark, toggleTheme } from './theme';

const TABS = [
  { id: 'board', label: 'Pedidos', icon: KanbanSquare },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'dashboard', label: 'Faturamento', icon: ChartColumn },
  { id: 'leads', label: 'Leads', icon: MousePointerClick },
  { id: 'bot', label: 'Bot', icon: Bot },
  { id: 'inbox', label: 'Recebidos', icon: InboxIcon },
  { id: 'arts', label: 'Artes', icon: Award },
  { id: 'site-plates', label: 'Placas do site', icon: Layers },
  { id: 'extension', label: 'Extensão', icon: Puzzle },
  { id: 'finance', label: 'Finanças', icon: Wallet },
  { id: 'archived', label: 'Arquivados', icon: Archive },
  { id: 'settings', label: 'Configurações', icon: SettingsIcon }
];

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [tab, setTab] = useState('board');
  // Área pessoal do Lucas: não é uma aba — abre pelo morcego do rodapé e cobre a tela.
  const [lucasOpen, setLucasOpen] = useState(false);
  const [dark, setDark] = useState(() => isDark());

  const handleAuthError = useCallback((err) => {
    if (err instanceof AuthError) {
      clearToken();
      setAuthed(false);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!authed) {
      setTab('board');
      setLucasOpen(false);
    }
  }, [authed]);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <ToastProvider>
      <div className="min-h-screen flex">
        {/* Barra lateral de ícones (estilo painel): navegação no meio, conta e tema embaixo. */}
        <aside className="sticky top-3 z-30 shrink-0 self-start h-[calc(100vh-1.5rem)] w-[68px] sm:w-[76px] ml-3 my-3 rounded-[1.75rem] bg-white/85 backdrop-blur-xl border border-black/5 shadow-sm flex flex-col items-center py-4">
          <img src="/logo.png" alt="Classul" title="Classul · Gestão de Pedidos" className="w-11 h-11 object-contain shrink-0" />
          <span className="mt-1 text-[10px] font-extrabold tracking-tight text-brand-950">Classul</span>

          <nav className="mt-5 flex-1 min-h-0 w-full overflow-y-auto overflow-x-visible flex flex-col items-center gap-1.5 px-3.5 [scrollbar-width:none]">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                title={label}
                aria-label={label}
                className={`relative shrink-0 w-11 h-11 flex items-center justify-center rounded-2xl transition-all ${
                  tab === id
                    ? 'nav-active bg-brand-500/15 text-brand-600 ring-1 ring-brand-500/25'
                    : 'text-slate-400 hover:text-brand-900 hover:bg-black/[0.05]'
                }`}
              >
                <Icon size={19} strokeWidth={tab === id ? 2.4 : 2} />
              </button>
            ))}
          </nav>

          <div className="mt-3 pt-3 border-t border-black/5 w-10 flex flex-col items-center gap-1.5">
            <button
              onClick={() => {
                toggleTheme();
                setDark(isDark());
              }}
              title={dark ? 'Modo claro' : 'Modo escuro'}
              className="w-10 h-10 flex items-center justify-center rounded-2xl text-slate-400 hover:text-brand-800 hover:bg-black/[0.05] transition-colors"
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              onClick={() => {
                clearToken();
                setAuthed(false);
              }}
              title="Sair"
              className="w-10 h-10 flex items-center justify-center rounded-2xl text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors"
            >
              <LogOut size={17} />
            </button>
            {/* Entrada discreta para a área pessoal. */}
            <button
              onClick={() => setLucasOpen(true)}
              aria-label="Área pessoal"
              className="group p-1.5 text-slate-400 hover:text-brand-900 transition-colors"
            >
              <BatSigil
                className="w-7 opacity-40 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"
                style={{ fill: 'currentColor' }}
              />
            </button>
            <UserPicker onAuthError={handleAuthError} compact />
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-hidden">
          {tab === 'board' && <Board onAuthError={handleAuthError} />}
          {tab === 'clients' && <Clients onAuthError={handleAuthError} />}
          {tab === 'dashboard' && <Dashboard onAuthError={handleAuthError} />}
          {tab === 'leads' && <Leads onAuthError={handleAuthError} />}
          {tab === 'bot' && <BotChats onAuthError={handleAuthError} />}
          {tab === 'inbox' && <Inbox onAuthError={handleAuthError} />}
          {tab === 'arts' && <Arts onAuthError={handleAuthError} />}
          {tab === 'site-plates' && <SitePlates onAuthError={handleAuthError} />}
          {tab === 'extension' && <Extension onAuthError={handleAuthError} />}
          {tab === 'finance' && <Finance onAuthError={handleAuthError} />}
          {tab === 'archived' && <Archived onAuthError={handleAuthError} />}
          {tab === 'settings' && <Settings onAuthError={handleAuthError} />}
        </main>
      </div>

      {lucasOpen && <Lucas onAuthError={handleAuthError} onExit={() => setLucasOpen(false)} />}
    </ToastProvider>
  );
}
