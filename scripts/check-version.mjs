/* global URL, console */

import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tauri = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
)
const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8')
const commands = await readFile(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8')
const runtime = await readFile(new URL('../src/lib/runtime.ts', import.meta.url), 'utf8')
const manifest = await readFile(
  new URL('../manifests/release-candidate.yaml', import.meta.url),
  'utf8',
)
const expected = packageJson.version
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"$/m)?.[1]
const versionLabel = 'Juniper ' + expected
const diagnosticsMatch = commands.includes(versionLabel) && runtime.includes(versionLabel)
if (
  tauri.version !== expected ||
  cargoVersion !== expected ||
  !diagnosticsMatch ||
  !manifest.includes(`version: ${expected}`)
) {
  throw new Error(
    `Version mismatch: expected ${expected} across package, Cargo, Tauri, and release manifest.`,
  )
}
console.log(`Version consistency passed: ${expected}`)
