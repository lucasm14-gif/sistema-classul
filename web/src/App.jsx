import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Award, Layers, KanbanSquare, Settings as SettingsIcon, LogOut, Archive, Users, ChartColumn, Bot, MousePointerClick, Wallet, Sun, Moon, Puzzle, Inbox as InboxIcon, ReceiptText, Clock3 } from 'lucide-react';
import Board from './components/Board';
import Login from './components/Login';
import { BatSigil } from './components/BatSigil';
import UserPicker from './components/UserPicker';
import { ToastProvider } from './components/Toast';
import { getToken, clearToken, AuthError } from './api';
import { isDark, toggleTheme } from './theme';

const TABS = [
  { id: 'board', label: 'Pedidos', icon: KanbanSquare },
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'dashboard', label: 'Faturamento', icon: ChartColumn },
  { id: 'notas', label: 'Notas fiscais', icon: ReceiptText },
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

// Só o quadro de pedidos (a tela inicial) vem no pacote principal. As outras abas
// são baixadas à parte: quem abre o sistema não espera por Notas, Finanças etc.
const LOADERS = {
  clients: () => import('./components/Clients'),
  dashboard: () => import('./components/Faturamento'),
  notas: () => import('./components/Notas'),
  leads: () => import('./components/Leads'),
  bot: () => import('./components/BotChats'),
  inbox: () => import('./components/Inbox'),
  arts: () => import('./components/Arts'),
  'site-plates': () => import('./components/SitePlates'),
  extension: () => import('./components/Extension'),
  finance: () => import('./components/Finance'),
  archived: () => import('./components/Archived'),
  settings: () => import('./components/Settings'),
  lucas: () => import('./components/Lucas')
};
const PAGES = Object.fromEntries(Object.entries(LOADERS).map(([id, load]) => [id, lazy(load)]));
const Lucas = PAGES.lucas;

// Adianta o download de uma aba (ao passar o mouse no menu, ou com o navegador ocioso).
// Falha de rede aqui não importa: a aba tenta de novo quando for aberta.
const preload = (id) => LOADERS[id]?.().catch(() => {});

// Pílula do topo: círculo preto com relógio + hora e data de hoje.
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);
  const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '');
  return (
    <div className="pill hidden sm:inline-flex pr-5" title={now.toLocaleDateString('pt-BR', { dateStyle: 'full' })}>
      <span className="orb -ml-px">
        <Clock3 size={16} strokeWidth={1.6} />
      </span>
      <span className="ml-3 font-mono text-[13px] text-brand-950">{hora}</span>
      <span className="ml-2.5 text-xs font-medium text-slate-400 capitalize">{dia}</span>
    </div>
  );
}

