import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'

const fetchMock = vi.fn()

describe('api client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends GET requests with same-origin credentials', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Vane' })))

    await expect(api.get<{ name: string }>('/settings')).resolves.toEqual({ name: 'Vane' })

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
      method: 'GET',
      headers: undefined,
      body: undefined,
      credentials: 'same-origin',
    })
  })

  it('serializes request bodies as JSON', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 7 })))

    await expect(api.post<{ id: number }>('/tokens', { token: 'secret' })).resolves.toEqual({ id: 7 })

    expect(fetchMock).toHaveBeenCalledWith('/api/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'secret' }),
      credentials: 'same-origin',
    })
  })

  it('returns undefined for empty successful responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(api.del<void>('/tokens/7')).resolves.toBeUndefined()
  })

  it('uses the API error message when a request fails', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Token is invalid' }), { status: 400 }),
    )

    await expect(api.post('/tokens', {})).rejects.toThrow('Token is invalid')
  })
})
