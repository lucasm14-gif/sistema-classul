import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, watchSystemTheme } from './theme';

// Aplica antes de renderizar para não piscar branco no modo escuro.
applyTheme();
watchSystemTheme();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
