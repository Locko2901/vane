import { NavLink } from 'react-router'
import type { ReactNode } from 'react'

const nav = [
  { to: '/', label: 'Dashboard', icon: 'fa-gauge-high' },
  { to: '/hosts', label: 'Hosts', icon: 'fa-globe' },
  { to: '/tokens', label: 'API Tokens', icon: 'fa-key' },
  { to: '/logs', label: 'Logs', icon: 'fa-file-lines' },
  { to: '/backup', label: 'Backup', icon: 'fa-floppy-disk' },
  { to: '/settings', label: 'Settings', icon: 'fa-gear' },
]

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 px-5 py-4 text-lg font-bold">
          <i className="fa-solid fa-location-arrow text-brand" />
          Vane
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive
                  ? 'bg-brand/10 text-brand'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`
              }
            >
              <i className={`fa-solid ${n.icon} w-5 text-center`} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
