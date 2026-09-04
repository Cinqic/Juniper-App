/* global URL, console */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const manifestUrl = new URL('../src-tauri/icons/branding.sha256', import.meta.url)
const manifest = await readFile(manifestUrl, 'utf8')
const entries = manifest
  .trim()
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .map((line) => {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/)
    if (!match) throw new Error(`Invalid branding checksum entry: ${line}`)
    return { checksum: match[1], path: match[2] }
  })

if (entries.length < 40) throw new Error('Branding manifest is incomplete.')

for (const { checksum, path } of entries) {
  const contents = await readFile(new URL(`../${path}`, import.meta.url))
  const actual = createHash('sha256').update(contents).digest('hex')
  if (actual !== checksum) throw new Error(`Branding asset checksum mismatch: ${path}`)
}

const background = await readFile(
  new URL('../src-tauri/icons/android/values/ic_launcher_background.xml', import.meta.url),
  'utf8',
)
if (!background.includes('<color name="ic_launcher_background">#000000</color>')) {
  throw new Error('Android adaptive icon background must use Juniper black (#000000).')
}

console.log(`Branding integrity passed: ${entries.length} official Juniper assets verified.`)
