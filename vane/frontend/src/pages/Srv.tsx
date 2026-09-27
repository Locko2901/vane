import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import type { ApiTokenDTO, SrvRecordDTO, SrvSyncSummary } from '../types'
import SrvForm from '../components/SrvForm'

interface CleanupResult {
  recordsDeleted?: number
  cleanupErrors?: string[]
}

const syncStyles: Record<SrvRecordDTO['syncState'], { label: string; icon: string; className: string }> = {
  ok: {
    label: 'In sync',
    icon: 'fa-check',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  pending: {
    label: 'Pending',
    icon: 'fa-clock',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  error: {
    label: 'Error',
    icon: 'fa-triangle-exclamation',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
}

function describeSync(s: SrvSyncSummary): string {
  const parts = (['created', 'adopted', 'updated', 'unchanged', 'failed'] as const)
    .filter((key) => s[key] > 0)
    .map((key) => `${s[key]} ${key}`)
  return parts.length ? `SRV sync: ${parts.join(', ')}.` : 'No enabled SRV records to sync.'
}

function syncTitle(r: SrvRecordDTO): string | undefined {
  if (r.lastError) return r.lastError
  if (r.lastSyncedAt) return `Last synced ${new Date(r.lastSyncedAt).toLocaleString()}`
  return undefined
}

export default function Srv() {
  const { toast } = useToast()
  const [records, setRecords] = useState<SrvRecordDTO[]>([])
  const [tokens, setTokens] = useState<ApiTokenDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SrvRecordDTO | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = async () => {
    try {
      const [r, t] = await Promise.all([api.get<SrvRecordDTO[]>('/srv'), api.get<ApiTokenDTO[]>('/tokens')])
      setRecords(r)
      setTokens(t)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load SRV records.', 'error')
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

  const openAdd = () => {
    if (tokens.length === 0) {
      toast('Add an API token before creating an SRV record.', 'error')
      return
    }
    setEditing(null)
    setFormOpen(true)
  }

  const remove = async (r: SrvRecordDTO) => {
    if (!confirm(`Delete SRV record ${r.fqdn}?`)) return
    const res = await api.del<CleanupResult>(`/srv/${r.id}`)
    toast('SRV record deleted.', 'success')
    reportCleanup(res)
    load()
  }

  const toggle = async (r: SrvRecordDTO) => {
    const res = await api.post<CleanupResult>(`/srv/${r.id}/toggle`)
    toast(r.enabled ? 'SRV record disabled.' : 'SRV record enabled. Click "Sync now" to publish it.', 'info')
    reportCleanup(res)
    load()
  }

  const sync = async () => {
    setSyncing(true)
    try {
      const res = await api.post<SrvSyncSummary>('/srv/sync')
      toast(describeSync(res), res.failed ? 'error' : 'success')
      load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'SRV sync failed.', 'error')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <div className="text-slate-500">Loading SRV records…</div>

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">SRV Records</h1>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-secondary w-full sm:w-auto" onClick={sync} disabled={syncing}>
            <i className={`fa-solid fa-arrows-rotate ${syncing ? 'fa-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button className="btn-primary w-full sm:w-auto" onClick={openAdd}>
            <i className="fa-solid fa-plus" />
            Add SRV Record
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500">
        An SRV record tells clients which port a service listens on, so players can join a server without
        typing <code>:port</code>. Vane writes these straight to Cloudflare; they don't go through favonia.
      </p>

      {records.length === 0 ? (
        <div className="card text-center text-slate-500">No SRV records configured yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-[860px] w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 font-medium">Name</th>
                <th className="font-medium">Target</th>
                <th className="font-medium">Priority / Weight</th>
                <th className="font-medium">TTL</th>
                <th className="font-medium">Token</th>
                <th className="font-medium">Sync</th>
                <th className="font-medium">Enabled</th>
                <th className="font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const state = syncStyles[r.syncState] ?? syncStyles.pending
                return (
                  <tr
                    key={r.id}
                    className="border-t border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-mono font-semibold">{r.fqdn}</div>
                      {r.description && <div className="max-w-xs truncate text-xs text-slate-500">{r.description}</div>}
                    </td>
                    <td className="pr-3 font-mono text-slate-600 dark:text-slate-300">{r.target}:{r.port}</td>
                    <td className="pr-3 text-slate-600 dark:text-slate-300">{r.priority} / {r.weight}</td>
                    <td className="pr-3 text-slate-600 dark:text-slate-300">{r.ttl === 1 ? 'Auto' : r.ttl}</td>
                    <td className="pr-3 text-slate-600 dark:text-slate-300">{r.tokenName}</td>
                    <td className="pr-3">
                      <span className={`badge ${state.className}`} title={syncTitle(r)}>
                        <i className={`fa-solid ${state.icon}`} />
                        {state.label}
                      </span>
                    </td>
                    <td className="pr-3">
                      <button
                        role="switch"
                        aria-checked={r.enabled}
                        aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.fqdn}`}
                        title={r.enabled ? 'Disable' : 'Enable'}
                        className={`badge cursor-pointer transition ${r.enabled
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                        onClick={() => toggle(r)}
                      >
                        <i className={`fa-solid ${r.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`} />
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button className="btn-secondary !px-2" title="Edit" aria-label={`Edit ${r.fqdn}`} onClick={() => { setEditing(r); setFormOpen(true) }}>
                          <i className="fa-solid fa-pen" />
                        </button>
                        <button className="btn-danger !px-2" title="Delete" aria-label={`Delete ${r.fqdn}`} onClick={() => remove(r)}>
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <SrvForm
          record={editing}
          tokens={tokens}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}
