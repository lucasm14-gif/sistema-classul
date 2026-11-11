import { useEffect } from 'react';

// Carrega ao abrir e repete a cada `ms`, mas só com a janela à vista: aba do navegador
// em segundo plano não gasta requisição. Ao voltar para ela, atualiza na hora.
export function usePolling(load, ms = 30000) {
  useEffect(() => {
    load();
    const tick = () => {
      if (!document.hidden) load({ silent: true });
    };
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, ms]);
}
