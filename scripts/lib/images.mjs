/* global Buffer */

// Dependency-free image helpers for release verification. They decode the
// formats the release gates inspect (PNG launcher and desktop icons, X11 XWD
// window dumps) into RGBA so gates compare what ships pixel by pixel instead
// of trusting file names or source checksums.

import { deflateSync, inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const toLeft = Math.abs(estimate - left)
  const toUp = Math.abs(estimate - up)
  const toUpLeft = Math.abs(estimate - upLeft)
  if (toLeft <= toUp && toLeft <= toUpLeft) return left
  return toUp <= toUpLeft ? up : upLeft
}

/** Decodes a non-interlaced 8-bit PNG (gray, RGB, palette, gray+alpha, RGBA). */
export function decodePng(bytes) {
  if (!Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE)) throw new Error('Not a PNG file.')
  let offset = 8
  let header
  let palette
  let transparency
  const data = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    offset += length + 12
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') transparency = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
  }
  if (!header) throw new Error('PNG has no IHDR chunk.')
  const { width, height, bitDepth, colorType, interlace } = header
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG encoding: bit depth ${bitDepth}, interlace ${interlace}.`)
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}.`)
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  for (let row = 0; row < height; row += 1) {
    const start = row * (stride + 1)
    const filter = raw[start]
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride))
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? line[index - channels] : 0
      const up = previous[index]
      const upLeft = index >= channels ? previous[index - channels] : 0
      if (filter === 1) line[index] = (line[index] + left) & 0xff
      else if (filter === 2) line[index] = (line[index] + up) & 0xff
      else if (filter === 3) line[index] = (line[index] + ((left + up) >> 1)) & 0xff
      else if (filter === 4) line[index] = (line[index] + paeth(left, up, upLeft)) & 0xff
      else if (filter !== 0) throw new Error(`Invalid PNG filter ${filter}.`)
    }
    for (let column = 0; column < width; column += 1) {
      const source = column * channels
      const target = (row * width + column) * 4
      let red
      let green
      let blue
      let alpha = 255
      if (colorType === 0 || colorType === 4) {
        red = green = blue = line[source]
        if (colorType === 4) alpha = line[source + 1]
      } else if (colorType === 3) {
        const entry = line[source]
        if (!palette || entry * 3 + 2 >= palette.length)
          throw new Error('PNG palette index out of range.')
        red = palette[entry * 3]
        green = palette[entry * 3 + 1]
        blue = palette[entry * 3 + 2]
        if (transparency && entry < transparency.length) alpha = transparency[entry]
      } else {
        red = line[source]
        green = line[source + 1]
        blue = line[source + 2]
        if (colorType === 6) alpha = line[source + 3]
      }
      pixels[target] = red
      pixels[target + 1] = green
      pixels[target + 2] = blue
      pixels[target + 3] = alpha
    }
    previous = line
  }
  return { width, height, pixels }
}

export function encodePng({ width, height, pixels }) {
  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed))
    return Buffer.concat([length, typed, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row += 1) {
    pixels.copy(rows, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Compares two decoded images pixel by pixel. Fully transparent pixels match
 * regardless of their hidden color, so lossless re-encoding (for example
 * Android's PNG crunching) is tolerated while any visible difference is not.
 */
export function compareImages(expected, actual, { channelTolerance = 2 } = {}) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      identical: false,
      reason: `size ${actual.width}x${actual.height} != ${expected.width}x${expected.height}`,
    }
  }
  let differing = 0
  for (let offset = 0; offset < expected.pixels.length; offset += 4) {
    const expectedAlpha = expected.pixels[offset + 3]
    const actualAlpha = actual.pixels[offset + 3]
    if (expectedAlpha === 0 && actualAlpha === 0) continue
    for (let channel = 0; channel < 4; channel += 1) {
      if (
        Math.abs(expected.pixels[offset + channel] - actual.pixels[offset + channel]) >
        channelTolerance
      ) {
        differing += 1
        break
      }
    }
  }
  return {
    identical: differing === 0,
    reason: differing === 0 ? 'pixels match' : `${differing} visible pixels differ`,
  }
}

/** Decodes a ZPixmap TrueColor XWD dump as produced by `xwd -id <window>`. */
export function decodeXwd(bytes) {
  const field = (index) => bytes.readUInt32BE(index * 4)
  const headerSize = field(0)
  if (field(1) !== 7 || field(2) !== 2) throw new Error('Unsupported XWD version or pixmap format.')
  const width = field(4)
  const height = field(5)
  const byteOrder = field(7)
  const bitsPerPixel = field(11)
  const bytesPerLine = field(12)
  const masks = [field(14), field(15), field(16)]
  const colorCount = field(19)
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error(`Unsupported XWD depth: ${bitsPerPixel} bits per pixel.`)
  }
  const shifts = masks.map((mask) => {
    let shift = 0
    while (mask && !((mask >>> shift) & 1)) shift += 1
    return shift
  })
  const bytesPerPixel = bitsPerPixel / 8
  const dataStart = headerSize + colorCount * 12
  const pixels = Buffer.alloc(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const source = dataStart + row * bytesPerLine + column * bytesPerPixel
      let value = 0
      for (let index = 0; index < bytesPerPixel; index += 1) {
        const byte = bytes[source + index]
        value = byteOrder === 0 ? value + byte * 2 ** (8 * index) : value * 256 + byte
      }
      const target = (row * width + column) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[target + channel] = (value & masks[channel]) >>> shifts[channel]
      }
      pixels[target + 3] = 255
    }
  }
  return { width, height, pixels }
}

/**
 * Summarizes whether a rendered window has visible structure. A dead or blank
 * WebKit surface is one flat color; a rendered Juniper interface has text,
 * borders, and artwork spread across the window.
 */
export function renderStatistics({ width, height, pixels }, grid = 64) {
  const counts = new Map()
  let samples = 0
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      const column = Math.min(width - 1, Math.floor(((x + 0.5) * width) / grid))
      const row = Math.min(height - 1, Math.floor(((y + 0.5) * height) / grid))
      const offset = (row * width + column) * 4
      const key = (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]
      counts.set(key, (counts.get(key) ?? 0) + 1)
      samples += 1
    }
  }
  const dominant = Math.max(...counts.values())
  return {
    width,
    height,
    sampledPixels: samples,
    distinctColors: counts.size,
    dominantColorFraction: Number((dominant / samples).toFixed(4)),
  }
}
