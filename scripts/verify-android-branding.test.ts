import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodePng, encodePng } from './lib/images.mjs'

const repoRoot = join(import.meta.dirname, '..')
const verifier = join(repoRoot, 'scripts/verify-android-branding.mjs')
const installer = join(repoRoot, 'scripts/install-android-branding.mjs')
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']

// Mirrors what `tauri android init` generates: a launcher manifest and
// launcher PNGs that are not Juniper's, with no adaptive icon.
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`

function wrongIcon(path: string) {
  const { width, height } = decodePng(readFileSync(path))
  const pixels = Buffer.alloc(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4)
    pixels.set([0x24, 0xc8, 0xdb, 255], offset)
  return encodePng({ width, height, pixels })
}

function run(script: string, project: string) {
  const args = script === verifier ? ['project', project] : [project]
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('Android launcher branding gate', () => {
  let project: string
  let res: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'juniper-android-branding-'))
    res = join(project, 'app/src/main/res')
    mkdirSync(join(project, 'app/src/main'), { recursive: true })
    writeFileSync(join(project, 'app/src/main/AndroidManifest.xml'), manifest)
    for (const density of densities) {
      mkdirSync(join(res, `mipmap-${density}`), { recursive: true })
      for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
        const official = join(repoRoot, `src-tauri/icons/android/mipmap-${density}/${name}.png`)
        writeFileSync(join(res, `mipmap-${density}/${name}.png`), wrongIcon(official))
      }
    }
    mkdirSync(join(res, 'values'), { recursive: true })
    writeFileSync(
      join(res, 'values/colors.xml'),
      '<resources><color name="black">#FF000000</color></resources>',
    )
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  it('rejects a freshly initialized project whose branding step was skipped', () => {
    const result = run(verifier, project)
    expect(result.status).toBe(1)
    expect(result.output).toContain('is not the official Juniper ic_launcher')
    expect(result.output).toContain('mipmap-anydpi-v26/ic_launcher.xml is missing')
  })

  it('accepts the project after the official branding is installed', () => {
    expect(run(installer, project).status).toBe(0)
    const result = run(verifier, project)
    expect(result.output).not.toContain('FAIL')
    expect(result.status).toBe(0)
  })

  describe('after installation', () => {
    beforeEach(() => {
      expect(run(installer, project).status).toBe(0)
    })

    it.each([
      ['foreground', 'xxhdpi', 'ic_launcher_foreground'],
      ['round icon', 'mdpi', 'ic_launcher_round'],
      ['legacy icon', 'xxxhdpi', 'ic_launcher'],
    ])('rejects a wrong %s image', (_label, density, name) => {
      const path = join(res, `mipmap-${density}/${name}.png`)
      writeFileSync(path, wrongIcon(path))
      const result = run(verifier, project)
      expect(result.status).toBe(1)
      expect(result.output).toContain(`FAIL res/mipmap-${density}/${name}.png`)
    })

    it('rejects adaptive-icon XML that references the wrong foreground', () => {
      const path = join(res, 'mipmap-anydpi-v26/ic_launcher.xml')
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace(
          '@mipmap/ic_launcher_foreground',
          '@drawable/ic_launcher_foreground',
        ),
      )
      const result = run(verifier, project)
      expect(result.status).toBe(1)
      expect(result.output).toContain('foreground references @drawable/ic_launcher_foreground')
    })

    it('rejects a non-Juniper adaptive background colour', () => {
      writeFileSync(
        join(res, 'values/ic_launcher_background.xml'),
        '<resources>\n  <color name="ic_launcher_background">#fff</color>\n</resources>',
      )
      const result = run(verifier, project)
      expect(result.status).toBe(1)
      expect(result.output).toContain('expected Juniper black')
    })

    it('rejects a manifest that points at an unexpected icon', () => {
      const path = join(project, 'app/src/main/AndroidManifest.xml')
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace('@mipmap/ic_launcher"', '@drawable/tauri_icon"'),
      )
      const result = run(verifier, project)
      expect(result.status).toBe(1)
      expect(result.output).toContain('android:icon is @drawable/tauri_icon')
    })

    it('rejects a round icon override that is not Juniper', () => {
      const path = join(project, 'app/src/main/AndroidManifest.xml')
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace(
          'android:label=',
          'android:roundIcon="@mipmap/other_round"\n        android:label=',
        ),
      )
      const result = run(verifier, project)
      expect(result.status).toBe(1)
      expect(result.output).toContain('android:roundIcon is @mipmap/other_round')
    })

    it('rejects another launcher resource that can shadow the Juniper icon', () => {
      mkdirSync(join(res, 'mipmap-anydpi'), { recursive: true })
      writeFileSync(join(res, 'mipmap-anydpi/ic_launcher.xml'), '<adaptive-icon />')
      const result = run(verifier, project)
      expect(result.status).toBe(1)
      expect(result.output).toContain(
        'res/mipmap-anydpi/ic_launcher.xml: unexpected launcher resource',
      )
    })

    it('keeps the committed assets byte-identical when installing', () => {
      for (const density of densities) {
        const installed = readFileSync(join(res, `mipmap-${density}/ic_launcher.png`))
        expect(
          installed.equals(
            readFileSync(
              join(repoRoot, `src-tauri/icons/android/mipmap-${density}/ic_launcher.png`),
            ),
          ),
        ).toBe(true)
      }
      cpSync(join(res, 'mipmap-anydpi-v26'), join(project, 'copy-check'), { recursive: true })
    })
  })
})
