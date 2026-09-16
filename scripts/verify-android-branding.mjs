/* global Buffer, console, process, URL */

// Proves that Android launcher branding is Juniper's in what actually ships,
// not merely that the committed source icons are intact.
//
//   node scripts/verify-android-branding.mjs project [gen/android dir]
//   node scripts/verify-android-branding.mjs apk <apk> [--package id] [--evidence file.json]
//
// `project` checks the generated Android project before Gradle runs: the
// manifest icon references, every density of the launcher, round, and adaptive
// foreground PNGs, the adaptive-icon XML, the background colour, and that no
// other resource can shadow the launcher icon.
//
// `apk` checks the built package with aapt2: package identity, launcher
// activity, the icon and round-icon resources the binary manifest references,
// the adaptive-icon XML those resolve to, and the background colour. Android
// renames and may re-encode PNGs, so shipped images are decoded and compared
// pixel by pixel with the committed Juniper derivatives (fully transparent
// pixels are ignored; any visible channel difference above 2/255 fails).
// A Tauri-default launcher icon fails both modes.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareImages, decodePng } from './lib/images.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const officialRoot = join(repoRoot, 'src-tauri/icons/android')
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
const LAUNCHER_IMAGES = ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']
const JUNIPER_BACKGROUND = '#ff000000'

const failures = []
const checks = []
const fail = (message) => failures.push(message)
const pass = (message) => checks.push(message)

async function official(density, name) {
  return decodePng(await readFile(join(officialRoot, `mipmap-${density}`, `${name}.png`)))
}

async function compareWithOfficial(label, density, name, bytes) {
  let actual
  try {
    actual = decodePng(bytes)
  } catch (error) {
    fail(`${label}: not a decodable PNG (${error.message})`)
    return
  }
  const result = compareImages(await official(density, name), actual)
  if (result.identical) pass(`${label}: matches official Juniper ${name} (${density})`)
  else fail(`${label}: is not the official Juniper ${name} for ${density} (${result.reason})`)
}

function normalizeColor(value) {
  const hex = value.trim().toLowerCase().replace(/^#/, '')
  const expanded =
    hex.length === 3 || hex.length === 4 ? [...hex].map((digit) => digit + digit).join('') : hex
  return `#${expanded.length === 6 ? `ff${expanded}` : expanded}`
}

function attribute(tag, name) {
  return tag.match(new RegExp(`android:${name}\\s*=\\s*"([^"]*)"`))?.[1]
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  )
  return nested.flat().sort()
}

function checkAdaptiveXml(label, xml) {
  const foreground = xml.match(/<foreground\b[^>]*>/)?.[0]
  const background = xml.match(/<background\b[^>]*>/)?.[0]
  if (!/<adaptive-icon\b/.test(xml) || !foreground || !background) {
    fail(`${label}: is not an adaptive icon with foreground and background`)
    return
  }
  const foregroundRef = attribute(foreground, 'drawable')
  const backgroundRef = attribute(background, 'drawable')
  if (foregroundRef === '@mipmap/ic_launcher_foreground') pass(`${label}: foreground is Juniper`)
  else
    fail(
      `${label}: foreground references ${foregroundRef}, expected @mipmap/ic_launcher_foreground`,
    )
  if (backgroundRef === '@color/ic_launcher_background') pass(`${label}: background is Juniper`)
  else
    fail(`${label}: background references ${backgroundRef}, expected @color/ic_launcher_background`)
}

