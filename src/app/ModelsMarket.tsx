import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppData, ManagedModel, ModelProfile } from '../types'
import { defaultProvider, modelProfileFromDiscovery } from '../lib/defaults'
import {
  deleteManagedModel,
  downloadManagedModel,
  getDeviceCapabilities,
  getManagedModels,
  getModelCatalog,
  runningInTauri,
} from '../lib/runtime'
import {
  MODEL_CATALOG,
  formatBytes,
  recommendModels,
  type CatalogModel,
  type DeviceCapabilities,
  type ModelCatalog,
  type ModelRecommendation,
} from '../lib/model-catalog'

type MarketTab = 'recommended' | 'all' | 'installed'

export function ModelsMarket({
  data,
  update,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
}) {
  const [catalog, setCatalog] = useState<ModelCatalog>(MODEL_CATALOG)
  const [device, setDevice] = useState<DeviceCapabilities | null>(null)
  const [installed, setInstalled] = useState<ManagedModel[]>([])
  const [tab, setTab] = useState<MarketTab>('recommended')
  const [query, setQuery] = useState('')
  const [activeDownload, setActiveDownload] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextCatalog, nextDevice, nextInstalled] = await Promise.all([
        getModelCatalog(),
        getDeviceCapabilities(),
        getManagedModels(),
      ])
      setCatalog(nextCatalog)
      setDevice(nextDevice)
      setInstalled(nextInstalled)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not inspect this device.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const recommendations = useMemo(
    () => (device ? recommendModels(catalog, device) : []),
    [catalog, device],
  )
  const managedIds = useMemo(() => new Set(installed.map((model) => model.catalogId)), [installed])
  const installedIds = useMemo(
    () =>
      new Set(
        installed
          .filter((model) => model.verified && model.state === 'ready')
          .map((model) => model.catalogId),
      ),
    [installed],
  )
  const visibleRecommendations = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const matches = (item: ModelRecommendation) =>
      !normalized ||
      [item.model.displayName, item.model.family, ...item.model.tags].some((value) =>
        value.toLowerCase().includes(normalized),
      )
    return recommendations.filter((item) => {
      if (!matches(item)) return false
      if (tab === 'installed') return managedIds.has(item.model.id)
      if (tab === 'recommended') return item.fit !== 'not-recommended' || item.storageSafe
      return true
    })
  }, [managedIds, query, recommendations, tab])

  function profileFor(entry: CatalogModel): ModelProfile {
    const provider = data.providers.find((item) => item.kind === 'juniper-local') ?? defaultProvider
    return modelProfileFromDiscovery(provider, entry.id, {
      catalogId: entry.id,
      managedVariantId: entry.variants[0]?.id,
      displayName: entry.displayName,
      description: entry.description,
      sourceReference: entry.sourceRepository,
      family: entry.family,
      architecture: entry.architecture,
      parameterSize: `${Math.round(entry.parameterCount / 1_000_000)}M`,
      fileSizeBytes: entry.variants[0]?.sizeBytes,
      quantization: entry.variants[0]?.quantization,
      format: entry.format,
      license: entry.license,
      template: entry.chatTemplate,
      contextLength: entry.contextLength,
      status: 'ready',
      compatibilityStatus: 'chat-compatible',
      capabilities: {
        ...provider.capabilities,
        chat: 'supported',
        text: 'supported',
        streaming: 'supported',
      },
    })
  }

  function selectModel(entry: CatalogModel) {
    const profile = profileFor(entry)
    update((current) => {
      const provider = current.providers.find((item) => item.kind === 'juniper-local')
      const providers = provider ? current.providers : [...current.providers, defaultProvider]
      const models = [...current.models.filter((model) => model.catalogId !== entry.id), profile]
      return {
        ...current,
        providers,
        models,
        assistants: current.assistants.map((assistant, index) =>
          index === 0 && !assistant.modelProfileId
            ? { ...assistant, modelProfileId: profile.id, updatedAt: new Date().toISOString() }
            : assistant,
        ),
      }
    })
    setMessage(`${entry.displayName} is ready for chat.`)
  }

  async function download(entry: CatalogModel) {
    if (!runningInTauri) {
      setMessage('Model downloads are available in the Juniper desktop or Android app.')
      return
    }
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setActiveDownload(entry.id)
    setProgress(null)
    setMessage(null)
    try {
      await downloadManagedModel(
        entry.id,
        (event) =>
          setProgress({ completed: event.completedBytes ?? 0, total: event.totalBytes ?? 0 }),
        next.signal,
      )
      const nextInstalled = await getManagedModels()
      setInstalled(nextInstalled)
      selectModel(entry)
    } catch (error) {
      setMessage(
        next.signal.aborted
          ? 'Download paused. Resume when you are ready.'
          : error instanceof Error
            ? error.message
            : 'Download failed.',
      )
    } finally {
      if (controller.current === next) controller.current = null
      setActiveDownload(null)
      setProgress(null)
    }
  }

  async function remove(entry: CatalogModel) {
    if (!window.confirm(`Remove ${entry.displayName} from this device?`)) return
    try {
      await deleteManagedModel(entry.id)
      setInstalled((current) => current.filter((model) => model.catalogId !== entry.id))
      update((current) => ({
        ...current,
        models: current.models.filter((model) => model.catalogId !== entry.id),
      }))
      setMessage(`${entry.displayName} was removed.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove the model.')
    }
  }

  return (
    <section className="models-market" aria-labelledby="models-market-title">
      <div className="market-heading">
        <div>
          <span className="eyebrow">Models Market</span>
          <h2 id="models-market-title">Local models, chosen for this device</h2>
          <p>
            Juniper manages the download, verification, storage, and local model lifecycle for you.
            Nothing here requires Ollama or an account.
          </p>
        </div>
        <button className="text-button" onClick={() => void refresh()}>
          Recheck device ↻
        </button>
      </div>
      <div className="device-summary" aria-label="Device summary">
        <div>
          <span>Your device</span>
          <strong>{device?.deviceName ?? 'Detecting…'}</strong>
        </div>
        <div>
          <span>Memory</span>
          <strong>{memoryLabel(device)}</strong>
        </div>
        <div>
          <span>Free storage</span>
          <strong>{formatBytes(device?.freeStorageBytes)}</strong>
        </div>
        <div>
          <span>Processor</span>
          <strong>
            {device ? `${device.architecture} · ${device.logicalCores} cores` : 'Detecting…'}
          </strong>
        </div>
      </div>
      <div className="market-controls">
        <div className="market-tabs" role="tablist" aria-label="Model views">
          {(['recommended', 'all', 'installed'] as MarketTab[]).map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={tab === item}
              className={tab === item ? 'active' : ''}
              onClick={() => setTab(item)}
            >
              {item === 'recommended' ? 'Recommended' : item === 'all' ? 'All models' : 'Installed'}
            </button>
          ))}
        </div>
        <input
          className="market-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models"
          aria-label="Search models"
        />
      </div>
      {message && (
        <div className="market-message" role="status">
          {message}
        </div>
      )}
      <div className="market-grid">
        {visibleRecommendations.map((recommendation) => (
          <ModelMarketCard
            key={recommendation.model.id}
            recommendation={recommendation}
            installed={installedIds.has(recommendation.model.id)}
            managedState={
              installed.find((model) => model.catalogId === recommendation.model.id)?.state
            }
            downloading={activeDownload === recommendation.model.id}
            progress={activeDownload === recommendation.model.id ? progress : null}
            onDownload={() => void download(recommendation.model)}
            onCancel={() => controller.current?.abort()}
            onUse={() => selectModel(recommendation.model)}
            onRemove={() => void remove(recommendation.model)}
          />
        ))}
      </div>
      {installed.length === 0 && tab !== 'installed' && (
        <p className="market-empty-hint">
          No models installed yet. Download a recommended model to begin.
        </p>
      )}
      {visibleRecommendations.length === 0 && (
        <div className="empty-small">No models match this view. Try another tab or search.</div>
      )}
    </section>
  )
}

function ModelMarketCard({
  recommendation,
  installed,
  managedState,
  downloading,
  progress,
  onDownload,
  onCancel,
  onUse,
  onRemove,
}: {
  recommendation: ModelRecommendation
  installed: boolean
  managedState?: ManagedModel['state']
  downloading: boolean
  progress: { completed: number; total: number } | null
  onDownload: () => void
  onCancel: () => void
  onUse: () => void
  onRemove: () => void
}) {
  const { model, variant } = recommendation
  const percent = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0
  return (
    <article className="model-market-card">
      <div className="market-card-top">
        <div>
          <span className="market-fit">{fitLabel(recommendation.fit)}</span>
          <h3>{model.displayName}</h3>
          <p>{model.description}</p>
        </div>
        <span className="model-symbol" aria-hidden="true">
          ✦
        </span>
      </div>
      <div className="market-card-meta">
        <span>{Math.round(model.parameterCount / 1_000_000)}M parameters</span>
        <span>{formatBytes(variant.sizeBytes)}</span>
        <span>{variant.quantization}</span>
      </div>
      <div className="model-tags">
        {model.useCases.map((useCase) => (
          <span key={useCase}>{useCase}</span>
        ))}
      </div>
      <p className="market-reason">
        <strong>Why this fit:</strong> {recommendation.reasons[0] ?? 'Compatible with this device.'}
      </p>
      {!recommendation.storageSafe && (
        <p className="market-warning">Not enough free storage for a safe download.</p>
      )}
      {managedState && managedState !== 'ready' && (
        <p className="market-warning">
          {managedState === 'partial'
            ? 'A partial download is available; Juniper can resume it.'
            : 'The local file failed verification and will be replaced.'}
        </p>
      )}
      {downloading && (
        <div className="market-progress" role="status">
          <div>
            <span>Downloading and verifying</span>
            <strong>{percent}%</strong>
          </div>
          <progress value={percent} max="100" />
        </div>
      )}
      <div className="market-card-actions">
        {installed ? (
          <>
            <button className="primary-button" onClick={onUse}>
              Use this model
            </button>
            <button className="text-button" onClick={onRemove}>
              Remove
            </button>
          </>
        ) : downloading ? (
          <>
            <button className="primary-button" disabled>
              Downloading…
            </button>
            <button className="secondary-button" onClick={onCancel}>
              Pause
            </button>
          </>
        ) : (
          <>
            <button
              className="primary-button"
              onClick={onDownload}
              disabled={!recommendation.storageSafe}
            >
              {recommendation.storageSafe
                ? `Download · ${formatBytes(variant.sizeBytes)}`
                : 'Not enough storage'}
            </button>
            {managedState && (
              <button className="text-button" onClick={onRemove}>
                Remove
              </button>
            )}
          </>
        )}
      </div>
      <details className="market-advanced">
        <summary>Advanced details</summary>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>
              <a href={model.sourceRepository} target="_blank" rel="noreferrer">
                {model.organization}
              </a>
            </dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>{model.license}</dd>
          </div>
          <div>
            <dt>Context</dt>
            <dd>{model.contextLength.toLocaleString()} tokens</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="hash-value">{variant.sha256}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd>{variant.fileName}</dd>
          </div>
        </dl>
      </details>
    </article>
  )
}

function memoryLabel(device: DeviceCapabilities | null): string {
  if (!device?.availableMemoryBytes && !device?.totalMemoryBytes) return 'Unknown'
  const available = device.availableMemoryBytes ?? device.totalMemoryBytes
  return `${formatBytes(available)} available`
}

function fitLabel(value: ModelRecommendation['fit']): string {
  return value === 'not-recommended'
    ? 'Not recommended'
    : value.charAt(0).toUpperCase() + value.slice(1) + ' fit'
}
