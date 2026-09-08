import type { CatalogArtifact, CatalogModel, DeviceCapabilities } from './model-catalog'
import type { RuntimeDescriptor, RuntimeMaturity } from '../types'

export interface RuntimeDefinition {
  id: string
  name: string
  version: string
  sourceRevision: string
  platforms: string[]
  architectures: string[]
  artifactFormats: string[]
  capabilities: string[]
  accelerator: RuntimeDescriptor['accelerator']
  maturityByPlatform: Record<string, RuntimeMaturity>
  reasonByPlatform: Record<string, string>
}

const LLAMA_CPP_REVISION = 'e107984bcffcfd701e82738092a2b000b6fda7a2'

/** Pinned definitions are metadata only; availability is always probed separately. */
export const RUNTIME_DEFINITIONS: RuntimeDefinition[] = [
  {
    id: 'llama.cpp',
    name: 'llama.cpp',
    version: LLAMA_CPP_REVISION,
    sourceRevision: LLAMA_CPP_REVISION,
    platforms: ['android', 'linux', 'windows'],
    architectures: ['arm64-v8a', 'aarch64', 'arm64', 'x86_64'],
    artifactFormats: ['GGUF'],
    capabilities: ['chat', 'streaming', 'cancellation', 'cpu'],
    accelerator: 'cpu',
    maturityByPlatform: { android: 'beta', linux: 'stable', windows: 'stable' },
    reasonByPlatform: {
      android: 'Beta until physical ARM64 execution is qualified.',
      linux: 'Juniper-owned loopback llama-server is the stable desktop path.',
      windows: 'Juniper-owned loopback llama-server is the stable desktop path.',
    },
  },
  {
    id: 'litert-lm',
    name: 'LiteRT-LM',
    version: '0.16.1',
    sourceRevision: 'v0.16.1',
    platforms: ['android', 'linux', 'windows'],
    architectures: ['arm64-v8a', 'aarch64', 'arm64', 'x86_64'],
    artifactFormats: ['.litertlm'],
    capabilities: ['chat', 'streaming', 'cancellation', 'cpu', 'accelerator-probe'],
    accelerator: 'unknown',
    maturityByPlatform: { android: 'beta', linux: 'beta', windows: 'beta' },
    reasonByPlatform: {
      android: 'Optional pinned integration; no compatible artifact is bundled.',
      linux: 'Optional native integration; no compatible artifact is bundled.',
      windows: 'Optional native integration; no compatible artifact is bundled.',
    },
  },
  {
    id: 'executorch',
    name: 'ExecuTorch',
    version: '1.4.1',
    sourceRevision: 'v1.4.1',
    platforms: ['android', 'linux', 'windows'],
    architectures: ['arm64-v8a', 'aarch64', 'arm64', 'x86_64'],
    artifactFormats: ['PTE', 'tokenizer/config bundle'],
    capabilities: ['chat', 'streaming', 'cancellation', 'cpu-xnnpack'],
    accelerator: 'cpu',
    maturityByPlatform: { android: 'beta', linux: 'beta', windows: 'beta' },
    reasonByPlatform: {
      android: 'Pinned release AAR path; LLM Java API remains experimental.',
      linux: 'Pinned release worker path; no compatible artifact is bundled.',
      windows: 'Pinned release worker path; no compatible artifact is bundled.',
    },
  },
  {
    id: 'mlc-llm',
    name: 'MLC LLM',
    version: 'source-main',
    sourceRevision: '9fa644f54b04983adea4d0168f49fc6af4a893ba',
    platforms: ['android', 'linux', 'windows'],
    architectures: ['arm64-v8a', 'aarch64', 'arm64', 'x86_64'],
    artifactFormats: ['compiled MLC bundle'],
    capabilities: ['chat', 'streaming', 'cancellation', 'vulkan-probe'],
    accelerator: 'gpu',
    maturityByPlatform: { android: 'experimental', linux: 'experimental', windows: 'experimental' },
    reasonByPlatform: {
      android: 'Requires a compiled model/runtime bundle and physical GPU qualification.',
      linux: 'Requires a compiled model/runtime bundle; not packaged in this candidate.',
      windows: 'Requires a compiled model/runtime bundle; not packaged in this candidate.',
    },
  },
  {
    id: 'onnxruntime-genai',
    name: 'ONNX Runtime GenAI',
    version: '0.15.2',
    sourceRevision: 'v0.15.2',
    platforms: ['android', 'linux', 'windows'],
    architectures: ['arm64-v8a', 'aarch64', 'arm64', 'x86_64'],
    artifactFormats: ['ONNX GenAI model bundle'],
    capabilities: ['chat', 'streaming', 'cancellation', 'cpu'],
    accelerator: 'unknown',
    maturityByPlatform: { android: 'experimental', linux: 'experimental', windows: 'experimental' },
    reasonByPlatform: {
      android: 'The pinned GenAI API is Preview and no bundle is shipped.',
      linux: 'The pinned GenAI API is Preview and no bundle is shipped.',
      windows: 'The pinned GenAI API is Preview and no bundle is shipped.',
    },
  },
]

