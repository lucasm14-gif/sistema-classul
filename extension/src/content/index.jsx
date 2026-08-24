import { eventBus } from '../utils/events';
import { initChatObserver } from './ChatObserver';
import { initOpenChat } from './openChat';
import '../index.css';

// A interface (React) só é montada quando alguma janela precisa aparecer.
// Antes ela subia junto com o WhatsApp Web e deixava o carregamento mais lento.
let uiMounted = false;
let mounting = null;

async function ensureUI() {
    if (uiMounted) return;
    if (mounting) return mounting;

    mounting = (async () => {
        const [{ default: React }, { createRoot }, { default: App }] = await Promise.all([
            import('react'),
            import('react-dom/client'),
            import('../App')
        ]);

        const rootElement = document.createElement('div');
        rootElement.id = 'wa-kanban-root';
        rootElement.style.position = 'fixed';
        rootElement.style.top = '0';
        rootElement.style.left = '0';
        rootElement.style.zIndex = '2147483647';
        rootElement.style.pointerEvents = 'none';
        document.body.appendChild(rootElement);

        createRoot(rootElement).render(React.createElement(App));
        uiMounted = true;
    })();

    return mounting;
}

// Espera o App registrar seu ouvinte (o React 18 renderiza de forma assíncrona).
async function waitForAppListener(name) {
    for (let i = 0; i < 60; i++) {
        if ((eventBus.events[name] || []).length > 1) return true;
        await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

// Ao pedir uma janela, monta a UI e reemite o evento para o App recém-criado.
for (const name of ['SHOW_ORDER_MODAL', 'SHOW_QUICK_MESSAGES']) {
    eventBus.on(name, async (data) => {
        if (uiMounted) return;
        await ensureUI();
        await waitForAppListener(name);
        eventBus.emit(name, data);
    });
}

try {
    initChatObserver();
    initOpenChat();
} catch (err) {
    console.error('Classul: falha ao iniciar', err);
}
