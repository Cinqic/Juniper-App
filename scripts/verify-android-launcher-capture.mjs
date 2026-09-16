/* global Buffer, console, process */

// Checks the launcher icon Android actually drew for Juniper.
//
//   node scripts/verify-android-launcher-capture.mjs <screencap.png> "[x1,y1][x2,y2]" <crop.png>
//
// The bounds come from `uiautomator dump` for the launcher entry labelled
// Juniper. The icon occupies the square at the top of those bounds. The crop is
// saved as evidence and classified by colour signature: Juniper's launcher is
// green line art on black, Tauri's default is yellow and cyan rings. This is
// supplementary to scripts/verify-android-branding.mjs, which proves the APK's
// launcher resources pixel by pixel; it shows that the launcher rendered them.

import { readFile, writeFile } from 'node:fs/promises'
import { decodePng, encodePng } from './lib/images.mjs'

const [screenshotPath, bounds, cropPath] = process.argv.slice(2)
const match = bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)
if (!screenshotPath || !match || !cropPath) {
  console.error(
    'Usage: verify-android-launcher-capture.mjs <screencap.png> "[x1,y1][x2,y2]" <crop.png>',
  )
  process.exit(2)
}
const [x1, y1, x2] = match.slice(1, 4).map(Number)
const screen = decodePng(await readFile(screenshotPath))
const size = Math.min(x2 - x1, screen.height - y1)
const crop = { width: size, height: size, pixels: Buffer.alloc(size * size * 4) }
for (let row = 0; row < size; row += 1) {
  const start = ((y1 + row) * screen.width + x1) * 4
  screen.pixels.copy(crop.pixels, row * size * 4, start, start + size * 4)
}
await writeFile(cropPath, encodePng(crop))

let juniperGreen = 0
let nearBlack = 0
let tauriYellow = 0
let tauriCyan = 0
const total = size * size
for (let offset = 0; offset < crop.pixels.length; offset += 4) {
  const [red, green, blue] = crop.pixels.subarray(offset, offset + 3)
  if (green > 140 && red < 150 && blue < 120 && green - Math.max(red, blue) > 60) juniperGreen += 1
  if (red < 40 && green < 40 && blue < 40) nearBlack += 1
  if (red > 220 && green > 150 && blue < 110) tauriYellow += 1
  if (red < 90 && green > 170 && blue > 180) tauriCyan += 1
}
const fraction = (count) => Number((count / total).toFixed(4))
const signature = {
  bounds,
  cropSize: size,
  juniperGreen: fraction(juniperGreen),
  nearBlack: fraction(nearBlack),
  tauriYellow: fraction(tauriYellow),
  tauriCyan: fraction(tauriCyan),
}
const juniper =
  signature.juniperGreen >= 0.01 &&
  signature.nearBlack >= 0.15 &&
  signature.tauriYellow < 0.005 &&
  signature.tauriCyan < 0.005
console.log(JSON.stringify({ ...signature, juniper }))
process.exit(juniper ? 0 : 1)
