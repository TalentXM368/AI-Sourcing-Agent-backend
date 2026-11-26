import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { findLocalResumePath, readLocalResume, recordIdFrom } from './local-resume-store.js'

const dir = mkdtempSync(join(tmpdir(), 'resumes-'))
mkdirSync(join(dir, 'batch2'))
writeFileSync(join(dir, '654774000017356006_Juan_Felipe.pdf'), 'juan')
writeFileSync(join(dir, 'batch2', '654774000017154333_Benjamín.pdf'), 'benjamin')
writeFileSync(join(dir, 'batch2', 'Rahul Sharma CV 654774000018154721.docx'), 'rahul')
writeFileSync(join(dir, 'notes.xlsx'), 'ignored')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('local resume store', () => {
  it('matches the stored URL by file name', () => {
    const url = 'https://res.cloudinary.com/dluwum789/raw/upload/v1789044270/candidates/Resumes/654774000017356006_Juan_Felipe.pdf'
    expect(readLocalResume(url, dir)?.bytes.toString()).toBe('juan')
  })

  it('decodes URL-encoded names and searches sub-folders', () => {
    const url = 'https://res.cloudinary.com/dluwum789/raw/upload/v1/candidates/Resumes/654774000017154333_Benjam%C3%ADn.pdf'
    expect(readLocalResume(url, dir)?.bytes.toString()).toBe('benjamin')
  })

  it('falls back to the Zoho record id when the file was renamed', () => {
    const url = 'https://res.cloudinary.com/dluwum789/raw/upload/v1/candidates/Resumes/654774000018154721_Rahul.pdf'
    expect(readLocalResume(url, dir)?.bytes.toString()).toBe('rahul')
  })

  it('returns nothing for unknown files or without a folder', () => {
    expect(findLocalResumePath('https://x/654774000099999999_Nobody.pdf', dir)).toBeUndefined()
    expect(findLocalResumePath('https://x/654774000017356006_Juan_Felipe.pdf', '')).toBeUndefined()
    expect(recordIdFrom('2019_2021_resume.pdf')).toBeUndefined()
  })
})
