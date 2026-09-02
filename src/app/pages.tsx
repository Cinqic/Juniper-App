import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { parseAssistant, serializeAssistant } from '../lib/assistant'
import { defaultAssistant, defaultProvider, modelProfileFromDiscovery } from '../lib/defaults'
import {
  checkProviderConnection,
  deleteProviderCredential,
  deleteProviderModel,
  getDiagnostics,
  getRuntimeLogs,
  importGguf,
  inspectProviderModel,
  listProviderModels,
  modelFromInspection,
  pickGguf,
  pullProviderModel,
  runningInTauri,
  runningProviderModels,
  saveProviderCredential,
} from '../lib/runtime'
import { PageHeading } from './ui'
import type {
  AppData,
  Assistant,
  GgufSelection,
  ModelProfile,
  ProviderProfile,
  RuntimeLogEntry,
} from '../types'

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

function now(): string {
  return new Date().toISOString()
}

export function AssistantsPage({
  data,
  update,
  activeAssistantId,
  onSelectAssistant,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  activeAssistantId: string
  onSelectAssistant: (id: string) => void
}) {
  const [editing, setEditing] = useState<Assistant | null>(null)
  function save(assistant: Assistant) {
    update((current) => ({
      ...current,
      assistants: current.assistants.some((item) => item.id === assistant.id)
        ? current.assistants.map((item) =>
            item.id === assistant.id ? { ...assistant, updatedAt: now() } : item,
          )
        : [...current.assistants, assistant],
    }))
    onSelectAssistant(assistant.id)
    setEditing(null)
  }
  function newAssistant() {
    setEditing({
      ...defaultAssistant,
      id: uid('assistant'),
      name: 'New assistant',
      description: 'A custom Juniper assistant.',
      systemPrompt: defaultAssistant.systemPrompt,
      createdAt: now(),
      updatedAt: now(),
    })
  }
  return (
    <>
      {editing ? (
        <AssistantBuilder
          assistant={editing}
          models={data.models}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <PageHeading
            eyebrow="Make it yours"
            title="Assistants"
            description="Behavior is separate from inference. Create a different Juniper for every kind of day."
            action={
              <button className="primary-button" onClick={newAssistant}>
                ＋ New assistant
              </button>
            }
          />
          <div className="assistant-grid">
            {data.assistants.map((assistant) => (
              <button
                className={`assistant-card ${activeAssistantId === assistant.id ? 'selected' : ''}`}
                key={assistant.id}
                onClick={() => {
                  onSelectAssistant(assistant.id)
                  setEditing(assistant)
                }}
              >
                <div className="card-top">
                  <div className="assistant-avatar large" style={{ background: assistant.accent }}>
                    {assistant.avatar}
                  </div>
                  <span className="card-more">···</span>
                </div>
                <h3>{assistant.name}</h3>
                <p>{assistant.description}</p>
                <div className="card-meta">
                  <span>
                    {data.models.find((model) => model.id === assistant.modelProfileId)
                      ?.displayName ?? 'Model not selected'}
                  </span>
                  <span>›</span>
                </div>
              </button>
            ))}
            <button className="assistant-card add-card" onClick={newAssistant}>
              <span>＋</span>
              <strong>Build a new assistant</strong>
              <small>Start from Juniper’s template</small>
            </button>
          </div>
        </>
      )}
    </>
  )
}

