import catalogJson from '../../config/models/catalog.json'

export interface ModelVariant {
  id: string
  fileName: string
  quantization: string
  sizeBytes: number
  sha256: string
  url: string
  sourceRevision: string
}

export interface CatalogModel {
  id: string
  displayName: string
  organization: string
  family: string
  parameterCount: number
  description: string
  useCases: string[]
  instructionTuned: boolean
  architecture: string
  format: string
  sourceRepository: string
  sourceRevision: string
  originalModel?: string
  license: string
  licenseUrl: string
  attribution: string
  chatTemplate: string
  contextLength: number
  minimumRecommendedRamBytes: number
  recommendedRamBytes: number
  minimumStorageBytes: number
  supportedArchitectures: string[]
  backendCompatibility: string[]
  tags: string[]
  releaseStatus: 'available' | 'deprecated'
  variants: ModelVariant[]
}

export interface ModelCatalog {
  version: number
  minimumAppVersion: string
  models: CatalogModel[]
}

export interface DeviceCapabilities {
  os: string
  deviceName: string
  architecture: string
  cpuArchitecture: string
  logicalCores: number
  totalMemoryBytes?: number
  availableMemoryBytes?: number
  memoryPressure: 'low' | 'medium' | 'high' | 'unknown'
  totalStorageBytes?: number
  freeStorageBytes?: number
  modelDirectory: string
  gpu: 'available' | 'not-detected' | 'unknown'
  acceleration: 'available' | 'not-detected' | 'unknown'
}

export type ModelFit = 'excellent' | 'good' | 'possible' | 'not-recommended' | 'unknown'

export interface ModelRecommendation {
  model: CatalogModel
  variant: ModelVariant
  score: number
  fit: ModelFit
  reasons: string[]
  storageSafe: boolean
}

export const MODEL_CATALOG: ModelCatalog = parseCatalog(catalogJson)

const STORAGE_HEADROOM_BYTES = 512 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

/** Validate remote/catalog data before it is allowed into the UI or downloader. */
export function parseCatalog(value: unknown): ModelCatalog {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.minimumAppVersion !== 'string' ||
    !value.minimumAppVersion ||
    !Array.isArray(value.models)
  ) {
    throw new Error('The model catalog is malformed.')
  }
  const ids = new Set<string>()
  const models = value.models.map((raw): CatalogModel => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || ids.has(raw.id)) {
      throw new Error('The model catalog contains a duplicate or invalid model id.')
    }
    ids.add(raw.id)
    if (
      typeof raw.displayName !== 'string' ||
      typeof raw.organization !== 'string' ||
      typeof raw.family !== 'string' ||
      typeof raw.description !== 'string' ||
      typeof raw.architecture !== 'string' ||
      typeof raw.format !== 'string' ||
      typeof raw.sourceRepository !== 'string' ||
      typeof raw.license !== 'string' ||
      typeof raw.chatTemplate !== 'string' ||
      !isStringArray(raw.useCases) ||
      !isStringArray(raw.supportedArchitectures) ||
      !isStringArray(raw.backendCompatibility) ||
      !isStringArray(raw.tags) ||
      !['available', 'deprecated'].includes(String(raw.releaseStatus)) ||
      typeof raw.parameterCount !== 'number' ||
      typeof raw.minimumRecommendedRamBytes !== 'number' ||
      typeof raw.minimumStorageBytes !== 'number' ||
      !Array.isArray(raw.variants) ||
      raw.variants.length === 0
    ) {
      throw new Error(`Catalog entry ${raw.id} is missing required metadata.`)
    }
    const variantIds = new Set<string>()
    const variants = raw.variants.map((variant): ModelVariant => {
      if (
        !isRecord(variant) ||
        typeof variant.id !== 'string' ||
        variantIds.has(variant.id) ||
        typeof variant.fileName !== 'string' ||
        typeof variant.quantization !== 'string' ||
        typeof variant.sizeBytes !== 'number' ||
        !isSha256(variant.sha256) ||
        typeof variant.url !== 'string' ||
        !variant.url.startsWith('https://') ||
        !variant.url.includes('huggingface.co/') ||
        typeof variant.sourceRevision !== 'string'
      ) {
        throw new Error(`Catalog entry ${raw.id} contains an invalid variant.`)
      }
      variantIds.add(variant.id)
      return variant as unknown as ModelVariant
    })
    return { ...raw, variants } as unknown as CatalogModel
  })
  return { ...value, models } as unknown as ModelCatalog
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes < 0) return 'Unknown size'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000
    index += 1
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

