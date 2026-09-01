import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new globalThis.URL('../schemas/', import.meta.url)
const rootPath = fileURLToPath(root)
const dirs = await readdir(root, { withFileTypes: true })
let checked = 0
for (const dir of dirs) {
  if (!dir.isDirectory()) continue
  const files = await readdir(new globalThis.URL(`${dir.name}/`, root))
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const raw = await readFile(join(rootPath, dir.name, file), 'utf8')
    JSON.parse(raw)
    checked += 1
  }
}
globalThis.console.log(`Validated ${checked} JSON schemas for syntactic correctness.`)
