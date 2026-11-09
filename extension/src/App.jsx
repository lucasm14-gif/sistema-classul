import React, { useState, useEffect } from 'react'
import OrdersPanel from './components/panel/OrdersPanel'
import QuickMessages from './components/QuickMessages'
import QuotePanel from './components/panel/QuotePanel'
import { eventBus } from './utils/events'

function App() {
  const [panel, setPanel] = useState(null);
  const [showQuickMessages, setShowQuickMessages] = useState(false);
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    // Abre o painel de pedidos; clicar de novo no botão (sem pedir "novo") fecha.
    const handleShowPanel = (data) => {
      setQuote(null);
      setPanel((open) => (open && data?.toggle ? null : data || {}));
    };
    const handleShowQuickMessages = () => setShowQuickMessages(true);
    // Orçamento: abre por cima do painel de pedidos (os dois usam a mesma lateral).
    const handleShowQuote = (data) => {
      setPanel(null);
      setQuote((open) => (open && data?.toggle ? null : { ...(data || {}), at: Date.now() }));
    };

    eventBus.on('SHOW_ORDERS_PANEL', handleShowPanel);
    eventBus.on('SHOW_QUICK_MESSAGES', handleShowQuickMessages);
    eventBus.on('SHOW_QUOTE_PANEL', handleShowQuote);
    return () => {
      eventBus.off('SHOW_QUOTE_PANEL', handleShowQuote);
      eventBus.off('SHOW_ORDERS_PANEL', handleShowPanel);
      eventBus.off('SHOW_QUICK_MESSAGES', handleShowQuickMessages);
    };
  }, []);

  useEffect(() => {
    eventBus.emit('PANEL_STATE', Boolean(panel));
  }, [panel]);

  useEffect(() => {
    eventBus.emit('QUOTE_STATE', Boolean(quote));
  }, [quote]);

  return (
    <>
      {panel && <OrdersPanel start={panel} onClose={() => setPanel(null)} />}
      {quote && <QuotePanel key={quote.at} start={quote} onClose={() => setQuote(null)} />}
      {showQuickMessages && <QuickMessages onClose={() => setShowQuickMessages(false)} />}
    </>
  )
}

export default App
