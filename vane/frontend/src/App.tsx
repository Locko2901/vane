import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout'
import { api } from './api/client'
import { applyTheme, type Theme } from './theme'
import { routeImports } from './routes'

const Dashboard = lazy(routeImports['/'] as () => Promise<{ default: React.ComponentType }>)
const Hosts = lazy(routeImports['/hosts'] as () => Promise<{ default: React.ComponentType }>)
const Srv = lazy(routeImports['/srv'] as () => Promise<{ default: React.ComponentType }>)
const Tokens = lazy(routeImports['/tokens'] as () => Promise<{ default: React.ComponentType }>)
const Logs = lazy(routeImports['/logs'] as () => Promise<{ default: React.ComponentType }>)
const Settings = lazy(routeImports['/settings'] as () => Promise<{ default: React.ComponentType }>)
const Backup = lazy(routeImports['/backup'] as () => Promise<{ default: React.ComponentType }>)

function RouteFallback() {
  return (
    <div className="flex items-center gap-2 py-10 text-slate-500">
      <i className="fa-solid fa-circle-notch fa-spin" />
      Loading…
    </div>
  )
}

export default function App() {
  useEffect(() => {
    api
      .get<{ theme?: string }>('/settings')
      .then((s) => applyTheme((s.theme as Theme) ?? 'dark'))
      .catch(() => undefined)
  }, [])

  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/hosts" element={<Hosts />} />
          <Route path="/srv" element={<Srv />} />
          <Route path="/tokens" element={<Tokens />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/backup" element={<Backup />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
