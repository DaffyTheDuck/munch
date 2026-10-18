import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  msg: string
  action?: { label: string; run: () => void }
}

type Show = (msg: string, action?: ToastItem['action']) => void

const Ctx = createContext<Show>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = (id: number) => setItems((l) => l.filter((t) => t.id !== id))

  const show = useCallback<Show>((msg, action) => {
    const id = Date.now() + Math.random()
    setItems((l) => [...l.slice(-2), { id, msg, action }])
    setTimeout(() => dismiss(id), 6000)
  }, [])

  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" role="status">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.msg}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
