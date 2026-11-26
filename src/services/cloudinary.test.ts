import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudinary, cloudNameFromUrl, credentialsForCloud, fetchFromCloudinary } from './cloudinary.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchFromCloudinary', () => {
  it('downloads the original asset directly before trying an archive', async () => {
    const response = new Response(Buffer.from('resume bytes'))
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const archiveUrl = vi.spyOn(cloudinary.utils, 'download_archive_url')

    const result = await fetchFromCloudinary('https://res.cloudinary.com/test/raw/upload/resume.pdf', 'resumes/resume.pdf')

    expect(result.toString()).toBe('resume bytes')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://res.cloudinary.com/test/raw/upload/resume.pdf')
    expect(archiveUrl).not.toHaveBeenCalled()
  })

  it('uses the requested non-directory file from the archive when direct download fails', async () => {
    const zip = new AdmZip()
    zip.addFile('folder/', Buffer.alloc(0))
    zip.addFile('folder/other.txt', Buffer.from('not the resume'))
    zip.addFile('folder/resume.pdf', Buffer.from('resume from archive'))
    const responses = [
      new Response('Not found', { status: 404 }),
      new Response(zip.toBuffer()),
    ]
    const fetchMock = vi.fn().mockResolvedValueOnce(responses[0]).mockResolvedValueOnce(responses[1])
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test')
    vi.stubEnv('CLOUDINARY_API_KEY', 'k')
    vi.stubEnv('CLOUDINARY_API_SECRET', 's')
    vi.spyOn(cloudinary.utils, 'download_archive_url').mockReturnValue('https://api.cloudinary.com/archive.zip')

    const result = await fetchFromCloudinary('https://res.cloudinary.com/test/raw/upload/resume.pdf', 'folder/resume.pdf')

    expect(result.toString()).toBe('resume from archive')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.cloudinary.com/archive.zip')
  })

  it('keeps the timeout active while the response body is being downloaded', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('The request was aborted', 'AbortError'))
          }, { once: true })
        },
      }),
    )))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const pending = fetchFromCloudinary('https://res.cloudinary.com/test/raw/upload/resume.pdf')
    const assertion = expect(pending).rejects.toThrow('Cloudinary fetch timed out')
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('signs the archive fallback with the legacy account that owns the file', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'newacct')
    vi.stubEnv('CLOUDINARY_API_KEY', 'new-key')
    vi.stubEnv('CLOUDINARY_API_SECRET', 'new-secret')
    vi.stubEnv('CLOUDINARY_LEGACY_CLOUD_NAME', 'oldacct')
    vi.stubEnv('CLOUDINARY_LEGACY_API_KEY', 'old-key')
    vi.stubEnv('CLOUDINARY_LEGACY_API_SECRET', 'old-secret')
    const zip = new AdmZip()
    zip.addFile('resume.pdf', Buffer.from('legacy resume'))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(zip.toBuffer())))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const archiveUrl = vi.spyOn(cloudinary.utils, 'download_archive_url').mockReturnValue('https://api.cloudinary.com/archive.zip')

    const result = await fetchFromCloudinary('https://res.cloudinary.com/oldacct/raw/upload/v1/resumes/resume.pdf', 'resumes/resume.pdf')

    expect(result.toString()).toBe('legacy resume')
    expect(archiveUrl.mock.calls[0][0]).toMatchObject({ cloud_name: 'oldacct', api_key: 'old-key', api_secret: 'old-secret' })
  })

  it('reports which account is missing credentials instead of signing with the wrong one', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'newacct')
    vi.stubEnv('CLOUDINARY_API_KEY', 'new-key')
    vi.stubEnv('CLOUDINARY_API_SECRET', 'new-secret')
    vi.stubEnv('CLOUDINARY_LEGACY_CLOUD_NAME', '')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 })))
    const archiveUrl = vi.spyOn(cloudinary.utils, 'download_archive_url')

    await expect(fetchFromCloudinary('https://res.cloudinary.com/oldacct/raw/upload/resume.pdf', 'resume.pdf'))
      .rejects.toThrow('no API credentials configured for account "oldacct"')
    expect(archiveUrl).not.toHaveBeenCalled()
  })
})

describe('credential selection', () => {
  it('maps a file URL to the account that owns it', () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'newacct')
    vi.stubEnv('CLOUDINARY_API_KEY', 'a')
    vi.stubEnv('CLOUDINARY_API_SECRET', 'b')
    expect(cloudNameFromUrl('https://res.cloudinary.com/newacct/raw/upload/x.pdf')).toBe('newacct')
    expect(credentialsForCloud('newacct')?.api_key).toBe('a')
    expect(credentialsForCloud('unknown')).toBeUndefined()
  })
})
