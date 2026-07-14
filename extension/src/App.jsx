import React, { useState, useEffect } from 'react'
import OrderModal from './components/OrderModal'
import QuickMessages from './components/QuickMessages'
import { eventBus } from './utils/events'

function App() {
  const [orderModalData, setOrderModalData] = useState(null);
  const [showQuickMessages, setShowQuickMessages] = useState(false);

  useEffect(() => {
    const handleShowOrderModal = (data) => {
      setOrderModalData(data);
    };

    const handleShowQuickMessages = () => {
      setShowQuickMessages(true);
    };

    eventBus.on('SHOW_ORDER_MODAL', handleShowOrderModal);
    eventBus.on('SHOW_QUICK_MESSAGES', handleShowQuickMessages);

    return () => {
      eventBus.off('SHOW_ORDER_MODAL', handleShowOrderModal);
      eventBus.off('SHOW_QUICK_MESSAGES', handleShowQuickMessages);
    };
  }, []);

  return (
    <>
      {orderModalData && (
        <OrderModal
          contactData={orderModalData}
          onClose={() => setOrderModalData(null)}
        />
      )}

      {showQuickMessages && (
        <QuickMessages
          onClose={() => setShowQuickMessages(false)}
        />
      )}
    </>
  )
}

export default App
