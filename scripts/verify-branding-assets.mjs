/* global URL, console */

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'

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

// Source checksums alone never reached the APK: a clean `tauri android init`
// regenerates Tauri's default launcher icons. Every workflow that builds the
// Juniper APK must install and verify the official launcher set in order.
const workflowsUrl = new URL('../.github/workflows/', import.meta.url)
let androidBuildWorkflows = 0
for (const name of (await readdir(workflowsUrl)).filter((file) => file.endsWith('.yml'))) {
  const workflow = await readFile(new URL(name, workflowsUrl), 'utf8')
  const build = workflow.indexOf('tauri android build')
  if (build < 0) continue
  androidBuildWorkflows += 1
  const order = [
    ['pnpm tauri android init --ci', workflow.indexOf('pnpm tauri android init --ci')],
    ['install-android-branding.mjs', workflow.indexOf('node scripts/install-android-branding.mjs')],
    [
      'verify-android-branding.mjs project',
      workflow.indexOf('node scripts/verify-android-branding.mjs project'),
    ],
    ['tauri android build', build],
    [
      'verify-android-branding.mjs apk',
      workflow.indexOf('scripts/verify-android-branding.mjs apk'),
    ],
  ]
  for (let index = 0; index < order.length; index += 1) {
    const [step, position] = order[index]
    if (position < 0 || (index > 0 && position < order[index - 1][1])) {
      throw new Error(
        `${name}: Android launcher branding step "${step}" is missing or out of order; expected ${order.map(([label]) => label).join(' -> ')}.`,
      )
    }
  }
}
if (androidBuildWorkflows === 0) throw new Error('No workflow builds the Android APK.')

console.log(
  `Branding integrity passed: ${entries.length} official Juniper source assets verified; ` +
    `${androidBuildWorkflows} Android build workflows install and verify launcher branding. ` +
    'Shipped artifacts are verified by verify-android-branding.mjs and verify-desktop-branding.mjs.',
)
