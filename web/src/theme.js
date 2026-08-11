// Tema claro/escuro. A escolha fica no dispositivo; "system" segue o aparelho.
const KEY = 'classul_theme';
const MODES = ['system', 'light', 'dark'];

export function getThemePref() {
  const v = localStorage.getItem(KEY);
  return MODES.includes(v) ? v : 'system';
}

export function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
}

export function isDark(pref = getThemePref()) {
  return pref === 'dark' || (pref === 'system' && prefersDark());
}

export function applyTheme(pref = getThemePref()) {
  document.documentElement.classList.toggle('dark', isDark(pref));
}

export function setThemePref(pref) {
  if (!MODES.includes(pref)) pref = 'system';
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
  window.dispatchEvent(new Event('classul-theme-changed'));
}

// Alterna claro ⇄ escuro partindo do que está valendo agora.
export function toggleTheme() {
  setThemePref(isDark() ? 'light' : 'dark');
}

// Enquanto o usuário estiver em "system", acompanha a mudança do aparelho.
export function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const onChange = () => {
    if (getThemePref() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
