import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastLevel = 'success' | 'error' | 'info'
interface Toast {
  id: number
  level: ToastLevel
  message: string
}

interface ToastContextValue {
  toast: (message: string, level?: ToastLevel) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined })

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, level: ToastLevel = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, level, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`badge max-w-sm rounded-lg px-4 py-2 text-sm text-white shadow-lg ${t.level === 'success' ? 'bg-emerald-600' : t.level === 'error' ? 'bg-red-600' : 'bg-slate-700'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
