import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const STYLES = {
  success: { bg: 'bg-emerald-600', Icon: CheckCircle2 },
  error: { bg: 'bg-red-600', Icon: AlertTriangle },
  info: { bg: 'bg-slate-700', Icon: Info }
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = 'info', duration = 4500) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(({ id, message, type }) => {
          const { bg, Icon } = STYLES[type] || STYLES.info;
          return (
            <div
              key={id}
              className={`${bg} text-white px-4 py-3 rounded-xl shadow-xl flex items-start gap-3 text-sm animate-[slideIn_.25s_ease-out]`}
            >
              <Icon size={18} className="shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== id))}
                className="ml-auto opacity-70 hover:opacity-100"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
    </ToastContext.Provider>
  );
}
