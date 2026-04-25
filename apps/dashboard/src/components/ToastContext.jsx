/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, useCallback } from 'react';

const ToastContext = createContext(null);

let toastCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((toast) => {
    toastCounter += 1;
    const id = toast.id || `toast-${toastCounter}`;
    setToasts((prev) => [...prev, { id, ...toast }]);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // In production, fail soft to avoid blank screens if the provider isn't mounted
  if (import.meta.env && import.meta.env.PROD) {
    const noop = () => {};
    return { pushToast: noop, dismissToast: noop };
  }
  // In dev, surface the error loudly for quick diagnosis
  throw new Error('useToast must be used within a ToastProvider');
}

export function ToastViewport({ toasts, onDismiss }) {
  return (
    <div className="fixed right-4 top-16 z-50 flex w-72 flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-lg border px-3 py-2 shadow-lg text-sm ${
            toast.variant === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : toast.variant === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              {toast.title ? <div className="font-semibold text-slate-900">{toast.title}</div> : null}
              <div>{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