function normalizedPlatform(os: string): string {
  const value = os.toLowerCase()
  if (value.includes('win')) return 'windows'
  if (value.includes('android')) return 'android'
  if (value.includes('linux')) return 'linux'
  return value
}

function definitionFor(id: string): RuntimeDefinition | undefined {
  return RUNTIME_DEFINITIONS.find((runtime) => runtime.id === id)
}

export function runtimeRegistryForDevice(
  device: Pick<DeviceCapabilities, 'os' | 'architecture' | 'nativeRuntimeAvailable'>,
  packagedRuntimeIds: string[] = [],
): RuntimeDescriptor[] {
  const platform = normalizedPlatform(device.os)
  return RUNTIME_DEFINITIONS.map((definition) => {
    const maturity = definition.maturityByPlatform[platform] ?? 'unavailable'
    const architectureKnown =
      device.architecture === 'unknown' || definition.architectures.includes(device.architecture)
    const nativeLlamaAvailable =
      definition.id === 'llama.cpp' && device.nativeRuntimeAvailable === true
    const packaged = packagedRuntimeIds.includes(definition.id) || nativeLlamaAvailable
    const available = architectureKnown && packaged
    return {
      id: definition.id,
      name: definition.name,
      maturity,
      state: available ? 'available' : architectureKnown ? 'unavailable' : 'not-qualified',
      version: definition.version,
      sourceRevision: definition.sourceRevision,
      platforms: definition.platforms,
      architectures: definition.architectures,
      artifactFormats: definition.artifactFormats,
      capabilities: definition.capabilities,
      accelerator: definition.accelerator,
      installed: packaged,
      reason: available
        ? definition.reasonByPlatform[platform]
        : architectureKnown
          ? (definition.reasonByPlatform[platform] ??
            'This runtime is not packaged in the candidate.')
          : `The ${device.architecture} architecture is not qualified for this runtime.`,
      qualification:
        available && maturity === 'stable'
          ? 'qualified'
          : available
            ? 'package-only'
            : 'not-qualified',
    } satisfies RuntimeDescriptor
  })
}

export function effectiveRuntimeMaturity(
  runtime: RuntimeDescriptor,
  platform: string,
): RuntimeMaturity {
  return (
    definitionFor(runtime.id)?.maturityByPlatform[normalizedPlatform(platform)] ?? runtime.maturity
  )
}

export function selectRuntime(
  model: CatalogModel,
  device: DeviceCapabilities,
  binding?: {
    runtimeId?: string
    artifactId?: string
    selection?: 'explicit' | 'recommended' | 'auto'
  },
): { runtime: RuntimeDescriptor; artifact: CatalogArtifact } | { error: string } {
  const runtimes = device.runtimes ?? runtimeRegistryForDevice(device)
  const requested = binding?.runtimeId
  const candidates = model.artifacts
    .map((artifact) => ({
      artifact,
      runtime: runtimes.find((runtime) => runtime.id === artifact.runtimeId),
    }))
    .filter((item): item is { artifact: CatalogArtifact; runtime: RuntimeDescriptor } =>
      Boolean(item.runtime),
    )
    .filter((item) => !binding?.artifactId || item.artifact.id === binding.artifactId)
    .filter((item) => !requested || item.runtime.id === requested)
    .filter((item) => item.runtime.state === 'available')
  const chosen =
    binding?.selection === 'explicit'
      ? candidates.find((item) => item.runtime.id === requested)
      : candidates[0]
  if (chosen) return chosen
  if (requested) {
    return { error: `${requested} is unavailable for this device or has no compatible artifact.` }
  }
  return { error: 'No packaged local runtime has a compatible artifact for this model.' }
}

export function canCrossLocalityWithoutAuthorization(
  from: 'on-device' | 'local-network' | 'remote' | 'unknown',
  to: 'on-device' | 'local-network' | 'remote' | 'unknown',
): boolean {
  // UNKNOWN is deliberately not treated as a local transport. A transition
  // may only remain implicit when both sides have the same known locality.
  return from !== 'unknown' && to !== 'unknown' && from === to
}
