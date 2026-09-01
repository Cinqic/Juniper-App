/* global URL, console */

import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tauri = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
)
const manifest = await readFile(
  new URL('../manifests/release-candidate.yaml', import.meta.url),
  'utf8',
)
const expected = packageJson.version
if (tauri.version !== expected || !manifest.includes(`version: ${expected}`)) {
  throw new Error(
    `Version mismatch: expected ${expected} across package, Tauri, and release manifest.`,
  )
}
console.log(`Version consistency passed: ${expected}`)
