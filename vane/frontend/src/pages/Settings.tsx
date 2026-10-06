import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import { applyTheme, type Theme } from '../theme'

interface SettingsDTO {
  containerName: string
  refreshInterval: string
  theme: string
  deleteRecordsOnRemoval: string
  syncProxyStatus: string
  [k: string]: string
}

interface UpdateScheduleDTO {
  effective: string | null
  source: 'environment' | 'setting' | 'default'
  setting: string | null
  environment: string | null
  readOnly: boolean
  warnings: string[]
}

interface SaveResult {
  ok: boolean
  apply?: { ok: boolean; instances: number; message: string; warnings: string[] }
}

const THEMES: Array<{ value: Theme; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: 'fa-sun' },
  { value: 'dark', label: 'Dark', icon: 'fa-moon' },
  { value: 'system', label: 'System', icon: 'fa-desktop' },
]

export default function Settings() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<SettingsDTO | null>(null)
  const [schedule, setSchedule] = useState<UpdateScheduleDTO | null>(null)
  const [updateCron, setUpdateCron] = useState('')
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  const load = async () => {
    api.get<UpdateScheduleDTO>('/settings/update-schedule')
      .then((next) => {
        setSchedule(next)
        setUpdateCron(next.setting ?? '')
      })
      .catch(() => undefined)
    setSettings(await api.get<SettingsDTO>('/settings'))
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!settings) return
    const body: Record<string, string> = {
      containerName: settings.containerName,
      refreshInterval: settings.refreshInterval,
      theme: settings.theme,
      deleteRecordsOnRemoval: settings.deleteRecordsOnRemoval,
      syncProxyStatus: settings.syncProxyStatus,
    }
    const scheduleChanged = !!schedule && !schedule.readOnly && updateCron.trim() !== (schedule.setting ?? '')
    if (scheduleChanged) body.updateCron = updateCron.trim()
    try {
      const res = await api.put<SaveResult>('/settings', body)
      applyTheme((settings.theme as Theme) ?? 'dark')
      setScheduleError(null)
      toast('Settings saved.', 'success')
      if (res?.apply) {
        const { ok, instances, message, warnings } = res.apply
        warnings.forEach((w) => toast(w, 'info'))
        if (!ok) toast(message, 'error')
        else toast(message, instances ? 'success' : 'info')
      }
      if (scheduleChanged) await load()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed.'
      if (scheduleChanged && err instanceof ApiError && (err.status === 422 || err.status === 409)) {
        setScheduleError(message)
      }
      toast(message, 'error')
    }
  }

  const setTheme = (theme: Theme) => {
    if (!settings) return
    setSettings({ ...settings, theme })
    applyTheme(theme)
  }

  if (!settings) return <div className="text-slate-500">Loading settings...</div>

  return (
    <div className="w-full max-w-xl space-y-6">
      <h1 className="page-title">Settings</h1>

      <div className="card space-y-3">
        <h2 className="font-semibold">DDNS</h2>
        <div>
          <label className="label">Container name</label>
          <input
            className="input"
            value={settings.containerName}
            onChange={(e) => setSettings({ ...settings, containerName: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-500">
            Must match DDNS_CONTAINER in docker-compose. Changing here is informational; restart the manager to apply.
          </p>
        </div>
        {schedule && (
          <div>
            <label className="label" htmlFor="update-cron">Update schedule</label>
            <input
              id="update-cron"
              className="input font-mono disabled:cursor-not-allowed disabled:opacity-60"
              value={schedule.readOnly ? (schedule.environment ?? '') : updateCron}
              disabled={schedule.readOnly}
              placeholder="@every 5m (favonia's default)"
              aria-invalid={scheduleError ? true : undefined}
              onChange={(e) => {
                setUpdateCron(e.target.value)
                setScheduleError(null)
              }}
            />
            {scheduleError && (
              <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{scheduleError}</p>
            )}
            {schedule.readOnly ? (
              <p className="mt-1 text-xs text-slate-500">
                Set by the container&apos;s environment (DDNS_UPDATE_CRON).
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                How often each DDNS instance checks your public IP and updates Cloudflare. Leave empty for
                favonia&apos;s default (every 5 minutes). Use <code>@every &lt;n&gt;m</code> or{' '}
                <code>@every &lt;n&gt;h</code> (at least 1 minute) or a 5-field cron expression such as{' '}
                <code>*/2 * * * *</code>. Saving a new schedule applies the configuration and recreates the
                DDNS instances.
              </p>
            )}
            {schedule.warnings.map((w) => (
              <p
                key={w}
                className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              >
                <i className="fa-solid fa-triangle-exclamation mr-1" />
                {w}
              </p>
            ))}
          </div>
        )}
        <div>
          <label className="label">Dashboard refresh interval (seconds)</label>
          <input
            className="input"
            type="number"
            min={5}
            value={settings.refreshInterval}
            onChange={(e) => setSettings({ ...settings, refreshInterval: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-500">
            How often the dashboard re-checks container and record health. Minimum 5 seconds.
          </p>
        </div>
        <div>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-brand"
              checked={settings.deleteRecordsOnRemoval === 'true'}
              onChange={(e) =>
                setSettings({ ...settings, deleteRecordsOnRemoval: e.target.checked ? 'true' : 'false' })
              }
            />
            <span>
              <span className="label">Delete Cloudflare records on removal</span>
              <p className="mt-1 text-xs text-slate-500">
                When a host is deleted or disabled, also remove its app-managed A/AAAA records from
                Cloudflare. Leave off to keep the last known DNS value.
              </p>
            </span>
          </label>
        </div>
        <div>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-brand"
              checked={settings.syncProxyStatus !== 'false'}
              onChange={(e) =>
                setSettings({ ...settings, syncProxyStatus: e.target.checked ? 'true' : 'false' })
              }
            />
            <span>
              <span className="label">Sync proxy status on apply</span>
              <p className="mt-1 text-xs text-slate-500">
                On every apply, push each host&apos;s proxy toggle onto its existing Cloudflare
                records. Leave off to only set proxy status when a record is first created.
              </p>
            </span>
          </label>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Appearance</h2>
        <div>
          <label className="label">Theme</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={`flex flex-1 flex-col items-center gap-1 rounded-lg border px-3 py-3 text-sm font-medium transition ${settings.theme === t.value
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <i className={`fa-solid ${t.icon} text-lg`} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className="btn-primary w-full sm:w-auto" onClick={save}>
        <i className="fa-solid fa-floppy-disk" />
        Save
      </button>
    </div>
  )
}
