import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from './App'
import { ToastProvider } from './contexts/ToastContext'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

const applyThemeMock = vi.hoisted(() => vi.fn())

vi.mock('./api/client', () => ({ api: apiMock }))
vi.mock('./theme', () => ({ applyTheme: applyThemeMock }))

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

    fireEvent.change(screen.getByPlaceholderText(/backup password \(min\. 8 characters\)/i), {
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
