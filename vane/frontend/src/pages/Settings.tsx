import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../contexts/ToastContext'
import { applyTheme, type Theme } from '../theme'

interface SettingsDTO {
  containerName: string
  refreshInterval: string
  theme: string
  deleteRecordsOnRemoval: string
  [k: string]: string
}

const THEMES: Array<{ value: Theme; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: 'fa-sun' },
  { value: 'dark', label: 'Dark', icon: 'fa-moon' },
  { value: 'system', label: 'System', icon: 'fa-desktop' },
]

export default function Settings() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<SettingsDTO | null>(null)

  const load = async () => {
    setSettings(await api.get<SettingsDTO>('/settings'))
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!settings) return
    try {
      await api.put('/settings', {
        containerName: settings.containerName,
        refreshInterval: settings.refreshInterval,
        theme: settings.theme,
        deleteRecordsOnRemoval: settings.deleteRecordsOnRemoval,
      })
      applyTheme((settings.theme as Theme) ?? 'dark')
      toast('Settings saved.', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed.', 'error')
    }
  }

  const setTheme = (theme: Theme) => {
    if (!settings) return
    setSettings({ ...settings, theme })
    applyTheme(theme)
  }

  if (!settings) return <div className="text-slate-500">Loading settings...</div>

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

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
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Appearance</h2>
        <div>
          <label className="label">Theme</label>
          <div className="flex gap-2">
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

      <button className="btn-primary" onClick={save}>
        <i className="fa-solid fa-floppy-disk" />
        Save
      </button>
    </div>
  )
}