async function verifyProject(projectDir) {
  const main = join(projectDir, 'app/src/main')
  const res = join(main, 'res')
  if (!existsSync(join(main, 'AndroidManifest.xml')) || !existsSync(res)) {
    fail(
      `generated Android project not found at ${projectDir}; run \`pnpm tauri android init --ci\``,
    )
    return
  }
  const manifest = await readFile(join(main, 'AndroidManifest.xml'), 'utf8')
  const application = manifest.match(/<application\b[^>]*>/s)?.[0] ?? ''
  const icon = attribute(application, 'icon')
  const roundIcon = attribute(application, 'roundIcon')
  if (icon === '@mipmap/ic_launcher')
    pass('AndroidManifest.xml: android:icon is @mipmap/ic_launcher')
  else fail(`AndroidManifest.xml: android:icon is ${icon}, expected @mipmap/ic_launcher`)
  if (roundIcon === undefined)
    pass('AndroidManifest.xml: no roundIcon override (launcher masks the adaptive icon)')
  else if (roundIcon === '@mipmap/ic_launcher_round')
    pass('AndroidManifest.xml: android:roundIcon is @mipmap/ic_launcher_round')
  else
    fail(
      `AndroidManifest.xml: android:roundIcon is ${roundIcon}, expected @mipmap/ic_launcher_round`,
    )
  if (
    /android\.intent\.action\.MAIN/.test(manifest) &&
    /android\.intent\.category\.LAUNCHER/.test(manifest)
  ) {
    pass('AndroidManifest.xml: declares a launcher activity')
  } else fail('AndroidManifest.xml: no MAIN/LAUNCHER activity')

  for (const density of DENSITIES) {
    for (const name of LAUNCHER_IMAGES) {
      const path = join(res, `mipmap-${density}`, `${name}.png`)
      if (!existsSync(path)) fail(`res/mipmap-${density}/${name}.png is missing`)
      else
        await compareWithOfficial(
          `res/mipmap-${density}/${name}.png`,
          density,
          name,
          await readFile(path),
        )
    }
  }

  const adaptive = join(res, 'mipmap-anydpi-v26/ic_launcher.xml')
  if (!existsSync(adaptive))
    fail('res/mipmap-anydpi-v26/ic_launcher.xml is missing (Juniper adaptive icon not installed)')
  else checkAdaptiveXml('res/mipmap-anydpi-v26/ic_launcher.xml', await readFile(adaptive, 'utf8'))
  const adaptiveRound = join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml')
  if (existsSync(adaptiveRound)) {
    checkAdaptiveXml(
      'res/mipmap-anydpi-v26/ic_launcher_round.xml',
      await readFile(adaptiveRound, 'utf8'),
    )
  }

  const allowed = new Set([
    ...DENSITIES.flatMap((density) =>
      LAUNCHER_IMAGES.map((name) => `mipmap-${density}/${name}.png`),
    ),
    'mipmap-anydpi-v26/ic_launcher.xml',
    'mipmap-anydpi-v26/ic_launcher_round.xml',
  ])
  const backgrounds = []
  for (const file of await listFiles(res)) {
    const path = relative(res, file).split('\\').join('/')
    const base = path.split('/').pop().replace(/\..*$/, '')
    if ((base === 'ic_launcher' || base === 'ic_launcher_round') && !allowed.has(path)) {
      fail(`res/${path}: unexpected launcher resource can shadow the Juniper icon`)
    }
    if (path.startsWith('values') && path.endsWith('.xml')) {
      const xml = await readFile(file, 'utf8')
      for (const match of xml.matchAll(
        /<color\s+name="ic_launcher_background"\s*>([^<]*)<\/color>/g,
      )) {
        backgrounds.push({ path, value: normalizeColor(match[1]) })
      }
    }
  }
  if (backgrounds.length !== 1 || backgrounds[0].path !== 'values/ic_launcher_background.xml') {
    fail(
      `ic_launcher_background colour must be defined once in values/ic_launcher_background.xml, found ${JSON.stringify(backgrounds)}`,
    )
  } else if (backgrounds[0].value !== JUNIPER_BACKGROUND) {
    fail(
      `ic_launcher_background is ${backgrounds[0].value}, expected Juniper black ${JUNIPER_BACKGROUND}`,
    )
  } else pass('values/ic_launcher_background.xml: Juniper black #000000')
}

function aapt2Path() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  const candidates = [process.env.AAPT2, sdk && join(sdk, 'build-tools/35.0.0/aapt2')].filter(
    Boolean,
  )
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found) return found
  try {
    return execFileSync('sh', ['-c', 'command -v aapt2'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error(
      'aapt2 is required: set AAPT2 or ANDROID_HOME with build-tools 35.0.0 installed.',
    )
  }
}

function parseResources(dump) {
  const resources = new Map()
  let current
  for (const line of dump.split('\n')) {
    const header = line.match(/^\s+resource (0x[0-9a-f]{8}) ([^\s]+)/)
    if (header) {
      current = { id: header[1], name: header[2], configs: [] }
      resources.set(current.id, current)
      continue
    }
    if (/^\s*type /.test(line) || /^Package /.test(line)) {
      current = undefined
      continue
    }
    const config = current && line.match(/^\s+\(([^)]*)\)\s+(.*)$/)
    if (!config) continue
    const file = config[2].match(/^\(file\) ([^\s]+)/)?.[1]
    current.configs.push({ qualifier: config[1], file, value: file ? undefined : config[2].trim() })
  }
  return resources
}

function xmlReference(tree, element, attributeName) {
  const lines = tree.split('\n')
  const start = lines.findIndex((line) => new RegExp(`^\\s*E: ${element}\\b`).test(line))
  if (start < 0) return undefined
  for (const line of lines.slice(start + 1)) {
    if (/^\s*E: /.test(line)) break
    const match = line.match(
      new RegExp(`android:${attributeName}\\(0x[0-9a-f]+\\)=@(0x[0-9a-f]{8})`),
    )
    if (match) return match[1]
  }
  return undefined
}

