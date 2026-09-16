/* global Buffer, console, process */

// Decides whether a window capture shows a rendered interface.
//
//   node scripts/analyze-window-capture.mjs <capture.xwd|capture.png> <evidence.png> [--rows top,bottom]
//
// X11 captures come from `xwd`; Android captures are `screencap -p` PNGs, where
// --rows limits analysis to the app content between two height fractions so
// the system status and navigation bars cannot make a blank app look rendered.
//
// Exit 0: rendered. Exit 3: blank or dead surface (one dominant flat colour or
// almost no distinct colours across a 64x64 sample grid). The PNG is always
// written so a failing run leaves visual evidence.

import { readFile, writeFile } from 'node:fs/promises'
import { decodePng, decodeXwd, encodePng, renderStatistics } from './lib/images.mjs'

const MIN_DISTINCT_COLORS = 16
const MAX_DOMINANT_FRACTION = 0.95

const [capturePath, pngPath, rowsFlag, rowsValue] = process.argv.slice(2)
if (!capturePath || !pngPath || (rowsFlag && rowsFlag !== '--rows')) {
  console.error(
    'Usage: analyze-window-capture.mjs <capture.xwd|capture.png> <evidence.png> [--rows top,bottom]',
  )
  process.exit(2)
}

const bytes = await readFile(capturePath)
let image = capturePath.endsWith('.png') ? decodePng(bytes) : decodeXwd(bytes)
if (rowsValue) {
  const [top, bottom] = rowsValue
    .split(',')
    .map((value) => Math.round(Number(value) * image.height))
  const height = bottom - top
  const pixels = Buffer.alloc(image.width * height * 4)
  image.pixels.copy(pixels, 0, top * image.width * 4, bottom * image.width * 4)
  image = { width: image.width, height, pixels }
}
if (!capturePath.endsWith('.png') || rowsValue) await writeFile(pngPath, encodePng(image))
const statistics = renderStatistics(image)
const rendered =
  statistics.distinctColors >= MIN_DISTINCT_COLORS &&
  statistics.dominantColorFraction <= MAX_DOMINANT_FRACTION
console.log(JSON.stringify({ ...statistics, rendered }))
process.exit(rendered ? 0 : 3)
