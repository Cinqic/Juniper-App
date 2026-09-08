/* global URL, console */

import { readFile } from 'node:fs/promises'

const files = new Map(
  await Promise.all(
    [
      'LICENSE',
      'package.json',
      'src-tauri/Cargo.toml',
      'src-tauri/plugins/juniper-local/Cargo.toml',
      'src-tauri/tauri.conf.json',
      'manifests/release-candidate.yaml',
      'README.md',
      'THIRD_PARTY_NOTICES.md',
      '.github/workflows/release.yml',
    ].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')]),
  ),
)

const packageJson = JSON.parse(files.get('package.json'))
const tauri = JSON.parse(files.get('src-tauri/tauri.conf.json'))
const required = [
  ['package.json', packageJson.license === 'Apache-2.0'],
  [
    'src-tauri/Cargo.toml',
    /^license\s*=\s*"Apache-2\.0"$/m.test(files.get('src-tauri/Cargo.toml')),
  ],
  [
    'src-tauri/plugins/juniper-local/Cargo.toml',
    /^license\s*=\s*"Apache-2\.0"$/m.test(files.get('src-tauri/plugins/juniper-local/Cargo.toml')),
  ],
  [
    'manifests/release-candidate.yaml',
    /^project_license:\s*Apache-2\.0$/m.test(files.get('manifests/release-candidate.yaml')),
  ],
  [
    'src-tauri/tauri.conf.json',
    tauri.bundle?.resources?.['../LICENSE'] === 'LICENSE' &&
      tauri.bundle?.resources?.['../THIRD_PARTY_NOTICES.md'] === 'THIRD_PARTY_NOTICES.md',
  ],
  ['README.md', /released under the Apache License, Version 2\.0/.test(files.get('README.md'))],
  [
    'THIRD_PARTY_NOTICES.md',
    /Juniper is licensed under Apache License 2\.0/.test(files.get('THIRD_PARTY_NOTICES.md')) &&
      /Copyright \(c\) 2023-2026 The ggml authors/.test(files.get('THIRD_PARTY_NOTICES.md')) &&
      /Copyright 2024-2026 Arm Limited/.test(files.get('THIRD_PARTY_NOTICES.md')),
  ],
  [
    '.github/workflows/release.yml',
    /echo 'License: Apache-2\.0'/.test(files.get('.github/workflows/release.yml')) &&
      /release-artifacts\/LICENSE/.test(files.get('.github/workflows/release.yml')) &&
      /release-artifacts\/THIRD_PARTY_NOTICES\.md/.test(files.get('.github/workflows/release.yml')),
  ],
]

const license = files.get('LICENSE')
if (
  !license.startsWith('                                 Apache License\n') ||
  !license.includes('Version 2.0, January 2004') ||
  !license.includes('END OF TERMS AND CONDITIONS')
) {
  throw new Error('LICENSE is not the complete canonical Apache License 2.0 text.')
}

const failures = required.filter(([, valid]) => !valid).map(([path]) => path)
if (failures.length > 0) {
  throw new Error(`Project Apache-2.0 metadata mismatch: ${failures.join(', ')}`)
}

// Third-party MIT declarations are intentionally allowed. Reject only current-facing
// statements that claim Juniper itself is MIT-licensed.
for (const [path, contents] of files) {
  if (/Juniper (?:is|itself is) (?:an )?MIT[- ]licensed|License:\s*MIT/.test(contents)) {
    throw new Error(`Stale Juniper project-license claim in ${path}.`)
  }
}

console.log('Project license consistency passed: Apache-2.0')
