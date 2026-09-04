/* global URL, console, process */

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
const releaseTag = process.env.RELEASE_TAG
if (releaseTag && releaseTag !== `v${expected}`) {
  throw new Error(`Release tag mismatch: expected v${expected}, received ${releaseTag}.`)
}
const expectedAndroidVersionCodes = new Map([
  ['0.3.0-rc.7', 3007],
  ['0.3.0-rc.8', 3008],
  ['0.3.0-rc.9', 3009],
])
const expectedMsiVersions = new Map([
  ['0.3.0-rc.7', '0.3.0.7'],
  ['0.3.0-rc.8', '0.3.0.8'],
  ['0.3.0-rc.9', '0.3.0.9'],
])
const androidVersionCode = tauri.bundle?.android?.versionCode
if (androidVersionCode !== expectedAndroidVersionCodes.get(expected)) {
  throw new Error(
    `Android versionCode mismatch: ${expected} must use ${expectedAndroidVersionCodes.get(expected)}.`,
  )
}
const msiVersion = tauri.bundle?.windows?.wix?.version
if (msiVersion !== expectedMsiVersions.get(expected)) {
  throw new Error(
    `MSI version mismatch: ${expected} must use Windows Installer version ${expectedMsiVersions.get(expected)}.`,
  )
}
console.log(`Version consistency passed: ${expected}`)
