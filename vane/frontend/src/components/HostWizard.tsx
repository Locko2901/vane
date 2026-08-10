import { useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import type { ApiTokenDTO, CfRecord, HostDTO } from '../types'

interface Props {
  host: HostDTO | null
  tokens: ApiTokenDTO[]
  onClose: () => void
  onSaved: () => void
}

interface ValidationResult {
  tokenValid: boolean
  zoneExists: boolean
  fqdn?: string
  message: string
  records: CfRecord[]
}

export default function HostWizard({ host, tokens, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const editing = !!host

  const [zone, setZone] = useState(host?.zone ?? '')
  const [hostname, setHostname] = useState(host?.hostname ?? '@')
  const [recordType, setRecordType] = useState<HostDTO['recordType']>(host?.recordType ?? 'A')
  const [proxied, setProxied] = useState(host?.proxied ?? true)
  const [ttlAuto, setTtlAuto] = useState((host?.ttl ?? 1) === 1)
  const [ttl, setTtl] = useState(host?.ttl && host.ttl !== 1 ? host.ttl : 300)
  const [description, setDescription] = useState(host?.description ?? '')
  const [tokenId, setTokenId] = useState<number>(host?.tokenId ?? tokens[0]?.id ?? 0)

  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [busy, setBusy] = useState(false)

  const validate = async () => {
    if (!tokenId || !zone) {
      toast('Select a token and enter a zone first.', 'error')
      return
    }
    setValidating(true)
    try {
      const result = await api.post<ValidationResult>('/hosts/validate', { tokenId, zone, hostname })
      setValidation(result)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Validation failed.', 'error')
    } finally {
      setValidating(false)
    }
  }

  const save = async () => {
    if (!tokenId) {
      toast('Please add an API token first.', 'error')
      return
    }
    setBusy(true)
    const payload = {
      zone: zone.trim(),
      hostname: hostname.trim() || '@',
      recordType,
      proxied,
      ttl: ttlAuto ? 1 : ttl,
      description: description.trim() || null,
      tokenId,
      enabled: host?.enabled ?? true,
    }
    try {
      if (editing) await api.put(`/hosts/${host.id}`, payload)
      else await api.post('/hosts', payload)
      toast(editing ? 'Host updated.' : 'Host added.', 'success')
      onSaved()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">{editing ? 'Edit Host' : 'Add Host'}</h2>

        <div className="space-y-3">
          <div>
            <label className="label">API Token</label>
            <select className="input" value={tokenId} onChange={(e) => setTokenId(Number(e.target.value))}>
              {tokens.length === 0 && <option value={0}>No tokens - add one first</option>}
              {tokens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.masked})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Zone</label>
              <input className="input" placeholder="example.com" value={zone} onChange={(e) => setZone(e.target.value)} />
            </div>
            <div>
              <label className="label">Hostname</label>
              <input className="input" placeholder="@ / sub / vpn" value={hostname} onChange={(e) => setHostname(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Record Type</label>
              <select className="input" value={recordType} onChange={(e) => setRecordType(e.target.value as HostDTO['recordType'])}>
                <option value="A">A (IPv4)</option>
                <option value="AAAA">AAAA (IPv6)</option>
                <option value="BOTH">Both</option>
              </select>
            </div>
            <div>
              <label className="label">Proxy (orange cloud)</label>
              <select className="input" value={proxied ? 'yes' : 'no'} onChange={(e) => setProxied(e.target.value === 'yes')}>
                <option value="yes">Proxied</option>
                <option value="no">DNS only</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">TTL</label>
              <select className="input" value={ttlAuto ? 'auto' : 'custom'} onChange={(e) => setTtlAuto(e.target.value === 'auto')}>
                <option value="auto">Auto</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {!ttlAuto && (
              <div>
                <label className="label">TTL (seconds)</label>
                <input
                  className="input"
                  type="number"
                  min={60}
                  max={86400}
                  value={ttl}
                  onChange={(e) => setTtl(Number(e.target.value))}
                />
              </div>
            )}
          </div>

          <div>
            <label className="label">Description (optional)</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <button className="btn-secondary w-full" onClick={validate} disabled={validating}>
            <i className={`fa-solid ${validating ? 'fa-spinner fa-spin' : 'fa-circle-check'}`} />
            {validating ? 'Validating…' : 'Validate against Cloudflare'}
          </button>

          {validation && (
            <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
              <p className={validation.tokenValid ? 'text-emerald-600' : 'text-red-600'}>
                <i className={`fa-solid ${validation.tokenValid ? 'fa-check' : 'fa-xmark'} mr-1`} />
                {validation.tokenValid ? 'Token valid' : 'Token invalid'}
              </p>
              <p className={validation.zoneExists ? 'text-emerald-600' : 'text-red-600'}>
                <i className={`fa-solid ${validation.zoneExists ? 'fa-check' : 'fa-xmark'} mr-1`} />
                {validation.zoneExists ? `Zone found (${validation.fqdn})` : 'Zone not found'}
              </p>
              {validation.records.length > 0 && (
                <div className="mt-2 text-slate-500">
                  Current records:
                  {validation.records.map((r) => (
                    <div key={r.id} className="font-mono text-xs">
                      {r.type} <i className="fa-solid fa-arrow-right-long mx-1" /> {r.content} {r.proxied ? '(proxied)' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary w-full sm:w-auto" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary w-full sm:w-auto" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
