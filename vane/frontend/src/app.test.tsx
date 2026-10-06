import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from './App'
import { ApiError } from './api/client'
import { ToastProvider } from './contexts/ToastContext'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

const applyThemeMock = vi.hoisted(() => vi.fn())

vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: apiMock,
}))
vi.mock('./theme', () => ({ applyTheme: applyThemeMock }))

interface ScheduleFixture {
  effective: string | null
  source: 'environment' | 'setting' | 'default'
  setting: string | null
  environment: string | null
  readOnly: boolean
  warnings: string[]
}

const defaultSchedule: ScheduleFixture = {
  effective: null,
  source: 'default',
  setting: null,
  environment: null,
  readOnly: false,
  warnings: [],
}

function mockSettingsPage(schedule: Partial<ScheduleFixture> = {}) {
  apiMock.get.mockImplementation((url: string) => {
    if (url === '/settings') {
      return Promise.resolve({
        containerName: 'cloudflare-ddns',
        refreshInterval: '15',
        theme: 'dark',
        deleteRecordsOnRemoval: 'false',
        syncProxyStatus: 'true',
      })
    }
    if (url === '/settings/update-schedule') return Promise.resolve({ ...defaultSchedule, ...schedule })
    throw new Error(`Unexpected GET ${url}`)
  })
}

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.post.mockReset()
  apiMock.put.mockReset()
  apiMock.patch.mockReset()
  apiMock.del.mockReset()
  applyThemeMock.mockReset()
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('main UI flows', () => {
  it('loads the dashboard and can request a restart', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') {
        return Promise.resolve({ refreshInterval: '5', theme: 'dark' })
      }
      if (url === '/dashboard') {
        return Promise.resolve({
          containers: [{ name: 'cloudflare-ddns-t1', tokenId: 1, tokenName: 'Home', exists: true, state: 'running', status: 'running' }],
          publicIPv4: '203.0.113.10',
          publicIPv6: null,
          domainCount: 3,
          banners: [{ level: 'ok', message: 'Everything healthy.' }],
          records: [{ hostname: 'home.example.com', type: 'A', expected: '203.0.113.10', cloudflareValue: '203.0.113.10', updateNeeded: false }],
        })
      }
      throw new Error(`Unexpected GET ${url}`)
    })
    apiMock.post.mockResolvedValue({ ok: true })

    renderApp('/')

    expect(await screen.findByText('Everything healthy.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /restart ddns/i }))

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/config/restart'))
    expect(await screen.findByText('Restart requested.')).toBeTruthy()
    expect(applyThemeMock).toHaveBeenCalledWith('dark')
  })

  it('can add and validate a host from the hosts page', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') return Promise.resolve({ theme: 'dark' })
      if (url === '/hosts') return Promise.resolve([])
      if (url === '/tokens') {
        return Promise.resolve([{ id: 7, name: 'Personal', masked: 'abcd****wxyz', lastValid: null, lastChecked: null, hostCount: 0 }])
      }
      throw new Error(`Unexpected GET ${url}`)
    })
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/hosts/validate') {
        return Promise.resolve({
          tokenValid: true,
          zoneExists: true,
          fqdn: 'vpn.example.com',
          message: 'Token and zone valid.',
          records: [{ id: '1', type: 'A', name: 'vpn.example.com', content: '203.0.113.10', proxied: true, ttl: 1 }],
        })
      }
      if (url === '/hosts') return Promise.resolve({ id: 12 })
      throw new Error(`Unexpected POST ${url}`)
    })

    renderApp('/hosts')

    fireEvent.click(await screen.findByRole('button', { name: /add host/i }))
    fireEvent.change(screen.getByPlaceholderText('example.com'), { target: { value: 'example.com' } })
    fireEvent.change(screen.getByPlaceholderText('@ / sub / vpn'), { target: { value: 'vpn' } })
    fireEvent.click(screen.getByRole('button', { name: /validate against cloudflare/i }))

    expect(await screen.findByText('Token valid')).toBeTruthy()
    expect(screen.getByText('Zone found (vpn.example.com)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/hosts', expect.objectContaining({
      zone: 'example.com',
      hostname: 'vpn',
      tokenId: 7,
    })))
    expect(await screen.findByText('Host added.')).toBeTruthy()
  })

  it('can add and test tokens on the tokens page', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') return Promise.resolve({ theme: 'light' })
      if (url === '/tokens') {
        return Promise.resolve([{ id: 1, name: 'Work', masked: 'abcd****wxyz', lastValid: null, lastChecked: null, hostCount: 1 }])
      }
      throw new Error(`Unexpected GET ${url}`)
    })
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/tokens') return Promise.resolve({ id: 2, name: 'Home' })
      if (url === '/tokens/1/test') return Promise.resolve({ valid: true, zonesAccessible: true, zones: [], message: 'Token is valid.' })
      throw new Error(`Unexpected POST ${url}`)
    })

    renderApp('/tokens')

    fireEvent.click(await screen.findByRole('button', { name: /test/i }))
    expect(await screen.findByText('Work: Token is valid.')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Name (e.g. Personal)'), { target: { value: 'Home' } })
    fireEvent.change(screen.getByPlaceholderText('Cloudflare API token'), { target: { value: 'super-secret-token' } })
    fireEvent.click(screen.getByRole('button', { name: /add token/i }))

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/tokens', {
      name: 'Home',
      token: 'super-secret-token',
    }))
    expect(await screen.findByText('Token added.')).toBeTruthy()
  })

  it('can change settings and save the active theme', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') {
        return Promise.resolve({
          containerName: 'cloudflare-ddns',
          refreshInterval: '15',
          theme: 'system',
          deleteRecordsOnRemoval: 'true',
        })
      }
      if (url === '/settings/update-schedule') return Promise.resolve(defaultSchedule)
      throw new Error(`Unexpected GET ${url}`)
    })
    apiMock.put.mockResolvedValue({ ok: true })

    renderApp('/settings')

    fireEvent.click(await screen.findByRole('button', { name: /dark/i }))
    fireEvent.change(screen.getByDisplayValue('cloudflare-ddns'), { target: { value: 'vane-ddns' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith('/settings', {
      containerName: 'vane-ddns',
      refreshInterval: '15',
      theme: 'dark',
      deleteRecordsOnRemoval: 'true',
    }))
    expect(applyThemeMock).toHaveBeenCalledWith('dark')
    expect(await screen.findByText('Settings saved.')).toBeTruthy()
  })

  it('saves a new update schedule and reports the recreated instances', async () => {
    mockSettingsPage()
    apiMock.put.mockResolvedValue({
      ok: true,
      apply: { ok: true, instances: 2, message: 'cloudflare-ddns-t1 started. cloudflare-ddns-t2 started.', warnings: [] },
    })

    renderApp('/settings')

    fireEvent.change(await screen.findByLabelText('Update schedule'), { target: { value: ' @every 1m ' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith('/settings', expect.objectContaining({
      theme: 'dark',
      updateCron: '@every 1m',
    })))
    expect(await screen.findByText('cloudflare-ddns-t1 started. cloudflare-ddns-t2 started.')).toBeTruthy()
  })

  it('shows why the API refused a schedule next to the field', async () => {
    mockSettingsPage()
    const reason = '"@every 30s" is not supported. Give a whole number of minutes or hours, at least 1 minute: for example @every 1m or @every 2h.'
    apiMock.put.mockRejectedValue(new ApiError(reason, 422))

    renderApp('/settings')

    const input = await screen.findByLabelText<HTMLInputElement>('Update schedule')
    fireEvent.change(input, { target: { value: '@every 30s' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect((await screen.findByRole('alert')).textContent).toBe(reason)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.value).toBe('@every 30s')
  })

  it('shows the schedule read-only while DDNS_UPDATE_CRON sets it', async () => {
    mockSettingsPage({ effective: '@every 1m', source: 'environment', environment: '@every 1m', readOnly: true })
    apiMock.put.mockResolvedValue({ ok: true })

    renderApp('/settings')

    const input = await screen.findByLabelText<HTMLInputElement>('Update schedule')
    expect(input.disabled).toBe(true)
    expect(input.value).toBe('@every 1m')
    expect(screen.getByText("Set by the container's environment (DDNS_UPDATE_CRON).")).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(apiMock.put).toHaveBeenCalled())
    expect(apiMock.put.mock.calls[0][1]).not.toHaveProperty('updateCron')
  })

  it('warns when DDNS_UPDATE_CRON is ignored', async () => {
    const warning = 'DDNS_UPDATE_CRON is ignored: "@once" would stop favonia from updating your records.'
    mockSettingsPage({ environment: '@once', warnings: [warning] })

    renderApp('/settings')

    expect(await screen.findByText(warning)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Update schedule').disabled).toBe(false)
  })

  it('lists SRV records with their sync state', async () => {
    const base = {
      zone: 'lockoo.dev', service: 'minecraft', proto: 'tcp', priority: 0, weight: 0, target: 'skyblock.lockoo.dev', ttl: 1,
      description: null, enabled: true, tokenId: 7, tokenName: 'Personal', cfRecordId: null, lastError: null, lastSyncedAt: null,
    }
    const refused = '2 SRV records exist at _minecraft._tcp.creative.lockoo.dev; remove the extras in Cloudflare.'
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') return Promise.resolve({ theme: 'dark' })
      if (url === '/tokens') return Promise.resolve([])
      if (url === '/srv') {
        return Promise.resolve([
          { ...base, id: 1, hostname: 'skyblock', fqdn: '_minecraft._tcp.skyblock.lockoo.dev', port: 25566, description: '[vanander] 17d9', cfRecordId: 'cf-1', syncState: 'ok', lastSyncedAt: '2026-09-27T12:00:00.000Z' },
          { ...base, id: 2, hostname: 'lobby', fqdn: '_minecraft._tcp.lobby.lockoo.dev', port: 25567, enabled: false, syncState: 'pending' },
          { ...base, id: 3, hostname: 'creative', fqdn: '_minecraft._tcp.creative.lockoo.dev', port: 25568, priority: 10, weight: 5, ttl: 300, syncState: 'error', lastError: refused },
        ])
      }
      throw new Error(`Unexpected GET ${url}`)
    })

    renderApp('/srv')

    expect(await screen.findByText('_minecraft._tcp.skyblock.lockoo.dev')).toBeTruthy()
    expect(screen.getByText('[vanander] 17d9')).toBeTruthy()
    expect(screen.getByText('skyblock.lockoo.dev:25566')).toBeTruthy()
    expect(screen.getByText('10 / 5')).toBeTruthy()
    expect(screen.getByText('300')).toBeTruthy()
    expect(screen.getByText('In sync')).toBeTruthy()
    expect(screen.getByText('Pending')).toBeTruthy()
    expect(screen.getByText('Error').getAttribute('title')).toBe(refused)
    expect(screen.getByRole('switch', { name: 'Disable _minecraft._tcp.skyblock.lockoo.dev' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Enable _minecraft._tcp.lobby.lockoo.dev' }).getAttribute('aria-checked')).toBe('false')
  })

  it('posts a normalized SRV record from the form', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') return Promise.resolve({ theme: 'dark' })
      if (url === '/srv') return Promise.resolve([])
      if (url === '/tokens') {
        return Promise.resolve([{ id: 7, name: 'Personal', masked: 'abcd****wxyz', lastValid: null, lastChecked: null, hostCount: 0, srvCount: 0 }])
      }
      throw new Error(`Unexpected GET ${url}`)
    })
    apiMock.post.mockResolvedValue({ id: 12 })

    renderApp('/srv')

    fireEvent.click(await screen.findByRole('button', { name: /add srv record/i }))
    fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'lockoo.dev' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'skyblock' } })
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: '_Minecraft' } })
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'SkyBlock.Lockoo.Dev.' } })
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '25566' } })
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: '[vanander] 17d9 ' } })

    expect(screen.getByText('_minecraft._tcp.skyblock.lockoo.dev')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/srv', {
      zone: 'lockoo.dev',
      hostname: 'skyblock',
      service: 'minecraft',
      proto: 'tcp',
      priority: 0,
      weight: 0,
      port: 25566,
      target: 'skyblock.lockoo.dev',
      ttl: 1,
      description: '[vanander] 17d9 ',
      tokenId: 7,
      enabled: true,
    }))
    expect(await screen.findByText('SRV record added. Click "Sync now" to publish it.')).toBeTruthy()
  })

  it('syncs SRV records on demand', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') return Promise.resolve({ theme: 'dark' })
      if (url === '/srv' || url === '/tokens') return Promise.resolve([])
      throw new Error(`Unexpected GET ${url}`)
    })
    apiMock.post.mockResolvedValue({ created: 1, adopted: 0, updated: 0, unchanged: 2, failed: 0, errors: [] })

    renderApp('/srv')

    fireEvent.click(await screen.findByRole('button', { name: /sync now/i }))

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/srv/sync'))
    expect(await screen.findByText('SRV sync: 1 created, 2 unchanged.')).toBeTruthy()
  })

  it('can export, preview and restore a backup', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Blob(['backup-data'], { type: 'application/octet-stream' }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    apiMock.get.mockImplementation((url: string) => {
      if (url === '/settings') return Promise.resolve({ theme: 'dark' })
      throw new Error(`Unexpected GET ${url}`)
    })
    apiMock.post.mockImplementation((url: string) => {
      if (url === '/backup/preview') {
        return Promise.resolve({ exportedAt: '2026-08-10T00:00:00.000Z', tokens: ['Personal'], hosts: 1, settings: 2 })
      }
      if (url === '/backup/import') {
        return Promise.resolve({ tokens: 1, hosts: 1 })
      }
      throw new Error(`Unexpected POST ${url}`)
    })

    renderApp('/backup')

    fireEvent.change(await screen.findByPlaceholderText(/backup password \(min\. 8 characters\)/i), {
      target: { value: 'super-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: /export encrypted backup/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/backup/export', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    })))
    expect(clickSpy).toHaveBeenCalled()
    expect(createObjectUrlSpy).toHaveBeenCalled()
    expect(revokeObjectUrlSpy).toHaveBeenCalled()

    const fileInput = document.querySelector('input[type="file"]')!
    const backupFile = Object.assign(new File(['backup-file'], 'vane-backup.bin', { type: 'application/octet-stream' }), {
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('backup-file').buffer),
    })
    fireEvent.change(fileInput, { target: { files: [backupFile] } })
    fireEvent.change(screen.getByPlaceholderText('Backup password'), { target: { value: 'super-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/backup/preview', expect.objectContaining({
      password: 'super-secret',
    })))
    expect(await screen.findByText(/Tokens \(1\): Personal/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /restore backup/i }))

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/backup/import', expect.objectContaining({
      password: 'super-secret',
    })))
    expect(await screen.findByText('Restored 1 token(s) and 1 host(s).')).toBeTruthy()
  })
})
