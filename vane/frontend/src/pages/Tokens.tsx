import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import type { ApiTokenDTO } from '../types'

interface TokenValidation {
  valid: boolean
  zonesAccessible: boolean
  zones: Array<{ id: string; name: string }>
  message: string
}

export default function Tokens() {
  const { toast } = useToast()
  const [tokens, setTokens] = useState<ApiTokenDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [adding, setAdding] = useState(false)

  const load = async () => {
    try {
      setTokens(await api.get<ApiTokenDTO[]>('/tokens'))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load tokens.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    if (!name.trim() || !secret.trim()) {
      toast('Name and token are required.', 'error')
      return
    }
    setAdding(true)
    try {
      await api.post('/tokens', { name: name.trim(), token: secret.trim() })
      toast('Token added.', 'success')
      setName('')
      setSecret('')
      load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to add token.', 'error')
    } finally {
      setAdding(false)
    }
  }

  const rename = async (t: ApiTokenDTO) => {
    const next = prompt('New name for token:', t.name)
    if (!next || next === t.name) return
    await api.patch(`/tokens/${t.id}`, { name: next })
    load()
  }

  const remove = async (t: ApiTokenDTO) => {
    if (!confirm(`Delete token "${t.name}"?`)) return
    try {
      await api.del(`/tokens/${t.id}`)
      toast('Token deleted.', 'success')
      load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed.', 'error')
    }
  }

  const test = async (t: ApiTokenDTO) => {
    try {
      const res = await api.post<TokenValidation>(`/tokens/${t.id}/test`)
      toast(`${t.name}: ${res.message}`, res.valid ? 'success' : 'error')
      load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Test failed.', 'error')
    }
  }

  if (loading) return <div className="text-slate-500">Loading tokens…</div>

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Cloudflare API Tokens</h1>

      <div className="card space-y-3">
        <h2 className="font-semibold">Add token</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input className="input" placeholder="Name (e.g. Personal)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="input sm:col-span-2"
            placeholder="Cloudflare API token"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={add} disabled={adding}>
          <i className="fa-solid fa-plus" />
          {adding ? 'Adding…' : 'Add Token'}
        </button>
        <p className="text-xs text-slate-500">
          Tokens are encrypted with AES-256-GCM before storage and never displayed in full.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {tokens.map((t) => (
          <div key={t.id} className="card space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{t.name}</div>
              {t.lastValid !== null && (
                <span
                  className={`badge ${t.lastValid
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  }`}
                >
                  {t.lastValid ? 'Valid' : 'Invalid'}
                </span>
              )}
            </div>
            <div className="font-mono text-sm text-slate-500">{t.masked}</div>
            <div className="text-xs text-slate-500">{t.hostCount} host(s)</div>
            <div className="flex gap-1 pt-1">
              <button className="btn-secondary" onClick={() => test(t)}><i className="fa-solid fa-vial" />Test</button>
              <button className="btn-secondary" onClick={() => rename(t)}><i className="fa-solid fa-pen" />Rename</button>
              <button className="btn-danger" onClick={() => remove(t)}><i className="fa-solid fa-trash" />Delete</button>
            </div>
          </div>
        ))}
        {tokens.length === 0 && <div className="card text-slate-500">No tokens yet.</div>}
      </div>
    </div>
  )
}
