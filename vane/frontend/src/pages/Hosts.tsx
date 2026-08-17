import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import type { ApiTokenDTO, CfRecord, HostDTO } from '../types'
import HostWizard from '../components/HostWizard'

interface CleanupResult {
  recordsDeleted?: number
  cleanupErrors?: string[]
}

export default function Hosts() {
  const { toast } = useToast()
  const [hosts, setHosts] = useState<HostDTO[]>([])
  const [tokens, setTokens] = useState<ApiTokenDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'fqdn' | 'recordType' | 'tokenName'>('fqdn')
  const [zoneFilter, setZoneFilter] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'compact'>(
    () => (localStorage.getItem('vane.hostsView') as 'cards' | 'compact') || 'cards',
  )
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<HostDTO | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    localStorage.setItem('vane.hostsView', viewMode)
  }, [viewMode])

  const load = async () => {
    try {
      const [h, t] = await Promise.all([api.get<HostDTO[]>('/hosts'), api.get<ApiTokenDTO[]>('/tokens')])
      setHosts(h)
      setTokens(t)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load hosts.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const reportCleanup = (res: CleanupResult | undefined) => {
    if (!res) return
    if (res.recordsDeleted) {
      toast(`Deleted ${res.recordsDeleted} Cloudflare record(s).`, 'success')
    }
    res.cleanupErrors?.forEach((e) => toast(e, 'error'))
  }

  const visible = useMemo(() => {
    const q = search.toLowerCase()
    return hosts
      .filter((h) => (zoneFilter ? h.zone === zoneFilter : true))
      .filter((h) => h.fqdn.toLowerCase().includes(q) || h.tokenName.toLowerCase().includes(q))
      .sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])))
  }, [hosts, search, sortKey, zoneFilter])

  const zones = useMemo(
    () => Array.from(new Set(hosts.map((h) => h.zone))).sort((a, b) => a.localeCompare(b)),
    [hosts],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, HostDTO[]>()
    for (const h of visible) {
      const arr = map.get(h.zone) ?? []
      arr.push(h)
      map.set(h.zone, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  const toggleZone = (zone: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(zone)) next.delete(zone)
      else next.add(zone)
      return next
    })

  const setAllCollapsed = (value: boolean) =>
    setCollapsed(value ? new Set(grouped.map(([zone]) => zone)) : new Set())


  const openAdd = () => {
    if (tokens.length === 0) {
      toast('Add an API token before creating a host.', 'error')
      return
    }
    setEditing(null)
    setWizardOpen(true)
  }

  const remove = async (h: HostDTO) => {
    if (!confirm(`Delete host ${h.fqdn}?`)) return
    const res = await api.del<CleanupResult>(`/hosts/${h.id}`)
    toast('Host deleted.', 'success')
    reportCleanup(res)
    load()
  }

  const toggle = async (h: HostDTO) => {
    const res = await api.post<CleanupResult>(`/hosts/${h.id}/toggle`)
    toast(
      `Host ${h.enabled ? 'disabled' : 'enabled'}. Click "Save & Restart DDNS" to apply.`,
      'info',
    )
    reportCleanup(res)
    load()
  }

  const duplicate = async (h: HostDTO) => {
    await api.post(`/hosts/${h.id}/duplicate`)
    toast('Host duplicated (disabled).', 'success')
    load()
  }

  const test = async (h: HostDTO) => {
    try {
      const res = await api.post<{ fqdn: string; records: CfRecord[] }>(`/hosts/${h.id}/test`)
      if (res.records.length === 0) toast(`${res.fqdn}: no records found.`, 'info')
      else toast(`${res.fqdn}: ${res.records.map((r) => `${r.type}=${r.content}`).join(', ')}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Test failed.', 'error')
    }
  }

  const applyConfig = async () => {
    setApplying(true)
    try {
      const res = await api.post<{ warnings: string[]; recreated: boolean; message: string }>('/config/apply')
      res.warnings.forEach((w) => toast(w, 'info'))
      toast(res.message, res.recreated ? 'success' : 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Apply failed.', 'error')
    } finally {
      setApplying(false)
    }
  }

  if (loading) return <div className="text-slate-500">Loading hosts…</div>

  const renderActions = (h: HostDTO, compact: boolean) => {
    const cls = compact ? 'btn-secondary !px-2' : 'btn-secondary flex-1 justify-center sm:flex-none'
    const dcls = compact ? 'btn-danger !px-2' : 'btn-danger flex-1 justify-center sm:flex-none'
    const lbl = (t: string) => (compact ? '' : t)
    return (
      <div className={`flex flex-wrap gap-1 ${compact ? 'shrink-0' : 'pt-1'}`}>
        <button className={cls} title="Edit" onClick={() => { setEditing(h); setWizardOpen(true) }}><i className="fa-solid fa-pen" />{lbl('Edit')}</button>
        <button className={cls} title="Test" onClick={() => test(h)}><i className="fa-solid fa-vial" />{lbl('Test')}</button>
        <button className={cls} title={h.enabled ? 'Disable' : 'Enable'} onClick={() => toggle(h)}><i className={`fa-solid ${h.enabled ? 'fa-pause' : 'fa-play'}`} />{lbl(h.enabled ? 'Disable' : 'Enable')}</button>
        <button className={cls} title="Duplicate" onClick={() => duplicate(h)}><i className="fa-solid fa-copy" />{lbl('Duplicate')}</button>
        <button className={dcls} title="Delete" onClick={() => remove(h)}><i className="fa-solid fa-trash" />{lbl('Delete')}</button>
      </div>
    )
  }

  const statusBadge = (h: HostDTO) => (
    <span
      className={`badge ${h.enabled
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      }`}
    >
      {h.enabled ? 'Enabled' : 'Disabled'}
    </span>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">Hosts</h1>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-secondary w-full sm:w-auto" onClick={applyConfig} disabled={applying}>
            <i className={`fa-solid fa-rocket ${applying ? 'fa-fade' : ''}`} />
            {applying ? 'Applying…' : 'Save & Restart DDNS'}
          </button>
          <button className="btn-primary w-full sm:w-auto" onClick={openAdd}>
            <i className="fa-solid fa-plus" />
            Add Host
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          className="input w-full sm:max-w-xs"
          placeholder="Search hosts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input w-full sm:max-w-xs"
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
        >
          <option value="">All zones ({hosts.length})</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <select className="input w-full sm:max-w-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
          <option value="fqdn">Sort by hostname</option>
          <option value="recordType">Sort by record type</option>
          <option value="tokenName">Sort by token</option>
        </select>
        <div className="flex items-center gap-1 sm:ml-auto">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
            <button
              className={`px-2.5 py-1.5 text-sm transition ${viewMode === 'cards' ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              title="Card view"
              onClick={() => setViewMode('cards')}
            >
              <i className="fa-solid fa-grip" />
            </button>
            <button
              className={`px-2.5 py-1.5 text-sm transition ${viewMode === 'compact' ? 'bg-brand text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              title="Compact view"
              onClick={() => setViewMode('compact')}
            >
              <i className="fa-solid fa-list" />
            </button>
          </div>
          <button className="btn-secondary" title="Collapse all" onClick={() => setAllCollapsed(true)}>
            <i className="fa-solid fa-angles-up" />
          </button>
          <button className="btn-secondary" title="Expand all" onClick={() => setAllCollapsed(false)}>
            <i className="fa-solid fa-angles-down" />
          </button>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="card text-center text-slate-500">No hosts configured yet.</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([zone, list]) => {
            const isCollapsed = collapsed.has(zone)
            return (
              <section key={zone} className="space-y-3">
                <button
                  className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 text-left shadow-card transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800"
                  onClick={() => toggleZone(zone)}
                >
                  <i className={`fa-solid fa-chevron-${isCollapsed ? 'right' : 'down'} w-3 text-xs text-slate-400 transition-transform group-hover:text-brand`} />
                  <i className="fa-solid fa-globe text-xs text-brand" />
                  <span className="font-mono font-semibold">{zone}</span>
                  <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {list.length}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {list.filter((h) => h.enabled).length} enabled
                  </span>
                </button>

                {isCollapsed ? null : viewMode === 'compact' ? (
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-card dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                    {list.map((h) => (
                      <div key={h.id} className="flex flex-col gap-2 px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-sm font-semibold">{h.fqdn}</span>
                            {statusBadge(h)}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {h.recordType} · {h.proxied ? 'Proxied' : 'DNS only'} · TTL {h.ttl === 1 ? 'Auto' : h.ttl} · {h.tokenName}
                          </div>
                        </div>
                        {renderActions(h, true)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {list.map((h) => (
                      <div key={h.id} className="card card-hover space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-mono font-semibold">{h.fqdn}</div>
                            <div className="text-xs text-slate-500">{h.description || 'No description'}</div>
                          </div>
                          {statusBadge(h)}
                        </div>
                        <dl className="grid grid-cols-1 gap-1 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                          <div>Record: <span className="font-medium">{h.recordType}</span></div>
                          <div>Proxy: <span className="font-medium">{h.proxied ? 'Yes' : 'No'}</span></div>
                          <div>TTL: <span className="font-medium">{h.ttl === 1 ? 'Auto' : h.ttl}</span></div>
                          <div>Zone: <span className="font-medium">{h.zone}</span></div>
                          <div className="sm:col-span-2">Token: <span className="font-mono">{h.tokenName} ({h.tokenMasked})</span></div>
                        </dl>
                        {renderActions(h, false)}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {wizardOpen && (
        <HostWizard
          host={editing}
          tokens={tokens}
          onClose={() => setWizardOpen(false)}
          onSaved={() => {
            setWizardOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}
