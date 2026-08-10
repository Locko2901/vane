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
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-4">
          <div className="flex items-center gap-2 text-lg font-bold">
            <i className="fa-solid fa-location-arrow text-brand" />
            Vane
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-1 md:flex-col md:gap-1 md:overflow-visible md:px-3 md:py-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${isActive
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
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  )
}
