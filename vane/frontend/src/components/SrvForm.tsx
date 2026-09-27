import { useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import type { ApiTokenDTO, SrvRecordDTO } from '../types'

interface Props {
  record: SrvRecordDTO | null
  tokens: ApiTokenDTO[]
  onClose: () => void
  onSaved: () => void
}

const stripUnderscore = (value: string) => value.trim().replace(/^_/, '').toLowerCase()

export default function SrvForm({ record, tokens, onClose, onSaved }: Props) {
  const { toast } = useToast()
  const editing = !!record

  const [tokenId, setTokenId] = useState<number>(record?.tokenId ?? tokens[0]?.id ?? 0)
  const [zone, setZone] = useState(record?.zone ?? '')
  const [hostname, setHostname] = useState(record?.hostname ?? '')
  const [service, setService] = useState(record?.service ?? 'minecraft')
  const [proto, setProto] = useState<SrvRecordDTO['proto']>(record?.proto ?? 'tcp')
  const [target, setTarget] = useState(record?.target ?? '')
  const [port, setPort] = useState(record?.port ?? 25565)
  const [priority, setPriority] = useState(record?.priority ?? 0)
  const [weight, setWeight] = useState(record?.weight ?? 0)
  const [ttlAuto, setTtlAuto] = useState((record?.ttl ?? 1) === 1)
  const [ttl, setTtl] = useState(record?.ttl && record.ttl !== 1 ? record.ttl : 300)
  const [description, setDescription] = useState(record?.description ?? '')
  const [busy, setBusy] = useState(false)

  const owner = hostname.trim() === '' || hostname.trim() === '@' ? zone.trim() : `${hostname.trim()}.${zone.trim()}`
  const preview = `_${stripUnderscore(service) || 'service'}._${proto}.${owner || 'example.com'}`.toLowerCase()

  const save = async () => {
    if (!tokenId) {
      toast('Please add an API token first.', 'error')
      return
    }
    setBusy(true)
    const payload = {
      zone: zone.trim(),
      hostname: hostname.trim() || '@',
      service: stripUnderscore(service),
      proto,
      priority,
      weight,
      port,
      target: target.trim().toLowerCase().replace(/\.$/, ''),
      ttl: ttlAuto ? 1 : ttl,
      description: description === '' ? null : description,
      tokenId,
      enabled: record?.enabled ?? true,
    }
    try {
      if (editing) await api.put(`/srv/${record.id}`, payload)
      else await api.post('/srv', payload)
      toast(`SRV record ${editing ? 'updated' : 'added'}. Click "Sync now" to publish it.`, 'success')
      onSaved()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5 shadow-pop animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 text-lg font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <i className={`fa-solid ${editing ? 'fa-pen' : 'fa-plus'} text-sm`} />
            </span>
            {editing ? 'Edit SRV Record' : 'Add SRV Record'}
          </h2>
          <button className="icon-btn text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={onClose} title="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="srv-token">API Token</label>
            <select id="srv-token" className="input" value={tokenId} onChange={(e) => setTokenId(Number(e.target.value))}>
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
              <label className="label" htmlFor="srv-zone">Zone</label>
              <input id="srv-zone" className="input" placeholder="example.com" value={zone} onChange={(e) => setZone(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="srv-hostname">Hostname</label>
              <input id="srv-hostname" className="input" placeholder="@ / skyblock" value={hostname} onChange={(e) => setHostname(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="srv-service">Service</label>
              <input id="srv-service" className="input" placeholder="minecraft" value={service} onChange={(e) => setService(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="srv-proto">Protocol</label>
              <select id="srv-proto" className="input" value={proto} onChange={(e) => setProto(e.target.value as SrvRecordDTO['proto'])}>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="tls">TLS</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="srv-target">Target</label>
              <input id="srv-target" className="input" placeholder="skyblock.example.com" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="srv-port">Port</label>
              <input id="srv-port" className="input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="srv-priority">Priority</label>
              <input id="srv-priority" className="input" type="number" min={0} max={65535} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="srv-weight">Weight</label>
              <input id="srv-weight" className="input" type="number" min={0} max={65535} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="srv-ttl-mode">TTL</label>
              <select id="srv-ttl-mode" className="input" value={ttlAuto ? 'auto' : 'custom'} onChange={(e) => setTtlAuto(e.target.value === 'auto')}>
                <option value="auto">Auto</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {!ttlAuto && (
              <div>
                <label className="label" htmlFor="srv-ttl">TTL (seconds)</label>
                <input id="srv-ttl" className="input" type="number" min={60} max={86400} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
              </div>
            )}
          </div>

          <div>
            <label className="label" htmlFor="srv-description">Description (optional)</label>
            <input id="srv-description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="surface p-3 text-sm text-slate-500">
            Record name: <span className="break-all font-mono text-slate-700 dark:text-slate-200">{preview}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:justify-end">
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