function memoryBudget(device: DeviceCapabilities): number | undefined {
  const available = device.availableMemoryBytes ?? device.totalMemoryBytes
  if (!available) return undefined
  const reserve = Math.max(512 * 1024 * 1024, available * 0.2)
  return Math.max(0, available - reserve)
}

function selectedVariant(model: CatalogModel): ModelVariant {
  return [...model.variants].sort((left, right) => left.sizeBytes - right.sizeBytes)[0]!
}

export function recommendModel(
  model: CatalogModel,
  device: DeviceCapabilities,
): ModelRecommendation {
  const variant = selectedVariant(model)
  const budget = memoryBudget(device)
  const reasons: string[] = []
  let score = 45
  let storageSafe = true

  if (
    !model.supportedArchitectures.includes(device.architecture) &&
    device.architecture !== 'unknown'
  ) {
    return {
      model,
      variant,
      score: 0,
      fit: 'not-recommended',
      reasons: [`${device.architecture} is not listed as supported`],
      storageSafe: false,
    }
  }
  if (budget === undefined) {
    reasons.push('Available memory could not be measured')
    score -= 15
  } else if (budget >= model.recommendedRamBytes) {
    score += 35
    reasons.push(
      `${formatBytes(device.availableMemoryBytes ?? device.totalMemoryBytes)} available memory leaves headroom`,
    )
  } else if (budget >= model.minimumRecommendedRamBytes) {
    score += 18
    reasons.push('Fits the measured memory budget with moderate headroom')
  } else {
    score -= 35
    reasons.push('Available memory is below the comfortable range')
  }

  const requiredStorage = Math.max(
    model.minimumStorageBytes,
    variant.sizeBytes + STORAGE_HEADROOM_BYTES,
  )
  if (device.freeStorageBytes === undefined) {
    reasons.push('Free storage could not be measured')
    score -= 10
  } else if (device.freeStorageBytes >= requiredStorage) {
    score += 15
    reasons.push(`${formatBytes(device.freeStorageBytes)} free storage is enough for the download`)
  } else {
    score -= 40
    storageSafe = false
    reasons.push(
      `Needs about ${formatBytes(requiredStorage)} free storage including safety headroom`,
    )
  }

  if (device.memoryPressure === 'high') {
    score -= 18
    reasons.push('The device currently reports high memory pressure')
  } else if (device.memoryPressure === 'low') {
    score += 5
    reasons.push('The device currently reports low memory pressure')
  }
  if (model.tags.includes('small')) score += 4
  const fit: ModelFit = !storageSafe
    ? 'not-recommended'
    : score >= 82
      ? 'excellent'
      : score >= 62
        ? 'good'
        : score >= 35
          ? 'possible'
          : 'not-recommended'
  return { model, variant, score: Math.max(0, Math.min(100, score)), fit, reasons, storageSafe }
}

export function recommendModels(
  catalog: ModelCatalog,
  device: DeviceCapabilities,
): ModelRecommendation[] {
  return catalog.models
    .filter((model) => model.releaseStatus === 'available')
    .map((model) => recommendModel(model, device))
    .sort(
      (left, right) => right.score - left.score || left.variant.sizeBytes - right.variant.sizeBytes,
    )
}

export function browserDeviceCapabilities(): DeviceCapabilities {
  const deviceMemory = 'deviceMemory' in navigator ? Number(navigator.deviceMemory) : undefined
  return {
    os: navigator.platform || 'browser',
    deviceName: 'This device',
    architecture: 'unknown',
    cpuArchitecture: 'unknown',
    logicalCores: navigator.hardwareConcurrency || 1,
    totalMemoryBytes: deviceMemory ? deviceMemory * 1024 ** 3 : undefined,
    availableMemoryBytes: undefined,
    memoryPressure: 'unknown',
    modelDirectory: 'Managed by Juniper',
    gpu: 'unknown',
    acceleration: 'unknown',
  }
}
