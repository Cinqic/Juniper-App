/* global console, process, URL */

// Installs the official Juniper launcher icons into the generated Android
// project. `tauri android init` always writes Tauri's default launcher
// artwork into gen/android, and `tauri icon` only targets gen/android when it
// already exists, so the committed src-tauri/icons/android set was never part
// of a clean build. Run this after every `tauri android init` and before
// building; `scripts/verify-android-branding.mjs project` proves the result.
//
// The committed set is the unmodified `tauri icon` output for
// public/juniper-logo.png except for the adaptive background colour, which is
// Juniper black (#000000). It is copied rather than regenerated so a build can
// only ever ship the checksum-verified assets in src-tauri/icons/branding.sha256.

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = join(repoRoot, 'src-tauri/icons/android')
const projectRoot = resolve(process.argv[2] ?? join(repoRoot, 'src-tauri/gen/android'))
const resRoot = join(projectRoot, 'app/src/main/res')

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? listFiles(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  )
  return nested.flat().sort()
}

try {
  if (!(await stat(resRoot)).isDirectory()) throw new Error('not a directory')
} catch {
  console.error(
    `Generated Android resources not found at ${resRoot}. Run \`pnpm tauri android init --ci\` first.`,
  )
  process.exit(1)
}

const manifest = await readFile(join(repoRoot, 'src-tauri/icons/branding.sha256'), 'utf8')
const checksums = new Map(
  manifest
    .split('\n')
    .map((line) => line.match(/^([a-f0-9]{64}) {2}(.+)$/))
    .filter(Boolean)
    .map((match) => [match[2], match[1]]),
)

const sources = await listFiles(sourceRoot)
if (sources.length === 0) throw new Error('No committed Android branding assets were found.')
for (const source of sources) {
  const repoPath = relative(repoRoot, source).split('\\').join('/')
  const expected = checksums.get(repoPath)
  if (!expected)
    throw new Error(`Android branding asset is not in the checksum manifest: ${repoPath}`)
  const actual = createHash('sha256')
    .update(await readFile(source))
    .digest('hex')
  if (actual !== expected) throw new Error(`Android branding asset checksum mismatch: ${repoPath}`)
  const target = join(resRoot, relative(sourceRoot, source))
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}

console.log(`Installed ${sources.length} official Juniper launcher assets into ${resRoot}.`)
