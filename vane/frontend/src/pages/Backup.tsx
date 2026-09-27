import { useRef, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'

const MIN_PASSWORD_LENGTH = 8

interface BackupPreview {
  exportedAt: string
  tokens: string[]
  hosts: number
  srvRecords?: number
  settings: number
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export default function Backup() {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [exportPassword, setExportPassword] = useState('')
  const [exporting, setExporting] = useState(false)

  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const resetImport = () => {
    setImportFile(null)
    setImportPassword('')
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const doExport = async () => {
    if (exportPassword.length < MIN_PASSWORD_LENGTH) {
      toast(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 'error')
      return
    }
    setExporting(true)
    try {
      const res = await fetch('/api/backup/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password: exportPassword }),
      })
      if (!res.ok) {
        let message = `Export failed (${res.status})`
        try {
          const data = await res.json()
          message = data.error ?? message
        } catch (error) {
          console.error(error)
        }
        throw new Error(message)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vane-backup-${new Date().toISOString().slice(0, 10)}.bin`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast('Encrypted backup downloaded.', 'success')
      setExportPassword('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed.', 'error')
    } finally {
      setExporting(false)
    }
  }

  const doPreview = async () => {
    if (!importFile) {
      toast('Select a backup file first.', 'error')
      return
    }
    if (importPassword.length < MIN_PASSWORD_LENGTH) {
      toast('Enter the backup password.', 'error')
      return
    }
    setPreviewing(true)
    try {
      const data = toBase64(await importFile.arrayBuffer())
      const res = await api.post<BackupPreview>('/backup/preview', { password: importPassword, data })
      setPreview(res)
    } catch (err) {
      setPreview(null)
      toast(err instanceof Error ? err.message : 'Preview failed.', 'error')
    } finally {
      setPreviewing(false)
    }
  }

  const doRestore = async () => {
    if (!importFile) return
    setRestoring(true)
    try {
      const data = toBase64(await importFile.arrayBuffer())
      const res = await api.post<{ tokens: number; hosts: number; srvRecords?: number }>('/backup/import', {
        password: importPassword,
        data,
      })
      toast(
        res.srvRecords
          ? `Restored ${res.tokens} token(s), ${res.hosts} host(s) and ${res.srvRecords} SRV record(s).`
          : `Restored ${res.tokens} token(s) and ${res.hosts} host(s).`,
        'success',
      )
      resetImport()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Restore failed.', 'error')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="w-full max-w-xl space-y-6">
      <h1 className="page-title">Backup &amp; Restore</h1>

      <div className="card space-y-3">
        <h2 className="font-semibold">Export encrypted backup</h2>
        <p className="text-sm text-slate-500">
          Bundles all tokens, hosts, SRV records and settings into a single <code>.bin</code> file, encrypted
          with your password (Argon2id + AES-256-GCM). The file contains your API tokens, so keep it
          and the password safe.
        </p>
        <input
          className="input"
          type="password"
          placeholder={`Backup password (min. ${MIN_PASSWORD_LENGTH} characters)`}
          autoComplete="new-password"
          value={exportPassword}
          onChange={(e) => setExportPassword(e.target.value)}
        />
        <button className="btn-primary w-full sm:w-auto" onClick={doExport} disabled={exporting}>
          <i className={`fa-solid fa-download ${exporting ? 'fa-fade' : ''}`} />
          {exporting ? 'Encrypting…' : 'Export encrypted backup'}
        </button>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Import backup</h2>
        <p className="text-sm text-slate-500">
          Restoring <strong>replaces</strong> all current tokens, hosts and SRV records with the contents of the
          backup. Preview first to confirm what it contains.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".bin,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null
            setImportFile(file)
            setPreview(null)
          }}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button className="btn-secondary w-full sm:w-auto" onClick={() => fileRef.current?.click()}>
            <i className="fa-solid fa-file-arrow-up" />
            {importFile ? 'Change file' : 'Choose .bin file'}
          </button>
          {importFile && <span className="text-sm text-slate-500 truncate">{importFile.name}</span>}
        </div>
        <input
          className="input"
          type="password"
          placeholder="Backup password"
          autoComplete="off"
          value={importPassword}
          onChange={(e) => {
            setImportPassword(e.target.value)
            setPreview(null)
          }}
        />

        {preview && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <p className="font-medium">Backup contents</p>
            <ul className="mt-1 space-y-0.5 text-slate-500">
              <li>Exported: {new Date(preview.exportedAt).toLocaleString()}</li>
              <li>
                Tokens ({preview.tokens.length}): {preview.tokens.join(', ') || '—'}
              </li>
              <li>Hosts: {preview.hosts}</li>
              <li>SRV records: {preview.srvRecords ?? 0}</li>
              <li>Settings: {preview.settings}</li>
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="btn-secondary w-full sm:w-auto"
            onClick={doPreview}
            disabled={previewing || !importFile || !importPassword}
          >
            <i className={`fa-solid fa-eye ${previewing ? 'fa-fade' : ''}`} />
            {previewing ? 'Reading…' : 'Preview'}
          </button>
          <button
            className="btn-danger w-full sm:w-auto"
            onClick={doRestore}
            disabled={restoring || !preview}
            title={preview ? undefined : 'Preview the backup first'}
          >
            <i className={`fa-solid fa-upload ${restoring ? 'fa-fade' : ''}`} />
            {restoring ? 'Restoring…' : 'Restore backup'}
          </button>
        </div>
      </div>
    </div>
  )
}

