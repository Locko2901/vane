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
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<HostDTO | null>(null)
  const [applying, setApplying] = useState(false)

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
      .filter((h) => h.fqdn.toLowerCase().includes(q) || h.tokenName.toLowerCase().includes(q))
      .sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])))
  }, [hosts, search, sortKey])

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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Hosts</h1>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <input
          className="input w-full sm:max-w-xs"
          placeholder="Search hosts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-full sm:max-w-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
          <option value="fqdn">Sort by hostname</option>
          <option value="recordType">Sort by record type</option>
          <option value="tokenName">Sort by token</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="card text-center text-slate-500">No hosts configured yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((h) => (
            <div key={h.id} className="card space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono font-semibold">{h.fqdn}</div>
                  <div className="text-xs text-slate-500">{h.description || 'No description'}</div>
                </div>
                <span
                  className={`badge ${h.enabled
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {h.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-1 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                <div>Record: <span className="font-medium">{h.recordType}</span></div>
                <div>Proxy: <span className="font-medium">{h.proxied ? 'Yes' : 'No'}</span></div>
                <div>TTL: <span className="font-medium">{h.ttl === 1 ? 'Auto' : h.ttl}</span></div>
                <div>Zone: <span className="font-medium">{h.zone}</span></div>
                <div className="sm:col-span-2">Token: <span className="font-mono">{h.tokenName} ({h.tokenMasked})</span></div>
              </dl>
              <div className="flex flex-wrap gap-1 pt-1">
                <button className="btn-secondary flex-1 justify-center sm:flex-none" onClick={() => { setEditing(h); setWizardOpen(true) }}><i className="fa-solid fa-pen" />Edit</button>
                <button className="btn-secondary flex-1 justify-center sm:flex-none" onClick={() => test(h)}><i className="fa-solid fa-vial" />Test</button>
                <button className="btn-secondary flex-1 justify-center sm:flex-none" onClick={() => toggle(h)}><i className={`fa-solid ${h.enabled ? 'fa-pause' : 'fa-play'}`} />{h.enabled ? 'Disable' : 'Enable'}</button>
                <button className="btn-secondary flex-1 justify-center sm:flex-none" onClick={() => duplicate(h)}><i className="fa-solid fa-copy" />Duplicate</button>
                <button className="btn-danger flex-1 justify-center sm:flex-none" onClick={() => remove(h)}><i className="fa-solid fa-trash" />Delete</button>
              </div>
            </div>
          ))}
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
