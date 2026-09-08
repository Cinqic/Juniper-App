import { describe, expect, it } from 'vitest'
import {
  MODEL_CATALOG,
  parseCatalog,
  recommendModel,
  recommendModels,
  type DeviceCapabilities,
} from './model-catalog'

const device: DeviceCapabilities = {
  os: 'linux',
  deviceName: 'Test machine',
  architecture: 'x86_64',
  cpuArchitecture: 'x86_64',
  logicalCores: 8,
  totalMemoryBytes: 16 * 1024 ** 3,
  availableMemoryBytes: 8 * 1024 ** 3,
  memoryPressure: 'low',
  totalStorageBytes: 500 * 1024 ** 3,
  freeStorageBytes: 20 * 1024 ** 3,
  modelDirectory: '/models',
  gpu: 'unknown',
  acceleration: 'unknown',
}

describe('model catalog', () => {
  it('ships four under-1B models with verified HTTPS variants', () => {
    expect(MODEL_CATALOG.models).toHaveLength(4)
    expect(MODEL_CATALOG.models.every((model) => model.parameterCount < 1_000_000_000)).toBe(true)
    for (const model of MODEL_CATALOG.models) {
      expect(model.variants[0]?.url).toMatch(/^https:\/\//)
      expect(model.variants[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(model.license).toBe('Apache-2.0')
    }
  })

  it('rejects duplicate ids, malformed hashes, and non-HTTPS variants', () => {
    const malformed = structuredClone(MODEL_CATALOG) as unknown as Record<string, unknown>
    malformed.models = [
      {
        ...MODEL_CATALOG.models[0],
        variants: [
          { ...MODEL_CATALOG.models[0]!.variants[0], sha256: 'bad', url: 'http://unsafe' },
        ],
      },
      MODEL_CATALOG.models[0],
    ]
    expect(() => parseCatalog(malformed)).toThrow(/invalid variant/)
  })

  it('converts a legacy v1 variant catalog into concrete artifacts safely', () => {
    const legacy = {
      version: 1,
      minimumAppVersion: MODEL_CATALOG.minimumAppVersion,
      models: MODEL_CATALOG.models.map(({ artifacts, ...model }) => ({
        ...model,
        variants: artifacts.map((artifact) => ({
          id: artifact.id,
          fileName: artifact.files[0]!.path,
          quantization: artifact.quantization,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          url: artifact.sourceUrl,
          sourceRevision: artifact.sourceRevision,
        })),
      })),
    }
    const parsed = parseCatalog(legacy)
    expect(parsed.version).toBe(2)
    expect(parsed.models[0]?.artifacts[0]?.runtimeId).toBe('llama.cpp')
  })

  it('explains why a model fits and protects low-storage devices', () => {
    const recommendation = recommendModel(MODEL_CATALOG.models[3]!, device)
    expect(recommendation.storageSafe).toBe(true)
    expect(recommendation.reasons.length).toBeGreaterThan(1)
    expect(
      recommendModel(MODEL_CATALOG.models[3]!, {
        ...device,
        architecture: 'arm64-v8a',
        cpuArchitecture: 'arm64-v8a',
      }).storageSafe,
    ).toBe(true)
    const lowStorage = { ...device, freeStorageBytes: 100 * 1024 ** 2 }
    const unsafe = recommendModel(MODEL_CATALOG.models[0]!, lowStorage)
    expect(unsafe.storageSafe).toBe(false)
    expect(unsafe.fit).toBe('not-recommended')
  })

  it('ranks an appropriate catalog for a device rather than returning fixed order', () => {
    const recommendations = recommendModels(MODEL_CATALOG, {
      ...device,
      availableMemoryBytes: 3 * 1024 ** 3,
    })
    expect(recommendations[0]?.model.id).not.toBe('qwen3-0.6b-q8')
    expect(recommendations.at(-1)?.fit).toBe('not-recommended')
  })
})