function AssistantBuilder({
  assistant: initial,
  models,
  onSave,
  onCancel,
}: {
  assistant: Assistant
  models: ModelProfile[]
  onSave: (assistant: Assistant) => void
  onCancel: () => void
}) {
  const [assistant, setAssistant] = useState(initial)
  const set = <K extends keyof Assistant>(key: K, value: Assistant[K]) =>
    setAssistant((current) => ({ ...current, [key]: value }))
  function updatePersonality(key: keyof Assistant['personality'], value: number) {
    set('personality', { ...assistant.personality, [key]: value })
  }
  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    void file.text().then((text) => {
      try {
        setAssistant(parseAssistant(text))
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not import assistant.')
      }
    })
  }
  function exportFile() {
    download(
      `${assistant.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.juniper`,
      serializeAssistant(assistant),
      'application/json',
    )
  }
  return (
    <div>
      <div className="builder-header">
        <button className="back-link" onClick={onCancel}>
          ← Assistants
        </button>
        <div>
          <span className="eyebrow">Assistant builder</span>
          <h1>{assistant.name}</h1>
        </div>
        <div className="builder-actions">
          <label className="secondary-button">
            Import
            <input
              type="file"
              accept=".juniper,.json,application/json"
              onChange={importFile}
              hidden
            />
          </label>
          <button className="secondary-button" onClick={exportFile}>
            Export
          </button>
          <button className="primary-button" onClick={() => onSave(assistant)}>
            Save assistant
          </button>
        </div>
      </div>
      <div className="builder-grid">
        <section className="builder-card">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <h2>Identity</h2>
              <p>Give this assistant a clear role.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Name
              <input value={assistant.name} onChange={(event) => set('name', event.target.value)} />
            </label>
            <label>
              Avatar
              <input
                value={assistant.avatar}
                maxLength={2}
                onChange={(event) => set('avatar', event.target.value)}
              />
            </label>
            <label className="wide">
              Description
              <input
                value={assistant.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </label>
            <label className="wide">
              What should it help with?
              <textarea
                value={assistant.systemPrompt}
                onChange={(event) => set('systemPrompt', event.target.value)}
                rows={7}
              />
            </label>
          </div>
        </section>
        <section className="builder-card">
          <div className="section-heading">
            <span className="section-number">02</span>
            <div>
              <h2>Personality</h2>
              <p>Use human labels as a starting point; the prompt stays editable.</p>
            </div>
          </div>
          <div className="personality-grid">
            {(Object.keys(assistant.personality) as Array<keyof Assistant['personality']>).map(
              (key) => (
                <label key={key}>
                  <span>
                    {key[0]?.toUpperCase()}
                    {key.slice(1)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={assistant.personality[key]}
                    onChange={(event) => updatePersonality(key, Number(event.target.value))}
                  />
                  <small>
                    {assistant.personality[key] > 66
                      ? 'High'
                      : assistant.personality[key] < 34
                        ? 'Low'
                        : 'Balanced'}
                  </small>
                </label>
              ),
            )}
          </div>
          <div className="choice-row">
            <label>
              Response style
              <select
                value={assistant.responseLength}
                onChange={(event) =>
                  set('responseLength', event.target.value as Assistant['responseLength'])
                }
              >
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label>
              Model
              <select
                value={assistant.modelProfileId ?? ''}
                onChange={(event) => set('modelProfileId', event.target.value || null)}
              >
                <option value="">Not selected</option>
                {models.filter(isChatSelectable).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className="builder-card compact-card">
          <div className="section-heading">
            <span className="section-number">03</span>
            <div>
              <h2>Boundaries</h2>
              <p>The host runtime enforces these choices.</p>
            </div>
          </div>
          <div className="choice-row">
            <label>
              Tool policy
              <select
                value={assistant.toolPolicy}
                onChange={(event) =>
                  set('toolPolicy', event.target.value as Assistant['toolPolicy'])
                }
              >
                <option value="ask">Ask before user-data tools</option>
                <option value="safe-automatic">Safe automatic tools</option>
                <option value="disabled">Tools disabled</option>
              </select>
            </label>
            <label>
              Memory
              <select
                value={assistant.memoryPolicy}
                onChange={(event) =>
                  set('memoryPolicy', event.target.value as Assistant['memoryPolicy'])
                }
              >
                <option value="curated">Curated memories</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
        </section>
        <details className="builder-card compact-card">
          <summary className="section-heading">
            <span className="section-number">04</span>
            <div>
              <h2>Advanced generation</h2>
              <p>Only supported controls are sent to the selected runtime.</p>
            </div>
          </summary>
          <div className="choice-row advanced-generation-grid">
            <label>
              Temperature
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={assistant.generation.temperature ?? ''}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    temperature: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              Top P
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={assistant.generation.topP ?? ''}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    topP: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              Max output tokens
              <input
                type="number"
                min="1"
                max="32768"
                step="1"
                value={assistant.generation.maxOutput ?? ''}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    maxOutput: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              Thinking
              <select
                value={assistant.generation.thinking ?? 'auto'}
                onChange={(event) =>
                  set('generation', {
                    ...assistant.generation,
                    thinking: event.target.value as Assistant['generation']['thinking'],
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="off">Off</option>
                <option value="on">On</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
        </details>
      </div>
    </div>
  )
}

export function ModelsPage({
  data,
  update,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
}) {
  const [showProvider, setShowProvider] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderProfile | null>(null)
  const [providerName, setProviderName] = useState('Local llama.cpp server')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8080/v1')
  const [providerKind, setProviderKind] = useState<ProviderProfile['kind']>('openai-compatible')
  const [apiKey, setApiKey] = useState('')
  const [checkingProvider, setCheckingProvider] = useState<string | null>(null)
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [modelReference, setModelReference] = useState('')
  const [pullStatus, setPullStatus] = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<{ completed?: number; total?: number }>({})
  const pullController = useRef<AbortController | null>(null)
  const [ggufSelection, setGgufSelection] = useState<GgufSelection | null>(null)
  const [ggufModelName, setGgufModelName] = useState('local-gguf')
  const [ggufImportStatus, setGgufImportStatus] = useState<string | null>(null)
  const ggufImportController = useRef<AbortController | null>(null)
  const [runningModelIds, setRunningModelIds] = useState<Record<string, string[]>>({})
  const [hostMemory, setHostMemory] = useState<string | null>(null)

  useEffect(() => {
    if (!runningInTauri) return
    let active = true
    void Promise.all(
      data.providers
        .filter((provider) => provider.enabled)
        .map(async (provider) => {
          try {
            const models = await runningProviderModels(provider)
            return [
              provider.id,
              models.flatMap((model) => {
                const name = model.name ?? model.model
                return typeof name === 'string' ? [name] : []
              }),
            ] as const
          } catch {
            return [provider.id, []] as const
          }
        }),
    ).then((entries) => {
      if (active) setRunningModelIds(Object.fromEntries(entries))
    })
    void getDiagnostics().then((info) => {
      if (active) setHostMemory(info.memory ?? null)
    })
    return () => {
      active = false
    }
  }, [data.providers])

  function startProviderForm(provider?: ProviderProfile) {
    setEditingProvider(provider ?? null)
    setProviderName(provider?.name ?? 'Local llama.cpp server')
    setBaseUrl(provider?.baseUrl ?? 'http://127.0.0.1:8080/v1')
    setProviderKind(provider?.kind ?? 'openai-compatible')
    setApiKey('')
    setShowProvider(true)
  }

  async function saveProvider() {
    const name = providerName.trim()
    const url = baseUrl.trim()
    if (!name || !url) return
    const providerId = editingProvider?.id ?? uid('provider')
    const apiKeyRef = apiKey.trim()
      ? (editingProvider?.apiKeyRef ?? uid('credential'))
      : editingProvider?.apiKeyRef
    if (apiKeyRef) {
      try {
        await saveProviderCredential(apiKeyRef, apiKey.trim())
      } catch (error) {
        window.alert(
          error instanceof Error ? error.message : 'Could not save the API key securely.',
        )
        return
      }
    }
    const location = locationForUrl(url)
    const provider: ProviderProfile = {
      ...(editingProvider ?? {}),
      id: providerId,
      name,
      kind: providerKind,
      baseUrl: url,
      locality: location === 'remote' ? 'remote' : location === 'unknown' ? 'unknown' : 'local',
      transportLocation: location,
      apiKeyRef,
      enabled: editingProvider?.enabled ?? true,
      status: 'unknown',
      capabilities: {
        ...(editingProvider?.capabilities ??
          data.providers[0]?.capabilities ?? {
            chat: 'supported',
            text: 'supported',
            streaming: 'supported',
            systemPrompt: 'supported',
            tools: 'unknown',
            parallelTools: 'unknown',
            thinking: 'unknown',
            structuredOutput: 'unknown',
            images: 'unknown',
            embeddings: 'unknown',
            generationParameters: ['temperature'],
          }),
      },
    }
    update((current) => ({
      ...current,
      providers: current.providers.some((item) => item.id === provider.id)
        ? current.providers.map((item) => (item.id === provider.id ? provider : item))
        : [...current.providers, provider],
    }))
    setApiKey('')
    setShowProvider(false)
    setEditingProvider(null)
  }
  async function testProvider(provider: ProviderProfile) {
    setCheckingProvider(provider.id)
    try {
      await checkProviderConnection(provider)
      update((current) => ({
        ...current,
        providers: current.providers.map((item) =>
          item.id === provider.id ? { ...item, status: 'connected' } : item,
        ),
      }))
    } catch (error) {
      update((current) => ({
        ...current,
        providers: current.providers.map((item) =>
          item.id === provider.id ? { ...item, status: 'offline' } : item,
        ),
      }))
      window.alert(error instanceof Error ? error.message : 'Provider connection failed.')
    } finally {
      setCheckingProvider(null)
    }
  }
  function toggleProvider(provider: ProviderProfile) {
    update((current) => ({
      ...current,
      providers: current.providers.map((item) =>
        item.id === provider.id ? { ...item, enabled: !item.enabled } : item,
      ),
    }))
  }
  async function removeProvider(provider: ProviderProfile) {
    const dependentModels = data.models.filter((model) => model.providerId === provider.id)
    if (
      !window.confirm(
        `Remove ${provider.name}? ${dependentModels.length} model profile(s) will remain unavailable.`,
      )
    )
      return
    if (provider.apiKeyRef && runningInTauri) {
      try {
        await deleteProviderCredential(provider.apiKeyRef)
      } catch (error) {
        window.alert(
          error instanceof Error ? error.message : 'Could not remove the provider credential.',
        )
        return
      }
    }
    update((current) => ({
      ...current,
      providers: current.providers.filter((item) => item.id !== provider.id),
      models: current.models.map((model) =>
        model.providerId === provider.id ? { ...model, status: 'not-found' } : model,
      ),
    }))
  }
  async function refreshModels() {
    setRefreshingModels(true)
    const discovered: Array<{
      provider: ProviderProfile
      modelIds: Awaited<ReturnType<typeof listProviderModels>>
    }> = []
    const failedProviderIds = new Set<string>()
    for (const provider of data.providers.filter((item) => item.enabled)) {
      try {
        discovered.push({ provider, modelIds: await listProviderModels(provider) })
      } catch {
        // A provider can be offline while another provider remains usable.
        failedProviderIds.add(provider.id)
      }
    }
    const normalized: ModelProfile[] = []
    for (const { provider, modelIds } of discovered) {
      for (const discoveredModel of modelIds) {
        const existing = data.models.find(
          (model) => model.providerId === provider.id && model.modelId === discoveredModel.modelId,
        )
        try {
          const inspection = await inspectProviderModel(provider, discoveredModel.modelId)
          normalized.push(modelFromInspection(provider, inspection, existing))
        } catch {
          normalized.push(
            modelProfileFromDiscovery(provider, discoveredModel.modelId, {
              ...existing,
              displayName: discoveredModel.displayName,
              fileSizeBytes: discoveredModel.sizeBytes,
            }),
          )
        }
      }
    }
    const refreshedProviderIds = new Set(discovered.map(({ provider }) => provider.id))
    const discoveredModelIds = new Set(normalized.map((model) => model.id))
    if (refreshedProviderIds.size || failedProviderIds.size) {
      update((current) => ({
        ...current,
        providers: current.providers.map((provider) =>
          refreshedProviderIds.has(provider.id)
            ? { ...provider, status: 'connected' }
            : failedProviderIds.has(provider.id)
              ? { ...provider, status: 'offline' }
              : provider,
        ),
        models: [
          ...current.models
            .filter((model) => !normalized.some((item) => item.id === model.id))
            .map((model) =>
              refreshedProviderIds.has(model.providerId) && !discoveredModelIds.has(model.id)
                ? { ...model, status: 'not-found' as const }
                : model,
            ),
          ...normalized,
        ],
      }))
    }
    setRefreshingModels(false)
  }
  async function downloadModel(modelReferenceOverride?: string) {
    const reference = (modelReferenceOverride ?? modelReference).trim()
    const provider = data.providers.find((item) => item.kind === 'ollama' && item.enabled)
    if (!provider || !reference) return
    pullController.current?.abort()
    const controller = new AbortController()
    pullController.current = controller
    setPullStatus('Resolving')
    setPullProgress({})
    try {
      await pullProviderModel(
        provider,
        reference,
        (progress) => {
          setPullStatus(progress.status)
          setPullProgress({ completed: progress.completedBytes, total: progress.totalBytes })
        },
        controller.signal,
      )
      setPullStatus('Complete')
      setModelReference('')
      await refreshModels()
    } catch (error) {
      setPullStatus(
        controller.signal.aborted
          ? 'Cancelled'
          : error instanceof Error
            ? error.message
            : 'Download failed',
      )
    } finally {
      pullController.current = null
    }
  }
  function cancelDownload() {
    pullController.current?.abort()
  }
  async function chooseGguf() {
    try {
      const selection = await pickGguf()
      if (selection) {
        setGgufSelection(selection)
        setGgufModelName(selection.name.replace(/\.gguf$/i, '').replace(/[^a-z0-9._/-]+/gi, '-'))
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not select that GGUF file.')
    }
  }
  async function importSelectedGguf() {
    if (!ggufSelection || !ggufModelName.trim()) return
    ggufImportController.current?.abort()
    const controller = new AbortController()
    ggufImportController.current = controller
    setGgufImportStatus('Preparing import')
    try {
      await importGguf(
        ggufSelection.id,
        ggufModelName.trim(),
        (progress) => setGgufImportStatus(progress.status),
        controller.signal,
      )
      setGgufImportStatus('Complete')
      await refreshModels()
    } catch (error) {
      setGgufImportStatus(
        controller.signal.aborted
          ? 'Cancelled'
          : error instanceof Error
            ? error.message
            : 'Import failed',
      )
    } finally {
      ggufImportController.current = null
    }
  }
  function cancelGguf() {
    ggufImportController.current?.abort()
  }
  async function deleteModel(model: ModelProfile) {
    const provider = data.providers.find((item) => item.id === model.providerId)
    if (!provider || !window.confirm(`Delete ${model.modelId} from ${provider.name}?`)) return
    try {
      await deleteProviderModel(provider, model.modelId)
      update((current) => ({
        ...current,
        models: current.models.map((item) =>
          item.id === model.id ? { ...item, status: 'not-found' } : item,
        ),
      }))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not delete the model.')
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Infrastructure"
        title="Models"
        description="Models provide inference. Juniper provides the environment around them."
        action={
          <button
            className="secondary-button"
            onClick={() => (showProvider ? setShowProvider(false) : startProviderForm())}
          >
            ＋ Add provider
          </button>
        }
      />
      {showProvider && (
        <div className="inline-form">
          <label>
            Provider name
            <input value={providerName} onChange={(event) => setProviderName(event.target.value)} />
          </label>
          <label>
            Provider type
            <select
              value={providerKind}
              onChange={(event) => setProviderKind(event.target.value as ProviderProfile['kind'])}
            >
              <option value="ollama">Ollama</option>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="llama-cpp">llama.cpp-compatible</option>
            </select>
          </label>
          <label>
            Base URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label>
            API key <small>Saved to OS keychain</small>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className="inline-form-actions">
            <button className="primary-button" onClick={() => void saveProvider()}>
              {editingProvider ? 'Update provider' : 'Save provider'}
            </button>
            <button className="text-button" onClick={() => setShowProvider(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="provider-stack">
        {data.providers.map((provider) => (
          <div className="provider-card" key={provider.id}>
            <div className="provider-icon">{provider.kind === 'ollama' ? '◉' : '↗'}</div>
            <div className="provider-body">
              <div className="provider-title">
                <h3>{provider.name}</h3>
                <span className={`status-pill ${provider.transportLocation}`}>
                  <i />
                  {labelExecutionLocation(provider.transportLocation)}
                </span>
              </div>
              <p>{provider.baseUrl}</p>
              <div className="provider-footer">
                <span>
                  {provider.enabled
                    ? provider.status === 'connected'
                      ? 'Connected'
                      : 'Connection not checked'
                    : 'Disabled'}
                </span>
                <button
                  className="text-button"
                  onClick={() => void testProvider(provider)}
                  disabled={checkingProvider === provider.id}
                >
                  {checkingProvider === provider.id ? 'Checking…' : 'Test connection →'}
                </button>
                <button className="text-button" onClick={() => startProviderForm(provider)}>
                  Edit
                </button>
                <button className="text-button" onClick={() => toggleProvider(provider)}>
                  {provider.enabled ? 'Disable' : 'Enable'}
                </button>
                <button className="text-button" onClick={() => void removeProvider(provider)}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="models-section">
        <div className="subheading">
          <div>
            <span className="eyebrow">Available models</span>
            <h2>Model library</h2>
          </div>
          <button
            className="text-button"
            onClick={() => void refreshModels()}
            disabled={refreshingModels}
          >
            {refreshingModels ? 'Refreshing…' : 'Refresh list ↻'}
          </button>
        </div>
        <div className="model-download-card">
          <div>
            <span className="eyebrow">Ollama model downloader</span>
            <h3>Download a model</h3>
            <p>Enter any compatible Ollama model reference. Juniper sends it directly to Ollama.</p>
          </div>
          <div className="model-download-form">
            <input
              value={modelReference}
              onChange={(event) => setModelReference(event.target.value)}
              placeholder="model-name-or-reference"
              aria-label="Ollama model reference"
              maxLength={256}
              disabled={pullController.current !== null}
            />
            {pullController.current ? (
              <button className="secondary-button" onClick={cancelDownload}>
                Cancel
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={() => void downloadModel()}
                disabled={!modelReference.trim()}
              >
                Download
              </button>
            )}
          </div>
          {pullStatus && (
            <div className="pull-progress" role="status">
              <span>{pullStatus}</span>
              {pullProgress.total ? (
                <span>
                  {Math.round(((pullProgress.completed ?? 0) / pullProgress.total) * 100)}%
                </span>
              ) : null}
            </div>
          )}
        </div>
        {data.models.length === 0 && (
          <div className="empty-small">
            No models installed yet. Download or add a compatible model to get started.
          </div>
        )}
        {data.models.map((model) => (
          <div className="model-row" key={model.id}>
            <div className="model-symbol">✦</div>
            <div className="model-main">
              <div className="model-title">
                <h3>{model.displayName}</h3>
                <span className={`status-pill ${model.executionLocation}`}>
                  <i />
                  {labelExecutionLocation(model.executionLocation)}
                </span>
                {runningModelIds[model.providerId]?.includes(model.modelId) && (
                  <span className="status-pill on-device">
                    <i />
                    Loaded in runtime
                  </span>
                )}
              </div>
              <p>{model.description}</p>
              <div className="model-tags">
                <span>Tools {labelCapability(model.capabilities.tools)}</span>
                <span>Thinking {labelCapability(model.capabilities.thinking)}</span>
                <span>{model.contextLength?.toLocaleString() ?? '—'} context</span>
                <span>Estimated fit {modelFitLabel(model, hostMemory)}</span>
                <span>
                  {model.compatibilityStatus === 'not-chat-compatible'
                    ? 'Not chat-compatible'
                    : 'Chat status unknown or ready'}
                </span>
              </div>
              {data.settings.developerMode && (
                <details className="model-details">
                  <summary>Developer details</summary>
                  <small>
                    {[model.family, model.architecture, model.parameterSize, model.quantization]
                      .filter(Boolean)
                      .join(' · ') || 'No additional runtime metadata'}
                    {model.template ? ` · template: ${model.template}` : ''}
                    {model.rawCapabilities?.length
                      ? ` · capabilities: ${model.rawCapabilities.join(', ')}`
                      : ''}
                  </small>
                </details>
              )}
            </div>
            <div className="model-right">
              <strong>
                {runningModelIds[model.providerId]?.includes(model.modelId)
                  ? 'Running'
                  : modelStatusLabel(model)}
              </strong>
              <small>
                {
                  data.assistants.filter((assistant) => assistant.modelProfileId === model.id)
                    .length
                }{' '}
                assistants
              </small>
              {data.providers.find((provider) => provider.id === model.providerId)?.kind ===
                'ollama' && (
                <>
                  {model.status === 'not-found' && (
                    <button
                      className="text-button"
                      onClick={() => void downloadModel(model.modelId)}
                    >
                      Re-download
                    </button>
                  )}
                  <button className="text-button" onClick={() => void deleteModel(model)}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        <div className="model-dropzone">
          <span>⌁</span>
          <div>
            <strong>Bring a local GGUF model</strong>
            <small>
              {ggufSelection
                ? `${ggufSelection.name} · ${(ggufSelection.sizeBytes / 1_000_000).toFixed(1)} MB selected`
                : 'Desktop picker validates and scopes the selected file'}
            </small>
          </div>
          <div>
            <button className="secondary-button" onClick={() => void chooseGguf()}>
              {ggufSelection ? 'Choose another .gguf' : 'Choose .gguf'}
            </button>
            {ggufSelection && (
              <div className="gguf-import-form">
                <label>
                  Ollama model name
                  <input
                    value={ggufModelName}
                    onChange={(event) => setGgufModelName(event.target.value)}
                    maxLength={128}
                  />
                </label>
                {ggufImportController.current ? (
                  <button className="secondary-button" onClick={cancelGguf}>
                    Cancel import
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    onClick={() => void importSelectedGguf()}
                    disabled={!ggufModelName.trim()}
                  >
                    Import into Ollama
                  </button>
                )}
                {ggufImportStatus && <small role="status">{ggufImportStatus}</small>}
              </div>
            )}
          </div>
        </div>
        <div className="hardware-note">
          <strong>Fit guidance</strong>
          <span>
            {hostMemory
              ? `Detected host memory: ${hostMemory}. Model fit still depends on quantization and runtime overhead.`
              : 'Host memory is unavailable here. Juniper will not guess whether a model fits.'}
          </span>
          <small>
            GPU acceleration and throughput remain unknown unless the provider reports them.
          </small>
        </div>
      </div>
    </>
  )
}
function labelCapability(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function parseMemoryBytes(value: string | null): number | undefined {
  if (!value) return undefined
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(kb|mb|gb|tb)$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase()
  const multiplier =
    unit === 'kb'
      ? 1024
      : unit === 'mb'
        ? 1024 ** 2
        : unit === 'gb'
          ? 1024 ** 3
          : unit === 'tb'
            ? 1024 ** 4
            : undefined
  return multiplier && Number.isFinite(amount) ? amount * multiplier : undefined
}

export function modelFitLabel(model: ModelProfile, hostMemory: string | null): string {
  const hostBytes = parseMemoryBytes(hostMemory)
  if (!hostBytes || !model.fileSizeBytes || model.fileSizeBytes <= 0) return 'Unknown'
  const estimatedBytes = model.fileSizeBytes * 1.35
  const ratio = estimatedBytes / hostBytes
  if (ratio <= 0.35) return 'Excellent'
  if (ratio <= 0.6) return 'Good'
  if (ratio <= 0.85) return 'May use system RAM'
  if (ratio <= 1) return 'Memory constrained'
  return 'Not recommended'
}

export function isChatSelectable(model: ModelProfile): boolean {
  return model.status === 'ready' && model.compatibilityStatus !== 'not-chat-compatible'
}

function modelStatusLabel(model: ModelProfile): string {
  if (model.status === 'not-found') return 'Unavailable'
  if (model.compatibilityStatus === 'not-chat-compatible') return 'Not chat-compatible'
  if (model.compatibilityStatus === 'unknown') return 'Compatibility unknown'
  return 'Ready'
}

export function labelExecutionLocation(value: string): string {
  if (value === 'on-device') return 'ON DEVICE'
  if (value === 'local-network') return 'LOCAL NETWORK'
  if (value === 'remote') return 'REMOTE'
  return 'UNKNOWN'
}

function locationForUrl(value: string): 'on-device' | 'local-network' | 'remote' | 'unknown' {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'on-device'
    if (host.endsWith('.local') || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return 'local-network'
    }
    return 'remote'
  } catch {
    return 'unknown'
  }
}

export function SettingsPage({
  data,
  update,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
}) {
  const settings = data.settings
  const [memoryDraft, setMemoryDraft] = useState('')
  function addMemory(event: FormEvent) {
    event.preventDefault()
    const content = memoryDraft.trim()
    if (!content) return
    const timestamp = now()
    update((current) => ({
      ...current,
      memories: [
        ...current.memories,
        {
          id: uid('memory'),
          content,
          source: 'user',
          enabled: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }))
    setMemoryDraft('')
  }
  return (
    <>
      <PageHeading
        eyebrow="Make Juniper yours"
        title="Settings"
        description="Simple defaults on the surface, deeper controls when you want them."
      />
      <div className="settings-grid">
        <section className="settings-card">
          <span className="eyebrow">Appearance</span>
          <h2>A space that feels like yours</h2>
          <div className="setting-row">
            <div>
              <strong>Theme</strong>
              <small>Choose how Juniper looks</small>
            </div>
            <select
              value={settings.theme}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    theme: event.target.value as AppData['settings']['theme'],
                  },
                }))
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Accent color</strong>
              <small>Used for focus and assistant identity</small>
            </div>
            <input
              className="color-input"
              type="color"
              value={settings.accent}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, accent: event.target.value },
                }))
              }
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Reduce motion</strong>
              <small>Respect a calmer interface</small>
            </div>
            <button
              className={`switch ${settings.reducedMotion ? 'on' : ''}`}
              onClick={() =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, reducedMotion: !current.settings.reducedMotion },
                }))
              }
              aria-label="Toggle reduced motion"
            >
              <span />
            </button>
          </div>
        </section>
        <section className="settings-card">
          <span className="eyebrow">Experience</span>
          <h2>How Juniper behaves</h2>
          <div className="setting-row">
            <div>
              <strong>Chat density</strong>
              <small>Give messages more breathing room</small>
            </div>
            <select
              value={settings.density}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    density: event.target.value as AppData['settings']['density'],
                  },
                }))
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>Font scale</strong>
              <small>Scales the whole interface</small>
            </div>
            <input
              type="range"
              min="0.9"
              max="1.2"
              step="0.05"
              value={settings.fontScale}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, fontScale: Number(event.target.value) },
                }))
              }
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>Developer mode</strong>
              <small>Context inspector and provider details</small>
            </div>
            <button
              className={`switch ${settings.developerMode ? 'on' : ''}`}
              onClick={() =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, developerMode: !current.settings.developerMode },
                }))
              }
              aria-label="Toggle developer mode"
            >
              <span />
            </button>
          </div>
        </section>
        <section className="settings-card full">
          <span className="eyebrow">Advanced</span>
          <h2>Power-user controls</h2>
          <p>
            Provider-specific generation controls are capability-detected and stay out of the normal
            chat screen. No unsupported parameter is sent to a provider.
          </p>
          <div className="advanced-links">
            <button
              onClick={() =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, developerMode: true },
                }))
              }
            >
              Open developer mode <span>→</span>
            </button>
            <button disabled title="Runtime limits are managed by the provider in this release">
              Runtime and process limits <small>Unavailable</small>
            </button>
            <button
              disabled
              title="MCP is an explicitly unavailable advanced feature in this release"
            >
              MCP servers <small>Unavailable</small>
            </button>
          </div>
        </section>
        <section className="settings-card full">
          <span className="eyebrow">Memory</span>
          <h2>Small, visible, and yours</h2>
          <p>
            Juniper only uses memories you can see here. Nothing is silently added to this list.
          </p>
          <form className="memory-form" onSubmit={addMemory}>
            <input
              value={memoryDraft}
              onChange={(event) => setMemoryDraft(event.target.value)}
              placeholder="Add a preference or helpful fact…"
              aria-label="New memory"
              maxLength={1000}
            />
            <button className="primary-button" type="submit">
              Save memory
            </button>
          </form>
          <div className="memory-list">
            {data.memories.length === 0 ? (
              <span className="empty-small">No curated memories yet.</span>
            ) : (
              data.memories.map((memory) => (
                <div className="memory-item" key={memory.id}>
                  <button
                    className={`switch ${memory.enabled ? 'on' : ''}`}
                    onClick={() =>
                      update((current) => ({
                        ...current,
                        memories: current.memories.map((item) =>
                          item.id === memory.id ? { ...item, enabled: !item.enabled } : item,
                        ),
                      }))
                    }
                    aria-label={`Toggle memory ${memory.content}`}
                  >
                    <span />
                  </button>
                  <span>{memory.content}</span>
                  <button
                    className="text-button"
                    onClick={() =>
                      update((current) => ({
                        ...current,
                        memories: current.memories.filter((item) => item.id !== memory.id),
                      }))
                    }
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  )
}

export function PrivacyPage({
  data,
  update,
  activeAssistant,
  activeModel,
  activeProvider,
  currentConversation,
}: {
  data: AppData
  update: (change: (current: AppData) => AppData) => void
  activeAssistant: Assistant
  activeModel?: ModelProfile
  activeProvider?: ProviderProfile
  currentConversation?: AppData['conversations'][number]
}) {
  const model = activeModel
  const provider = activeProvider
  const privateChat = currentConversation?.privateChat === true
  const networkTools = 'Off — no network tools are enabled in this release.'
  function clearChats() {
    if (window.confirm('Clear all saved chats?'))
      update((current) => ({
        ...current,
        conversations: [],
        attachments: [],
        permissions: current.permissions.filter((grant) => grant.scope !== 'chat'),
      }))
  }
  function clearMemory() {
    if (window.confirm('Clear all curated memories?'))
      update((current) => ({ ...current, memories: [] }))
  }
  return (
    <>
      <PageHeading
        eyebrow="Your data"
        title="Privacy center"
        description="See what stays on this machine and what would leave it."
      />
      <div className="privacy-grid">
        <section className="privacy-card privacy-hero">
          <div className="privacy-orb">✓</div>
          <div>
            <span className="eyebrow">Telemetry</span>
            <h2>Off</h2>
            <p>
              Juniper v0.2 has no analytics, advertising, crash reporting, or automatic conversation
              uploads.
            </p>
          </div>
        </section>
        <section className="privacy-card">
          <span className="eyebrow">Current route</span>
          <dl className="privacy-details">
            <div>
              <dt>Assistant</dt>
              <dd>{activeAssistant.name}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{model?.displayName ?? 'No model selected'}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{provider?.name ?? 'No provider selected'}</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>
                <span className={`status-pill ${model?.executionLocation ?? 'unknown'}`}>
                  <i />
                  {labelExecutionLocation(model?.executionLocation ?? 'unknown')}
                </span>
              </dd>
            </div>
            <div>
              <dt>Persistence</dt>
              <dd>
                {currentConversation
                  ? privateChat
                    ? 'PRIVATE · SESSION ONLY'
                    : 'SAVED'
                  : 'No active chat'}
              </dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>
                {activeAssistant.memoryPolicy === 'curated' ? 'Curated memory enabled' : 'Off'}
              </dd>
            </div>
            <div>
              <dt>Network tools</dt>
              <dd>{networkTools}</dd>
            </div>
          </dl>
          <p>
            {model?.executionLocation === 'remote'
              ? `Prompts sent to ${provider?.name ?? 'this provider'} leave the device. This is explicit and visible.`
              : model?.executionLocation === 'on-device'
                ? 'Prompts remain on this device while using this model.'
                : model?.executionLocation === 'local-network'
                  ? 'Prompts are sent to another device on your local network.'
                  : 'Execution location is UNKNOWN until the provider reports enough information.'}
          </p>
        </section>
        <section className="privacy-card">
          <span className="eyebrow">Persistence</span>
          <div className="privacy-stat">
            <strong>
              {data.conversations.filter((chat) => !chat.privateChat).length} saved chats
            </strong>
            <span>{data.memories.filter((memory) => memory.enabled).length} memories on</span>
          </div>
          <p>Private chats are not written to the persistent data store after this session.</p>
        </section>
      </div>
      <div className="privacy-actions">
        <div>
          <span className="eyebrow">You are in control</span>
          <h2>Data actions</h2>
          <p>Exports never include provider API keys.</p>
        </div>
        <div className="action-buttons">
          <button
            className="secondary-button"
            onClick={() =>
              download(
                'juniper-export.json',
                JSON.stringify(
                  {
                    format: 'juniper-export',
                    version: 2,
                    ...data,
                    providers: data.providers.map(redactProvider),
                  },
                  null,
                  2,
                ),
                'application/json',
              )
            }
          >
            Export data
          </button>
          <button className="secondary-button" onClick={clearChats}>
            Clear chats
          </button>
          <button className="secondary-button" onClick={clearMemory}>
            Clear memory
          </button>
        </div>
      </div>
    </>
  )
}

export function DiagnosticsPage({ data }: { data: AppData }) {
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({})
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([])
  useEffect(() => {
    void getDiagnostics().then(setDiagnostics)
    void getRuntimeLogs().then(setLogs)
  }, [])
  return (
    <>
      <PageHeading
        eyebrow="Advanced"
        title="Diagnostics"
        description="Truthful runtime details for troubleshooting — never API secrets."
      />
      <div className="diagnostics-grid">
        <section className="diagnostics-card">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <h2>Runtime</h2>
              <p>Application and host information</p>
            </div>
          </div>
          {Object.entries({
            ...diagnostics,
            database: 'SQLite schema v3',
            telemetry: 'Off',
            models: `${data.models.length} profile(s)`,
          }).map(([key, value]) => (
            <div className="diagnostic-row" key={key}>
              <span>{key.replaceAll('_', ' ')}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
        <section className="diagnostics-card">
          <div className="section-heading">
            <span className="section-number">02</span>
            <div>
              <h2>Provider capabilities</h2>
              <p>Unknown is not treated as supported.</p>
            </div>
          </div>
          {data.providers.map((provider) => (
            <div className="diagnostic-provider" key={provider.id}>
              <div>
                <strong>{provider.name}</strong>
                <small>{provider.baseUrl}</small>
              </div>
              <span className={`status-pill ${provider.transportLocation}`}>
                <i />
                {labelExecutionLocation(provider.transportLocation)}
              </span>
            </div>
          ))}
          <div className="diagnostic-note">
            Model qualification is capability-aware. Real generation qualification is pending until
            the owner chooses an installed model.
          </div>
        </section>
        <section className="diagnostics-card">
          <div className="section-heading">
            <span className="section-number">03</span>
            <div>
              <h2>Runtime events</h2>
              <p>Bounded metadata only; private content and credentials are never recorded.</p>
            </div>
          </div>
          {logs.length === 0 ? (
            <div className="diagnostic-note">
              No native runtime events recorded in this session.
            </div>
          ) : (
            <div className="diagnostic-log" role="log" aria-label="Runtime events">
              {[...logs].reverse().map((entry, index) => (
                <div className="diagnostic-row" key={`${entry.timestamp}-${entry.event}-${index}`}>
                  <span>{entry.event.replaceAll('_', ' ')}</span>
                  <strong>
                    {[entry.providerKind, entry.modelId, entry.code].filter(Boolean).join(' · ') ||
                      'ok'}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [runtimeStatus, setRuntimeStatus] = useState('Checking for supported local runtimes…')
  useEffect(() => {
    if (!runningInTauri) {
      setRuntimeStatus('Browser development preview')
      return
    }
    void checkProviderConnection(defaultProvider)
      .then(() => listProviderModels(defaultProvider))
      .then((models) =>
        setRuntimeStatus(
          `Ollama detected · ${models.length} installed model${models.length === 1 ? '' : 's'}`,
        ),
      )
      .catch(() => setRuntimeStatus('Ollama not detected · add a provider in Models'))
  }, [])
  const steps = [
    {
      eyebrow: 'Welcome to Juniper',
      title: 'Your AI. Your models. Your machine.',
      copy: 'A local-first environment that turns compatible models into personal Juniper assistants.',
      art: 'J',
    },
    {
      eyebrow: 'Private by default',
      title: 'Nothing leaves unless you choose it.',
      copy: 'No account required. Local chats stay local. Remote providers and network tools are clearly marked when you opt in.',
      art: '✓',
    },
    {
      eyebrow: 'Start with a model',
      title: 'Bring the intelligence you trust.',
      copy: `${runtimeStatus}. Juniper works with compatible models through supported runtimes; add one in Models when you are ready.`,
      art: '◈',
    },
    {
      eyebrow: 'Meet Juniper',
      title: 'A capable older sister for the things you’re figuring out.',
      copy: 'Warm, practical, direct, and honest about uncertainty. Customize the personality whenever you like.',
      art: '✦',
    },
  ]
  const current = steps[step]!
  return (
    <div className="onboarding-backdrop">
      <div className="onboarding">
        <div className="onboarding-art">
          <div className="onboarding-orb">{current.art}</div>
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <div className="onboarding-progress">
            {steps.map((_, index) => (
              <span key={index} className={index <= step ? 'active' : ''} />
            ))}
          </div>
        </div>
        <div className="onboarding-copy">
          <span className="eyebrow">{current.eyebrow}</span>
          <h1>{current.title}</h1>
          <p>{current.copy}</p>
          <div className="onboarding-actions">
            {step > 0 && (
              <button className="text-button" onClick={() => setStep((value) => value - 1)}>
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="primary-button" onClick={() => setStep((value) => value + 1)}>
                Continue <span>→</span>
              </button>
            ) : (
              <button className="primary-button" onClick={onDone}>
                Enter Juniper <span>→</span>
              </button>
            )}
          </div>
          <small className="onboarding-footnote">
            No account. No telemetry. You can revisit setup in Settings.
          </small>
        </div>
      </div>
    </div>
  )
}

function redactProvider(provider: ProviderProfile): ProviderProfile {
  const safe = { ...provider }
  delete safe.apiKeyRef
  return safe
}
export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
