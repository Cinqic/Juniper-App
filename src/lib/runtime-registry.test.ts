import { describe, expect, it } from 'vitest'
import { runtimeRegistryForDevice, selectRuntime } from './runtime-registry'
import { MODEL_CATALOG, type DeviceCapabilities } from './model-catalog'

const device: DeviceCapabilities = {
  os: 'android',
  deviceName: 'Test phone',
  architecture: 'arm64-v8a',
  cpuArchitecture: 'arm64-v8a',
  logicalCores: 8,
  memoryPressure: 'unknown',
  modelDirectory: '/models',
  gpu: 'unknown',
  acceleration: 'unknown',
  nativeRuntimeAvailable: true,
}

describe('runtime registry', () => {
  it('reports Android llama.cpp as available Beta and optional backends as unavailable', () => {
    const runtimes = runtimeRegistryForDevice(device)
    expect(runtimes.find((runtime) => runtime.id === 'llama.cpp')).toMatchObject({
      state: 'available',
      maturity: 'beta',
      qualification: 'package-only',
    })
    expect(runtimes.find((runtime) => runtime.id === 'mlc-llm')).toMatchObject({
      state: 'unavailable',
      installed: false,
    })
  })

  it('does not silently select an unavailable runtime or unknown locality', () => {
    const unavailable = runtimeRegistryForDevice({ ...device, nativeRuntimeAvailable: false })
    const result = selectRuntime(MODEL_CATALOG.models[0]!, { ...device, runtimes: unavailable })
    expect(result).toEqual({ error: expect.stringContaining('No packaged local runtime') })
  })
})
