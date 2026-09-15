import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNeonQuotaExceededError, resetNeonQuotaIfNeeded } from './index.js'

describe('Neon quota helpers', () => {
  const originalNeonApiKey = process.env.NEON_API_KEY
  const originalProjectId = process.env.NEON_PROJECT_ID
  const originalDbUrl = process.env.DATABASE_URL

  afterEach(() => {
    if (originalNeonApiKey === undefined) delete process.env.NEON_API_KEY
    else process.env.NEON_API_KEY = originalNeonApiKey

    if (originalProjectId === undefined) delete process.env.NEON_PROJECT_ID
    else process.env.NEON_PROJECT_ID = originalProjectId

    if (originalDbUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDbUrl

    vi.restoreAllMocks()
  })

  it('detects Neon data transfer quota failures', () => {
    expect(isNeonQuotaExceededError(new Error('data transfer quota exceeded for project'))).toBe(true)
    expect(isNeonQuotaExceededError(new Error('connection failed'))).toBe(false)
  })

  it('resets the quota through the Neon API when configured', async () => {
    process.env.NEON_API_KEY = 'test-key'
    process.env.NEON_PROJECT_ID = 'proj_test_123'

    const fetchMock = vi.spyOn(globalThis as any, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ project: { id: 'proj_test_123' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await resetNeonQuotaIfNeeded(new Error('data transfer quota exceeded'))

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://console.neon.tech/api/v2/projects/proj_test_123',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"active_time_seconds":0'),
      }),
    )
    expect((fetchMock as any).mock.calls[0]?.[1]?.body).toContain('"compute_time_seconds":0')
    expect((fetchMock as any).mock.calls[0]?.[1]?.body).toContain('"data_transfer_bytes":0')
  })
})
