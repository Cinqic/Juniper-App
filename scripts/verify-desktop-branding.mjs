/* global console, process, URL */

// Proves that desktop package icons are the official Juniper artwork.
//
//   node scripts/verify-desktop-branding.mjs <icon dir or file>...
//
// Directories are searched for PNG icons named juniper.png (for example a
// packaged usr/share/icons tree); files (such as an AppImage .DirIcon) are
// checked directly. Every icon must decode to the committed Juniper derivative
// of the same size in src-tauri/icons, compared pixel by pixel. Each argument
// must contribute at least one verified icon.

import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareImages, decodePng } from './lib/images.mjs'

const iconsRoot = fileURLToPath(new URL('../src-tauri/icons/', import.meta.url))
const officialFiles = ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.png']
const official = new Map()
for (const name of officialFiles) {
  const image = decodePng(await readFile(join(iconsRoot, name)))
  official.set(`${image.width}x${image.height}`, { name, image })
}

async function iconsIn(path) {
  const resolved = await realpath(path)
  if (!(await stat(resolved)).isDirectory()) return [resolved]
  const entries = await readdir(resolved, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name === 'juniper.png')
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort()
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('Usage: verify-desktop-branding.mjs <icon dir or file>...')
  process.exit(2)
}
let failures = 0
for (const target of targets) {
  const icons = await iconsIn(target)
  if (icons.length === 0) {
    console.error(`FAIL ${target}: no juniper.png icons found`)
    failures += 1
    continue
  }
  for (const icon of icons) {
    const actual = decodePng(await readFile(icon))
    const expected = official.get(`${actual.width}x${actual.height}`)
    if (!expected) {
      console.error(
        `FAIL ${icon}: ${actual.width}x${actual.height} has no official Juniper derivative`,
      )
      failures += 1
      continue
    }
    const result = compareImages(expected.image, actual)
    if (result.identical) console.log(`PASS ${icon}: matches src-tauri/icons/${expected.name}`)
    else {
      console.error(
        `FAIL ${icon}: differs from src-tauri/icons/${expected.name} (${result.reason})`,
      )
      failures += 1
    }
  }
}
if (failures > 0) {
  console.error(`Desktop branding verification failed (${failures} failures).`)
  process.exit(1)
}
console.log('Desktop branding verified: shipped icons are the official Juniper artwork.')