async function verifyApk(apk, packageName) {
  if (!existsSync(apk)) {
    fail(`APK not found: ${apk}`)
    return
  }
  const aapt2 = aapt2Path()
  const run = (...args) =>
    execFileSync(aapt2, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const entry = (path) => execFileSync('unzip', ['-p', apk, path], { maxBuffer: 64 * 1024 * 1024 })

  const badging = run('dump', 'badging', apk)
  if (badging.includes(`package: name='${packageName}'`)) pass(`APK package is ${packageName}`)
  else fail(`APK package is not ${packageName}`)
  if (badging.includes(`launchable-activity: name='${packageName}.MainActivity'`)) {
    pass(`APK launcher activity is ${packageName}.MainActivity`)
  } else fail(`APK launcher activity is not ${packageName}.MainActivity`)

  const manifestTree = run('dump', 'xmltree', '--file', 'AndroidManifest.xml', apk)
  const resources = parseResources(run('dump', 'resources', apk))
  const named = (id) => resources.get(id)
  const iconId = xmlReference(manifestTree, 'application', 'icon')
  const roundId = xmlReference(manifestTree, 'application', 'roundIcon')
  const icon = iconId && named(iconId)
  if (icon?.name === 'mipmap/ic_launcher') pass(`APK manifest icon ${iconId} is mipmap/ic_launcher`)
  else fail(`APK manifest icon ${iconId} resolves to ${icon?.name}, expected mipmap/ic_launcher`)
  if (roundId === undefined) pass('APK manifest declares no roundIcon override')
  else if (named(roundId)?.name === 'mipmap/ic_launcher_round')
    pass(`APK manifest roundIcon ${roundId} is mipmap/ic_launcher_round`)
  else
    fail(
      `APK manifest roundIcon ${roundId} resolves to ${named(roundId)?.name}, expected mipmap/ic_launcher_round`,
    )

  const byName = new Map([...resources.values()].map((resource) => [resource.name, resource]))
  for (const name of LAUNCHER_IMAGES) {
    const resource = byName.get(`mipmap/${name}`)
    if (!resource) {
      fail(`APK has no mipmap/${name} resource`)
      continue
    }
    for (const density of DENSITIES) {
      const config = resource.configs.find(
        (item) => item.qualifier.replace(/-v\d+$/, '') === density && item.file,
      )
      if (!config) fail(`APK mipmap/${name} has no ${density} image`)
      else
        await compareWithOfficial(
          `APK mipmap/${name} (${density}, ${config.file})`,
          density,
          name,
          entry(config.file),
        )
    }
  }

  const adaptive = byName
    .get('mipmap/ic_launcher')
    ?.configs.find((item) => item.qualifier === 'anydpi-v26')
  if (!adaptive?.file) {
    fail('APK mipmap/ic_launcher has no anydpi-v26 adaptive icon')
  } else {
    const tree = run('dump', 'xmltree', '--file', adaptive.file, apk)
    const foreground = named(xmlReference(tree, 'foreground', 'drawable'))
    const background = named(xmlReference(tree, 'background', 'drawable'))
    if (foreground?.name === 'mipmap/ic_launcher_foreground')
      pass(`APK adaptive icon ${adaptive.file} foreground is mipmap/ic_launcher_foreground`)
    else fail(`APK adaptive icon foreground resolves to ${foreground?.name}`)
    const color = background?.configs.find((item) => item.qualifier === '')?.value
    if (background?.name === 'color/ic_launcher_background' && color === JUNIPER_BACKGROUND) {
      pass(`APK adaptive icon background is color/ic_launcher_background ${color}`)
    } else
      fail(
        `APK adaptive icon background resolves to ${background?.name} ${color}, expected color/ic_launcher_background ${JUNIPER_BACKGROUND}`,
      )
  }
}

const [mode, target, ...rest] = process.argv.slice(2)
const option = (name, fallback) => {
  const index = rest.indexOf(name)
  return index >= 0 ? rest[index + 1] : fallback
}

if (mode === 'project') {
  await verifyProject(resolve(target ?? join(repoRoot, 'src-tauri/gen/android')))
} else if (mode === 'apk' && target) {
  await verifyApk(resolve(target), option('--package', 'com.cinqic.juniper'))
} else {
  console.error(
    'Usage: verify-android-branding.mjs project [dir] | apk <apk> [--package id] [--evidence file]',
  )
  process.exit(2)
}

const evidence = option('--evidence')
if (evidence) {
  await writeFile(
    evidence,
    Buffer.from(
      `${JSON.stringify({ mode, target: target ?? null, passed: failures.length === 0, checks, failures }, null, 2)}\n`,
    ),
  )
}
for (const check of checks) console.log(`PASS ${check}`)
for (const failure of failures) console.error(`FAIL ${failure}`)
if (failures.length > 0 || checks.length === 0) {
  console.error(`Android branding verification failed (${failures.length} failures).`)
  process.exit(1)
}
console.log(`Android branding verified in ${mode}: ${checks.length} checks passed.`)
