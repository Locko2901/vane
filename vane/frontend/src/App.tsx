import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Hosts from './pages/Hosts'
import Tokens from './pages/Tokens'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import Backup from './pages/Backup'
import { api } from './api/client'
import { applyTheme, type Theme } from './theme'

export default function App() {
  useEffect(() => {
    api
      .get<{ theme?: string }>('/settings')
      .then((s) => applyTheme((s.theme as Theme) ?? 'dark'))
      .catch(() => undefined)
  }, [])

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/hosts" element={<Hosts />} />
        <Route path="/tokens" element={<Tokens />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/backup" element={<Backup />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
