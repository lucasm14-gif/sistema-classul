import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import '../index.css'
import { initChatObserver } from './ChatObserver';

// Function to mount the app
function mount() {
    try {
        const existingRoot = document.getElementById('wa-kanban-root');
        if (existingRoot) return;

        const rootElement = document.createElement('div');
        rootElement.id = 'wa-kanban-root';

        // Maximize Z-Index to avoid being hidden by WhatsApp layers
        rootElement.style.position = 'fixed';
        rootElement.style.top = '0';
        rootElement.style.left = '0';
        rootElement.style.zIndex = '2147483647'; // Max Int32
        rootElement.style.pointerEvents = 'none';
        rootElement.style.width = '100vw';
        rootElement.style.height = '100vh';

        document.body.appendChild(rootElement);

        const root = createRoot(rootElement);
        root.render(
            <React.StrictMode>
                <App />
            </React.StrictMode>
        );

        console.log('WhatsApp Kanban: UI Mounted');
    } catch (err) {
        console.error('WhatsApp Kanban: Mount Failed', err);
    }
}

// Start
try {
    mount();
    initChatObserver();
    console.log('WhatsApp Kanban: Observers Initialized');
} catch (err) {
    console.error('WhatsApp Kanban: Initialization Failed', err);
}
