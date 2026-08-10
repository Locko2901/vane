import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import type { HealthReport } from '../types'

const NONE = 'Not detected'

const stateColors: Record<string, string> = {
  running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  restarting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  stopped: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  exited: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  missing: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

interface SettingsDTO {
  refreshInterval?: string
  [k: string]: string | undefined
}

export default function Dashboard() {
  const { toast } = useToast()
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const intervalRef = useRef(15000)

  const load = async () => {
    try {
      setHealth(await api.get<HealthReport>('/dashboard'))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load dashboard.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api
      .get<SettingsDTO>('/settings')
      .then((s) => {
        const seconds = Number(s.refreshInterval)
        if (Number.isFinite(seconds) && seconds > 0) intervalRef.current = Math.max(5, seconds) * 1000
      })
      .catch(() => undefined)

    load()
    const t = setInterval(() => load(), intervalRef.current)
    return () => clearInterval(t)
  }, [])

  const restart = async () => {
    setRestarting(true)
    try {
      await api.post('/config/restart')
      toast('Restart requested.', 'success')
      setTimeout(load, 2000)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restart failed.', 'error')
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button className="btn-secondary w-full sm:w-auto" onClick={restart} disabled={restarting || loading}>
          <i className={`fa-solid fa-rotate-right ${restarting ? 'fa-spin' : ''}`} />
          {restarting ? 'Restarting...' : 'Restart DDNS'}
        </button>
      </div>

      {loading || !health ? (
        <DashboardSkeleton />
      ) : (
        <>
          {health.banners.map((b, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${b.level === 'ok'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                : b.level === 'warn'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
              }`}
            >
              <i
                className={`fa-solid ${b.level === 'ok'
                  ? 'fa-circle-check'
                  : b.level === 'warn'
                    ? 'fa-triangle-exclamation'
                    : 'fa-circle-xmark'
                }`}
              />
              {b.message}
            </div>
          ))}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="DDNS Instances" icon="fa-server">
              {health.containers.length === 0 ? (
                <span className="text-base font-normal text-slate-400">None</span>
              ) : (
                <span>
                  {health.containers.filter((c) => c.state === 'running').length}/{health.containers.length}
                  <span className="ml-1 text-base font-normal text-slate-400">running</span>
                </span>
              )}
            </Stat>
            <Stat label="Public IPv4" icon="fa-network-wired">
              <span className={`break-all font-mono ${health.publicIPv4 ? '' : 'text-base font-normal text-slate-400'}`}>
                {health.publicIPv4 ?? NONE}
              </span>
            </Stat>
            <Stat label="Public IPv6" icon="fa-network-wired">
              <span className={`break-all font-mono text-base ${health.publicIPv6 ? '' : 'font-normal text-slate-400'}`}>
                {health.publicIPv6 ?? NONE}
              </span>
            </Stat>
            <Stat label="Configured Domains" icon="fa-globe">
              {health.domainCount}
            </Stat>
          </div>

          {health.containers.length > 0 && (
            <div className="card">
              <h2 className="mb-3 text-lg font-semibold">DDNS Instances</h2>
              <div className="space-y-2">
                {health.containers.map((c) => (
                  <div
                    key={c.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">
                        {c.tokenName ?? <span className="text-amber-600 dark:text-amber-400">Removed token</span>}
                      </div>
                      <div className="truncate font-mono text-xs text-slate-500">{c.name}</div>
                    </div>
                    <span className={`badge ${stateColors[c.state] ?? 'bg-slate-200 text-slate-700'}`}>
                      {c.state}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="mb-3 text-lg font-semibold">Record Health</h2>
            {health.records.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-500">
                <i className="fa-solid fa-circle-info text-2xl" />
                <p className="text-sm">No enabled hosts to check.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[720px] w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 font-medium">Hostname</th>
                      <th className="font-medium">Type</th>
                      <th className="font-medium">Expected IP</th>
                      <th className="font-medium">Cloudflare Value</th>
                      <th className="font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.records.map((r, i) => (
                      <tr
                        key={i}
                        className="border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2.5 font-mono">{r.hostname}</td>
                        <td>
                          <span className="badge bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            {r.type}
                          </span>
                        </td>
                        <td className="font-mono text-slate-600 dark:text-slate-300">{r.expected ?? NONE}</td>
                        <td className="font-mono text-slate-600 dark:text-slate-300">{r.cloudflareValue ?? NONE}</td>
                        <td>
                          <span
                            className={`badge ${r.updateNeeded
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            }`}
                          >
                            <i className={`fa-solid mr-1 ${r.updateNeeded ? 'fa-arrows-rotate' : 'fa-check'}`} />
                            {r.updateNeeded ? 'Update needed' : 'In sync'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        <i className={`fa-solid ${icon}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{children}</div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-12 rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card">
            <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="mt-3 h-7 w-32 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        ))}
      </div>
      <div className="card space-y-3">
        <div className="h-5 w-32 rounded bg-slate-200 dark:bg-slate-800" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-6 w-full rounded bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
    </div>
  )
}