// Aparece só se a aba demorar a chegar (rede lenta); em geral ela já está em cache.
function PageLoading() {
  return (
    <div className="h-full flex items-center justify-center text-xs font-medium text-slate-400" role="status">
      Carregando…
    </div>
  );
}

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

  // Com a tela inicial pronta e o navegador parado, busca as outras abas uma a uma:
  // a troca de aba fica instantânea sem atrasar a abertura.
  useEffect(() => {
    if (!authed) return undefined;
    let cancelled = false;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    const fila = Object.keys(LOADERS).filter((id) => id !== 'lucas');
    const proxima = () => {
      if (cancelled || !fila.length) return;
      Promise.resolve(preload(fila.shift())).then(() => idle(proxima));
    };
    idle(proxima);
    return () => {
      cancelled = true;
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) {
      setTab('board');
      setLucasOpen(false);
    }
  }, [authed]);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  const current = Math.max(0, TABS.findIndex((t) => t.id === tab));
  const Page = PAGES[tab];

  return (
    <ToastProvider>
      <div className="backdrop" aria-hidden="true" />
      {/* Moldura de vidro: barra lateral em bloco branco + área de conteúdo. */}
      <div className="relative h-dvh p-2 sm:p-3">
        {/* O vidro é uma camada irmã, não um pai: backdrop-filter num ancestral
            viraria âncora de position:fixed e deslocaria o cartão arrastado. */}
        <div className="frame absolute inset-2 sm:inset-3 rounded-[2rem] sm:rounded-[2.5rem]" aria-hidden="true" />
        <div className="relative z-[1] h-full p-2 sm:p-3 flex gap-2 sm:gap-3">
          <aside className="rail-in z-30 shrink-0 w-[68px] xl:w-[214px] rounded-[1.6rem] sm:rounded-[1.9rem] bg-white border border-black/5 shadow-sm flex flex-col py-4 xl:py-5">
            <div className="flex items-center justify-center xl:justify-start gap-2.5 px-3 xl:px-5 shrink-0">
              <img src="/logo.png" alt="Classul" title="Classul · Gestão de Pedidos" className="w-10 h-10 object-contain shrink-0" />
              <div className="hidden xl:block leading-none">
                <p className="text-[15px] font-extrabold tracking-tight text-brand-950">Classul</p>
                <p className="mt-1 text-[10px] font-medium text-slate-400">Gestão de pedidos</p>
              </div>
            </div>

            <nav className="mt-5 xl:mt-7 flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 px-3 [scrollbar-width:none]">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  onMouseEnter={() => preload(id)}
                  onFocus={() => preload(id)}
                  title={label}
                  aria-label={label}
                  aria-current={tab === id ? 'page' : undefined}
                  className={`nav-item shrink-0 justify-center xl:justify-start xl:px-4 ${tab === id ? 'is-active' : ''}`}
                >
                  <Icon size={17} strokeWidth={1.6} className="shrink-0" />
                  <span className="hidden xl:inline">{label}</span>
                </button>
              ))}
            </nav>

            <div className="mt-3 pt-3 mx-3 border-t border-black/5 flex flex-col items-center xl:items-stretch gap-2 shrink-0">
              <UserPicker onAuthError={handleAuthError} rail />
              <div className="flex flex-col xl:flex-row items-center justify-between gap-1">
                <button
                  onClick={() => {
                    clearToken();
                    setAuthed(false);
                  }}
                  title="Sair"
                  className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:text-flame-600 hover:bg-flame-50 transition-colors"
                >
                  <LogOut size={16} strokeWidth={1.6} />
                </button>
                {/* Entrada discreta para a área pessoal. */}
                <button
                  onClick={() => setLucasOpen(true)}
                  onMouseEnter={() => preload('lucas')}
                  aria-label="Área pessoal"
                  className="group p-1.5 text-slate-400 hover:text-brand-900 transition-colors"
                >
                  <BatSigil
                    className="w-7 opacity-40 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"
                    style={{ fill: 'currentColor' }}
                  />
                </button>
              </div>
            </div>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col">
            {/* Topo: onde estou + pílulas (hora, tema). */}
            <header className="shrink-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-4 pt-1 pb-2 sm:pb-3">
              <p className="flex items-baseline gap-2.5 min-w-0 text-[11px] font-medium uppercase text-slate-400">
                <span className="font-mono text-brand-950">{String(current + 1).padStart(2, '0')}</span>
                <span className="w-6 h-px bg-black/20 self-center" />
                <span className="truncate">{TABS[current].label}</span>
              </p>
              <div className="ml-auto flex items-center gap-2">
                <Clock />
                <button
                  onClick={() => {
                    toggleTheme();
                    setDark(isDark());
                  }}
                  title={dark ? 'Modo claro' : 'Modo escuro'}
                  aria-label={dark ? 'Modo claro' : 'Modo escuro'}
                  className="orb"
                >
                  {dark ? <Sun size={16} strokeWidth={1.6} /> : <Moon size={16} strokeWidth={1.6} />}
                </button>
              </div>
            </header>

            <main key={tab} className="flex-1 min-h-0 overflow-y-auto rounded-[1.5rem]">
              {tab === 'board' ? (
                <Board onAuthError={handleAuthError} />
              ) : (
                <Suspense fallback={<PageLoading />}>
                  <Page onAuthError={handleAuthError} />
                </Suspense>
              )}
            </main>
          </div>
        </div>
      </div>

      {lucasOpen && (
        <Suspense fallback={null}>
          <Lucas onAuthError={handleAuthError} onExit={() => setLucasOpen(false)} />
        </Suspense>
      )}
    </ToastProvider>
  );
}
