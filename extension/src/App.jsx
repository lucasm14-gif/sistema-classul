import React, { useState, useEffect } from 'react'
import OrdersPanel from './components/panel/OrdersPanel'
import QuickMessages from './components/QuickMessages'
import { eventBus } from './utils/events'

function App() {
  const [panel, setPanel] = useState(null);
  const [showQuickMessages, setShowQuickMessages] = useState(false);

  useEffect(() => {
    // Abre o painel de pedidos; clicar de novo no botão (sem pedir "novo") fecha.
    const handleShowPanel = (data) => {
      setPanel((open) => (open && data?.toggle ? null : data || {}));
    };
    const handleShowQuickMessages = () => setShowQuickMessages(true);

    eventBus.on('SHOW_ORDERS_PANEL', handleShowPanel);
    eventBus.on('SHOW_QUICK_MESSAGES', handleShowQuickMessages);
    return () => {
      eventBus.off('SHOW_ORDERS_PANEL', handleShowPanel);
      eventBus.off('SHOW_QUICK_MESSAGES', handleShowQuickMessages);
    };
  }, []);

  useEffect(() => {
    eventBus.emit('PANEL_STATE', Boolean(panel));
  }, [panel]);

  return (
    <>
      {panel && <OrdersPanel start={panel} onClose={() => setPanel(null)} />}
      {showQuickMessages && <QuickMessages onClose={() => setShowQuickMessages(false)} />}
    </>
  )
}

export default App
