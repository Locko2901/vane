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
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-pop backdrop-blur-md animate-slide-in-right ${t.level === 'success'
              ? 'border-emerald-500/30 bg-emerald-50/95 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/80 dark:text-emerald-200'
              : t.level === 'error'
                ? 'border-red-500/30 bg-red-50/95 text-red-800 dark:border-red-500/30 dark:bg-red-950/80 dark:text-red-200'
                : 'border-slate-300/60 bg-white/95 text-slate-700 dark:border-slate-700/60 dark:bg-slate-800/90 dark:text-slate-200'
              }`}
          >
            <i
              className={`fa-solid mt-0.5 ${t.level === 'success'
                ? 'fa-circle-check text-emerald-500'
                : t.level === 'error'
                  ? 'fa-circle-exclamation text-red-500'
                  : 'fa-circle-info text-slate-400'
                }`}
            />
            <span className="min-w-0 break-words">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
