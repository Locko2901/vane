import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'

interface LogContainer {
  name: string
  tokenId: number | null
  tokenName: string | null
  state: string
}

type Layout = 'combined' | 'split'

const LAYOUT_KEY = 'logs.layout'
const AUTO_REFRESH_KEY = 'logs.autoRefresh'

function labelFor(c: LogContainer): string {
  return c.tokenName ?? c.name
}

export default function Logs() {
  const { toast } = useToast()
  const [containers, setContainers] = useState<LogContainer[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [layout, setLayout] = useState<Layout>(() =>
    localStorage.getItem(LAYOUT_KEY) === 'combined' ? 'combined' : 'split',
  )
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem(AUTO_REFRESH_KEY) !== 'false')
  const [logsByName, setLogsByName] = useState<Record<string, string>>({})
  const [initialised, setInitialised] = useState(false)

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, layout)
  }, [layout])

  useEffect(() => {
    localStorage.setItem(AUTO_REFRESH_KEY, String(autoRefresh))
  }, [autoRefresh])

  const loadContainers = async () => {
    try {
      const list = await api.get<LogContainer[]>('/logs/containers')
      setContainers(list)
      if (!initialised) {
        setSelected(list.map((c) => c.name))
        setInitialised(true)
      } else {
        setSelected((prev) => prev.filter((n) => list.some((c) => c.name === n)))
      }
    } catch {
      /* surfaced by the log load below */
    }
  }

  const activeTargets = useMemo(
    () => containers.filter((c) => selected.includes(c.name)),
    [containers, selected],
  )

  const load = async () => {
    if (activeTargets.length === 0) {
      setLogsByName({})
      return
    }
    try {
      const entries = await Promise.all(
        activeTargets.map(async (c) => {
          const params = new URLSearchParams({ tail: '500', name: c.name })
          if (search) params.set('q', search)
          const res = await api.get<{ logs: string }>(`/logs?${params.toString()}`)
          return [c.name, res.logs] as const
        }),
      )
      setLogsByName(Object.fromEntries(entries))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load logs.', 'error')
    }
  }

  useEffect(() => {
    loadContainers()
  }, [])

  useEffect(() => {
    load()
  }, [search, selected, containers])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => {
      loadContainers()
      load()
    }, 5000)
    return () => clearInterval(t)
  }, [autoRefresh, search, selected, containers])

  const toggle = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  const selectAll = () => setSelected(containers.map((c) => c.name))
  const selectNone = () => setSelected([])

  const downloadHref =
    activeTargets.length === 1
      ? `/api/logs/download?name=${encodeURIComponent(activeTargets[0].name)}`
      : '/api/logs/download'

  const combined = useMemo(
    () =>
      activeTargets
        .map((c) => `===== ${labelFor(c)} (${c.name}) =====\n${logsByName[c.name] ?? '…'}`)
        .join('\n\n'),
    [activeTargets, logsByName],
  )

  const renderBody = () => {
    if (containers.length === 0) {
      return <pre className="card bg-slate-950 font-mono text-xs text-slate-200">No DDNS instances running.</pre>
    }
    if (activeTargets.length === 0) {
      return <div className="card text-center text-sm text-slate-500">Select an instance to view its logs.</div>
    }
    if (layout === 'combined') {
      return (
        <pre className="card max-h-[70vh] overflow-auto whitespace-pre-wrap break-all bg-slate-950 font-mono text-xs text-slate-200">
          {combined || 'No log output.'}
        </pre>
      )
    }
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {activeTargets.map((c) => (
          <div key={c.name} className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                className={`h-2 w-2 rounded-full ${c.state === 'running' ? 'bg-emerald-500' : 'bg-slate-400'}`}
              />
              {labelFor(c)}
              <span className="font-mono text-xs text-slate-500">{c.name}</span>
            </div>
            <pre className="card max-h-[60vh] overflow-auto whitespace-pre-wrap break-all bg-slate-950 font-mono text-xs text-slate-200">
              {logsByName[c.name] || 'No log output.'}
            </pre>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Logs</h1>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="inline-flex w-full overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 sm:w-auto">
          {(['combined', 'split'] as Layout[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayout(l)}
              className={`px-3 py-1.5 text-sm font-medium capitalize transition ${layout === l
                ? 'bg-brand text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <i className={`fa-solid mr-1.5 ${l === 'combined' ? 'fa-align-justify' : 'fa-table-columns'}`} />
              {l}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end xl:ml-auto">
          <input
            className="input w-full sm:max-w-xs"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="flex items-center gap-1 text-sm text-slate-500">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <a className="btn-secondary w-full text-center sm:w-auto" href={downloadHref}>
            <i className="fa-solid fa-download" />
            Download
          </a>
          <button className="btn-secondary w-full sm:w-auto" onClick={load}>
            <i className="fa-solid fa-rotate-right" />
            Refresh
          </button>
        </div>
      </div>

      {containers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Instances</span>
          {containers.map((c) => {
            const active = selected.includes(c.name)
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => toggle(c.name)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${active
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}
                title={c.name}
              >
                <span
                  className={`h-2 w-2 rounded-full ${c.state === 'running' ? 'bg-emerald-500' : 'bg-slate-400'}`}
                />
                {labelFor(c)}
              </button>
            )
          })}
          <span className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />
          <button className="text-sm text-brand hover:underline" onClick={selectAll}>
            All
          </button>
          <button className="text-sm text-slate-500 hover:underline" onClick={selectNone}>
            None
          </button>
        </div>
      )}

      {renderBody()}
    </div>
  )
}
