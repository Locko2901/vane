import { NavLink } from 'react-router'
import type { ReactNode } from 'react'
import { prefetchRoute } from '../routes'

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
      <aside className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2.5 px-4 py-3.5 md:px-5 md:py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-brand-glow">
            <i className="fa-solid fa-location-arrow text-sm" />
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-tight">Vane</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
              DDNS Manager
            </span>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:mt-2 md:flex-1 md:flex-col md:gap-1 md:overflow-visible md:px-3 md:py-3">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              onMouseEnter={() => prefetchRoute(n.to)}
              onFocus={() => prefetchRoute(n.to)}
              className={({ isActive }) =>
                `group relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive
                  ? 'bg-brand/10 text-brand'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`absolute inset-y-1.5 left-0 hidden w-1 rounded-full bg-brand transition-opacity md:block ${isActive ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <i className={`fa-solid ${n.icon} w-5 text-center ${isActive ? 'text-brand' : 'text-slate-400 group-hover:text-current'}`} />
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-5 py-4 text-[11px] text-slate-400 md:block">
          <i className="fa-solid fa-shield-halved mr-1.5" />
          Tokens encrypted at rest
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="animate-fade-in">{children}</div>
      </main>
    </div>
  )
}
