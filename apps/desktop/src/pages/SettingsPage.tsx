import { useEffect, useState } from 'react'
import type {
  BackendHealth,
  BackendServiceName,
  BackendServiceStatus,
  LLMProviderSettings,
  SopLimitsSettings,
  SopLimitsSettingsUpdate
} from '../../shared/connection'
import type { ExperimentalFlags } from '../../shared/settings'
import { useConnection } from '../features/connection/useConnection'
import { useServices } from '../features/connection/useServices'
import {
  useTheme,
  type Theme
} from '../features/theme/ThemeContext'

function cleanError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : 'Account action failed.'

  return message
    .replace(
      /^Error invoking remote method '[^']+': Error:\s*/i,
      ''
    )
    .replace(/^Error:\s*/i, '')
}

export function SettingsPage() {
  const { status, logout, test } = useConnection()
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'
  const services = useServices(
    status.hasSession && status.state === 'connected'
  )

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const account = status.account

  const signOut = async () => {
    setBusy(true)
    setError(null)

    try {
      await logout()
    } catch (logoutError) {
      setError(cleanError(logoutError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={
        isDark
          ? 'px-5 py-5 md:px-8'
          : 'dashboard-page'
      }
    >
      <div
        className={
          isDark
            ? 'mx-auto max-w-3xl'
            : 'dashboard-container settings-container'
        }
      >
        <AppearanceSection
          theme={theme}
          onChange={setTheme}
          isDark={isDark}
        />

        <ServiceStatusSection
          health={services}
          connected={status.state === 'connected'}
          isDark={isDark}
        />

        <div
          className={
            isDark
              ? 'mt-5 overflow-hidden rounded-xl border border-white/15 bg-[#0c0c0c]'
              : 'settings-card'
          }
        >
          <div
            className={
              isDark
                ? 'flex items-center justify-between border-b border-white/10 px-6 py-5'
                : 'settings-card-header'
            }
          >
            <div>
              {isDark ? (
                <>
                  <p className="text-sm font-bold">
                    {account?.companyName || 'WorkTrace workspace'}
                  </p>

                  <p className="mt-1 text-xs text-white/45">
                    {status.apiUrl}
                  </p>
                </>
              ) : (
                <>
                  <p className="settings-label">
                    Workspace
                  </p>

                  <h2>
                    {account?.companyName || 'WorkTrace workspace'}
                  </h2>

                  <p>{status.apiUrl}</p>
                </>
              )}
            </div>

            <ConnectionBadge
              state={status.state}
              isDark={isDark}
            />
          </div>

          <dl
            className={
              isDark
                ? 'grid gap-px bg-white/10 sm:grid-cols-2'
                : 'settings-grid'
            }
          >
            <AccountDetail
              label="Email"
              value={account?.email || '—'}
              isDark={isDark}
            />

            <AccountDetail
              label="Role"
              value={account?.role || '—'}
              capitalize
              isDark={isDark}
            />

            <AccountDetail
              label="Tenant ID"
              value={account?.tenantId || '—'}
              mono
              isDark={isDark}
            />

            <AccountDetail
              label="User ID"
              value={account?.userId || '—'}
              mono
              isDark={isDark}
            />
          </dl>

          {(error || status.error) && (
            <p
              className={
                isDark
                  ? 'mx-6 mt-5 rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-3 text-xs leading-5 text-red-300'
                  : 'settings-error'
              }
            >
              {error || status.error}
            </p>
          )}

          <div
            className={
              isDark
                ? 'flex flex-wrap justify-end gap-3 border-t border-white/10 px-6 py-5'
                : 'settings-actions'
            }
          >
            <button
              type="button"
              disabled={busy || status.state === 'checking'}
              onClick={() => void test()}
              className={
                isDark
                  ? 'rounded-lg border border-white/15 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-white/8 disabled:opacity-50'
                  : 'secondary-button'
              }
            >
              Test connection
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void signOut()}
              className={
                isDark
                  ? 'rounded-lg border border-red-500/35 bg-red-500/8 px-5 py-2.5 text-xs font-bold text-red-300 transition hover:bg-red-500/15 disabled:opacity-50'
                  : 'delete-button'
              }
            >
              {busy ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>

        <div
          className={
            isDark
              ? 'mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-5'
              : 'security-card'
          }
        >
          <p
            className={
              isDark
                ? 'text-xs font-bold'
                : ''
            }
          >
            Credential security
          </p>

          {isDark ? (
            <p className="mt-2 text-xs leading-5 text-white/45">
              The access token is encrypted using the operating system
              credential service. React receives only your account and
              connection status, never the token.
            </p>
          ) : (
            <span>
              The access token is encrypted using the operating system
              credential service. React receives only your account and
              connection status, never the token.
            </span>
          )}
        </div>

        <LLMProviderSection
          enabled={
            status.hasSession &&
            status.state === 'connected'
          }
          isDark={isDark}
        />

        <SopLimitsSection
          enabled={
            status.hasSession &&
            status.state === 'connected'
          }
          isDark={isDark}
        />

        <ExperimentalSection isDark={isDark} />
      </div>
    </section>
  )
}

const serviceOrder: Array<{
  key: BackendServiceName
  label: string
}> = [
  { key: 'api', label: 'API' },
  { key: 'database', label: 'Database' },
  { key: 'redis', label: 'Redis' },
  { key: 'celery', label: 'Celery worker' },
  { key: 'annotation', label: 'Annotation' },
  { key: 'redaction', label: 'AI redaction' },
  { key: 'transcription', label: 'Transcription' },
  { key: 'llm', label: 'LLM provider' }
]

const serviceStatusLabels: Record<BackendServiceStatus, string> = {
  up: 'Online',
  down: 'Offline',
  starting: 'Starting',
  unconfigured: 'Setup needed',
  unknown: 'Unknown'
}

function ServiceStatusSection({
  health,
  connected,
  isDark
}: {
  health: BackendHealth | null
  connected: boolean
  isDark: boolean
}) {
  const onlineCount = health
    ? serviceOrder.filter(
        ({ key }) => health.services[key]?.status === 'up'
      ).length
    : 0

  return (
    <div
      className={
        isDark
          ? 'mt-5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]'
          : 'mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]'
      }
    >
      {!isDark && (
        <div className="h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
      )}

      <div
        className={
          isDark
            ? 'flex items-center justify-between border-b border-white/10 px-5 py-4'
            : 'flex items-center justify-between gap-5 border-b border-slate-200 px-6 py-5'
        }
      >
        <div>
          <p
            className={
              isDark
                ? 'text-xs font-bold text-white'
                : 'settings-label'
            }
          >
            Service health
          </p>

          <p
            className={
              isDark
                ? 'mt-1 text-xs text-white/45'
                : 'mt-1 text-sm leading-6 text-slate-500'
            }
          >
            Live backend capabilities · updates every 10 seconds
          </p>
        </div>

        <span
          className={
            isDark
              ? 'font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45'
              : 'rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500'
          }
        >
          {health
            ? `${onlineCount} / ${serviceOrder.length} online`
            : connected
              ? 'Checking…'
              : 'API offline'}
        </span>
      </div>

      <div
        className={
          isDark
            ? 'grid gap-px bg-white/10 sm:grid-cols-2'
            : 'grid gap-px bg-slate-200 sm:grid-cols-2'
        }
      >
        {serviceOrder.map(({ key, label }) => {
          const service = health?.services[key]
          const state: BackendServiceStatus = service?.status ?? 'unknown'

          return (
            <div
              key={key}
              className={
                isDark
                  ? 'flex min-h-24 items-start gap-3 bg-[#0c0c0c] px-5 py-4'
                  : 'flex min-h-24 items-start gap-3 bg-white px-6 py-4'
              }
            >
              <ServiceDot status={state} isDark={isDark} />

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p
                    className={
                      isDark
                        ? 'text-xs font-bold text-white'
                        : 'text-sm font-bold text-slate-900'
                    }
                  >
                    {label}
                  </p>

                  <span
                    className={
                      isDark
                        ? 'font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white/40'
                        : 'text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400'
                    }
                  >
                    {serviceStatusLabels[state]}
                  </span>
                </div>

                <p
                  className={
                    isDark
                      ? 'mt-1.5 text-[11px] leading-4 text-white/40'
                      : 'mt-1.5 text-xs leading-5 text-slate-500'
                  }
                >
                  {service?.detail ?? 'Waiting for a health response.'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ServiceDot({
  status,
  isDark
}: {
  status: BackendServiceStatus
  isDark: boolean
}) {
  const color = {
    up: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.45)]',
    down: 'bg-red-400',
    starting: 'animate-pulse bg-amber-400',
    unconfigured: 'bg-amber-400',
    unknown: isDark ? 'bg-white/25' : 'bg-slate-300'
  }[status]

  return <span className={`mt-1 size-2.5 shrink-0 rounded-full ${color}`} />
}

function AppearanceSection({
  theme,
  onChange,
  isDark
}: {
  theme: Theme
  onChange: (theme: Theme) => void
  isDark: boolean
}) {
  const isLight = theme === 'light'

  return (
    <div
      className={
        isDark
          ? 'flex items-center justify-between gap-5 rounded-xl border border-white/10 bg-white/[0.025] p-5'
          : 'flex items-center justify-between gap-5 rounded-3xl border border-slate-200 bg-white px-7 py-6 shadow-[0_16px_45px_rgba(95,60,150,0.08)]'
      }
    >
      <div>
        <p
          className={
            isDark
              ? 'font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/35'
              : 'text-xs font-black uppercase tracking-[0.16em] text-[#a66ad8]'
          }
        >
          Appearance
        </p>

        <h2
          className={
            isDark
              ? 'mt-2 text-sm font-bold text-white'
              : 'mt-2 text-lg font-black tracking-[-0.02em] text-slate-900'
          }
        >
          Application theme
        </h2>

        <p
          className={
            isDark
              ? 'mt-1 text-xs leading-5 text-white/45'
              : 'mt-1 text-sm leading-6 text-slate-500'
          }
        >
          Use the original dark interface or the optional light interface.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span
          className={
            theme === 'dark'
              ? isDark
                ? 'text-xs font-bold text-white'
                : 'text-xs font-bold text-slate-900'
              : isDark
                ? 'text-xs font-bold text-white/35'
                : 'text-xs font-bold text-slate-400'
          }
        >
          Dark
        </span>

        <button
          type="button"
          role="switch"
          aria-label="Switch application theme"
          aria-checked={isLight}
          onClick={() =>
            onChange(isLight ? 'dark' : 'light')
          }
          className={[
            'relative flex h-7 w-[52px] shrink-0 items-center rounded-full border p-[3px] transition',
            isLight
              ? 'border-purple-400 bg-gradient-to-r from-[#a66ad8] to-[#d783b6]'
              : 'border-white/20 bg-white/10'
          ].join(' ')}
        >
          <span
            className={[
              'block size-5 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-transform',
              isLight
                ? 'translate-x-6'
                : 'translate-x-0'
            ].join(' ')}
          />
        </button>

        <span
          className={
            theme === 'light'
              ? 'text-xs font-bold text-slate-900'
              : isDark
                ? 'text-xs font-bold text-white/35'
                : 'text-xs font-bold text-slate-400'
          }
        >
          Light
        </span>
      </div>
    </div>
  )
}

function LLMProviderSection({
  enabled,
  isDark
}: {
  enabled: boolean
  isDark: boolean
}) {
  const [settings, setSettings] =
    useState<LLMProviderSettings | null>(null)

  const [baseUrl, setBaseUrl] = useState(
    'https://openrouter.ai/api/v1'
  )

  const [model, setModel] =
    useState('openai/gpt-4o')

  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!enabled) return

      setBusy(true)
      setError(null)

      try {
        const current =
          await window.api.connection.getLLMProviderSettings()

        if (!active) return

        setSettings(current)
        setBaseUrl(current.base_url)
        setModel(current.model)
      } catch (loadError) {
        if (active) {
          setError(cleanError(loadError))
        }
      } finally {
        if (active) {
          setBusy(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [enabled])

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)

    try {
      const next =
        await window.api.connection.saveLLMProviderSettings({
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_key: apiKey.trim() || null,
          clear_api_key: clearApiKey
        })

      setSettings(next)
      setBaseUrl(next.base_url)
      setModel(next.model)
      setApiKey('')
      setClearApiKey(false)
      setSaved(true)
    } catch (saveError) {
      setError(cleanError(saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={
        isDark
          ? 'mt-5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]'
          : 'mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]'
      }
    >
      {!isDark && (
        <div className="h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
      )}

      <div
        className={
          isDark
            ? 'flex items-center justify-between border-b border-white/10 px-5 py-4'
            : 'flex items-center justify-between gap-5 border-b border-slate-200 px-6 py-5'
        }
      >
        <div>
          {isDark ? (
            <>
              <p className="text-xs font-bold">
                LLM provider
              </p>

              <p className="mt-1 text-xs text-white/45">
                OpenRouter-compatible generation settings.
              </p>
            </>
          ) : (
            <>
              <p className="settings-label">
                AI generation
              </p>

              <h2 className="mt-1 text-lg font-black tracking-[-0.02em] text-slate-900">
                LLM provider
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-500">
                OpenRouter-compatible generation settings.
              </p>
            </>
          )}
        </div>

        {isDark ? (
          <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
            <span
              className={`size-1.5 rounded-full ${
                settings?.has_api_key
                  ? 'bg-emerald-400'
                  : 'bg-white/25'
              }`}
            />

            {settings?.has_api_key ? 'Key saved' : 'No key'}
          </span>
        ) : (
          <span
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
              settings?.has_api_key
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            <span
              className={`size-2 rounded-full ${
                settings?.has_api_key
                  ? 'bg-emerald-500'
                  : 'bg-slate-300'
              }`}
            />

            {settings?.has_api_key ? 'Key saved' : 'No key'}
          </span>
        )}
      </div>

      <div
        className={
          isDark
            ? 'grid gap-4 p-5'
            : 'grid gap-5 p-6'
        }
      >
        <TextInput
          label="Endpoint"
          value={baseUrl}
          disabled={!enabled || busy}
          placeholder="https://openrouter.ai/api/v1"
          onChange={setBaseUrl}
          isDark={isDark}
        />

        <TextInput
          label="Model"
          value={model}
          disabled={!enabled || busy}
          placeholder="openai/gpt-4o"
          onChange={setModel}
          isDark={isDark}
        />

        <TextInput
          label="API key"
          value={apiKey}
          disabled={!enabled || busy || clearApiKey}
          placeholder={
            settings?.has_api_key
              ? 'Saved key remains unchanged'
              : 'sk-or-...'
          }
          secret
          onChange={setApiKey}
          isDark={isDark}
        />

        <label
          className={
            isDark
              ? 'flex items-center gap-3 text-xs text-white/55'
              : 'flex items-center gap-3 text-sm font-medium text-slate-600'
          }
        >
          <input
            type="checkbox"
            className={
              isDark
                ? 'size-4 accent-emerald-400'
                : 'size-4 accent-[#a66ad8]'
            }
            checked={clearApiKey}
            disabled={!enabled || busy}
            onChange={(event) =>
              setClearApiKey(event.target.checked)
            }
          />

          Clear saved API key
        </label>

        {(error || saved) && (
          <p
            className={[
              isDark
                ? 'rounded-lg border px-4 py-3 text-xs leading-5'
                : 'rounded-xl border px-4 py-3 text-sm leading-6',
              error
                ? isDark
                  ? 'border-red-500/25 bg-red-500/8 text-red-300'
                  : 'border-red-200 bg-red-50 text-red-600'
                : isDark
                  ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            ].join(' ')}
          >
            {error || 'Provider settings saved.'}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={
              !enabled ||
              busy ||
              !baseUrl.trim() ||
              !model.trim()
            }
            onClick={() => void save()}
            className={
              isDark
                ? 'rounded-lg border border-white/15 bg-white px-5 py-2.5 text-xs font-black text-black transition hover:bg-white/90 disabled:opacity-50'
                : 'rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.3)] disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {busy ? 'Saving...' : 'Save provider'}
          </button>
        </div>
      </div>
    </div>
  )
}

type SopLimitField = keyof SopLimitsSettingsUpdate

const sopLimitFields: Array<{
  key: SopLimitField
  label: string
  hint: string
}> = [
  {
    key: 'sop_max_evidence_steps',
    label: 'Max evidence steps',
    hint: 'Hard stop for very long recordings before SOP generation starts.'
  },
  {
    key: 'sop_max_vision_frames',
    label: 'Vision frames',
    hint: 'How many annotated screenshots are attached to the LLM request.'
  },
  {
    key: 'sop_image_max_dimension_px',
    label: 'Image max side',
    hint: 'Screenshots are resized to this max width or height before LLM upload.'
  },
  {
    key: 'sop_image_jpeg_quality',
    label: 'JPEG quality',
    hint: 'Compression quality for screenshots sent to the LLM.'
  },
  {
    key: 'sop_max_output_tokens',
    label: 'Output tokens',
    hint: 'Maximum structured SOP response size.'
  }
]

function SopLimitsSection({
  enabled,
  isDark
}: {
  enabled: boolean
  isDark: boolean
}) {
  const [settings, setSettings] =
    useState<SopLimitsSettings | null>(null)

  const [draft, setDraft] = useState<
    Record<SopLimitField, string>
  >({
    sop_max_evidence_steps: '',
    sop_max_vision_frames: '',
    sop_image_max_dimension_px: '',
    sop_image_jpeg_quality: '',
    sop_max_output_tokens: ''
  })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const syncDraft = (next: SopLimitsSettings) => {
    setSettings(next)

    setDraft({
      sop_max_evidence_steps:
        String(next.sop_max_evidence_steps),

      sop_max_vision_frames:
        String(next.sop_max_vision_frames),

      sop_image_max_dimension_px:
        String(next.sop_image_max_dimension_px),

      sop_image_jpeg_quality:
        String(next.sop_image_jpeg_quality),

      sop_max_output_tokens:
        String(next.sop_max_output_tokens)
    })
  }

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!enabled) return

      setBusy(true)
      setError(null)

      try {
        const current =
          await window.api.connection.getSopLimitsSettings()

        if (active) {
          syncDraft(current)
        }
      } catch (loadError) {
        if (active) {
          setError(cleanError(loadError))
        }
      } finally {
        if (active) {
          setBusy(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [enabled])

  const save = async () => {
    if (!settings) return

    setBusy(true)
    setError(null)
    setSaved(false)

    try {
      const payload: SopLimitsSettingsUpdate = {}

      for (const field of sopLimitFields) {
        const raw = draft[field.key].trim()

        if (
          !raw ||
          Number(raw) === settings.defaults[field.key]
        ) {
          payload[field.key] = null
        } else {
          payload[field.key] = Number(raw)
        }
      }

      const next =
        await window.api.connection.saveSopLimitsSettings(
          payload
        )

      syncDraft(next)
      setSaved(true)
    } catch (saveError) {
      setError(cleanError(saveError))
    } finally {
      setBusy(false)
    }
  }

  const resetField = (field: SopLimitField) => {
    if (!settings) return

    setDraft((current) => ({
      ...current,
      [field]: String(settings.defaults[field])
    }))
  }

  return (
    <div
      className={
        isDark
          ? 'mt-5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]'
          : 'mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]'
      }
    >
      {!isDark && (
        <div className="h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />
      )}

      <div
        className={
          isDark
            ? 'border-b border-white/10 px-5 py-4'
            : 'border-b border-slate-200 px-6 py-5'
        }
      >
        {isDark ? (
          <>
            <p className="text-xs font-bold">
              SOP generation limits
            </p>

            <p className="mt-1 text-xs text-white/45">
              Tenant guardrails for LLM request size.
            </p>
          </>
        ) : (
          <>
            <p className="settings-label">
              Generation controls
            </p>

            <h2 className="mt-1 text-lg font-black tracking-[-0.02em] text-slate-900">
              SOP generation limits
            </h2>

            <p className="mt-1 text-sm leading-6 text-slate-500">
              Tenant guardrails for LLM request size.
            </p>
          </>
        )}
      </div>

      <div
        className={
          isDark
            ? 'grid gap-3 p-5'
            : 'grid gap-3 p-6'
        }
      >
        {sopLimitFields.map((field) => {
          const overridden =
            settings?.overridden[field.key] ?? false

          const defaultValue =
            settings?.defaults[field.key]

          return (
            <div
              key={field.key}
              className={
                isDark
                  ? 'grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 sm:grid-cols-[1fr_150px_auto]'
                  : 'grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-[1fr_150px_auto] sm:items-center'
              }
            >
              <div>
                <p
                  className={
                    isDark
                      ? 'text-sm font-bold text-white/85'
                      : 'text-sm font-bold text-slate-800'
                  }
                >
                  {field.label}
                </p>

                <p
                  className={
                    isDark
                      ? 'mt-1 text-xs leading-5 text-white/45'
                      : 'mt-1 text-xs leading-5 text-slate-500'
                  }
                >
                  {field.hint}
                </p>
              </div>

              <input
                type="number"
                value={draft[field.key]}
                disabled={
                  !enabled ||
                  busy ||
                  settings === null
                }
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: event.target.value
                  }))
                }
                className={
                  isDark
                    ? 'h-10 rounded-lg border border-white/10 bg-black/35 px-3 text-sm text-white outline-none transition focus:border-emerald-400/50 disabled:opacity-50'
                    : 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60'
                }
              />

              <button
                type="button"
                disabled={
                  !enabled ||
                  busy ||
                  settings === null ||
                  !overridden
                }
                onClick={() =>
                  resetField(field.key)
                }
                className={
                  isDark
                    ? 'h-10 rounded-lg border border-white/10 px-3 text-xs font-black uppercase tracking-[0.1em] text-white/55 transition hover:bg-white/8 disabled:opacity-35'
                    : 'h-10 rounded-lg border border-purple-200 bg-white px-3 text-xs font-bold text-purple-700 transition hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:opacity-60'
                }
              >
                {overridden
                  ? 'Default'
                  : `Default ${defaultValue ?? ''}`}
              </button>
            </div>
          )
        })}

        {(error || saved) && (
          <p
            className={[
              isDark
                ? 'rounded-lg border px-4 py-3 text-xs leading-5'
                : 'rounded-xl border px-4 py-3 text-sm leading-6',
              error
                ? isDark
                  ? 'border-red-500/25 bg-red-500/8 text-red-300'
                  : 'border-red-200 bg-red-50 text-red-600'
                : isDark
                  ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            ].join(' ')}
          >
            {error || 'SOP limits saved.'}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={
              !enabled ||
              busy ||
              settings === null
            }
            onClick={() => void save()}
            className={
              isDark
                ? 'rounded-lg border border-white/15 bg-white px-5 py-2.5 text-xs font-black text-black transition hover:bg-white/90 disabled:opacity-50'
                : 'rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.3)] disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {busy ? 'Saving...' : 'Save limits'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExperimentalSection({
  isDark
}: {
  isDark: boolean
}) {
  const [flags, setFlags] =
    useState<ExperimentalFlags | null>(null)

  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const current =
          await window.api.settings.getFlags()

        if (active) {
          setFlags(current)
        }
      } catch {
        // Settings are best-effort.
      }
    }

    void load()

    const off =
      window.api.settings.onFlagsChanged(
        (next) => setFlags(next)
      )

    return () => {
      active = false
      off()
    }
  }, [])

  const toggle = async (
    flag: keyof ExperimentalFlags,
    value: boolean
  ) => {
    setBusy(true)

    try {
      await window.api.settings.setFlag(
        flag,
        value
      )
    } finally {
      setBusy(false)
    }
  }

  if (isDark) {
    return (
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-5">
        <p className="text-xs font-bold">
          Experimental
        </p>

        <div className="mt-4 space-y-4">
          <FlagToggle
            title="Pause SOP generation"
            description="Wait until you review the transcript and annotations before generating the first SOP. Evidence editing and regeneration stay available afterwards either way."
            checked={flags?.manualMode ?? false}
            disabled={busy || flags === null}
            onChange={(value) =>
              void toggle('manualMode', value)
            }
            isDark
          />

          <FlagToggle
            title="Accessibility capture"
            description="Also query the focused UI element for more precise click bounds. Requires Accessibility permission and affects the next recording."
            checked={
              flags?.accessibilityCapture ?? false
            }
            disabled={busy || flags === null}
            onChange={(value) =>
              void toggle('accessibilityCapture', value)
            }
            isDark
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]">
      <div className="h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />

      <div className="border-b border-slate-200 px-6 py-5">
        <p className="settings-label">
          Advanced
        </p>

        <h2 className="mt-1 text-lg font-black tracking-[-0.02em] text-slate-900">
          Experimental
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-500">
          Optional recording and capture features.
        </p>
      </div>

      <div className="space-y-3 p-6">
        <FlagToggle
          title="Manual mode"
          description="Pause after annotation and transcription so you can adjust evidence before creating the SOP."
          checked={flags?.manualMode ?? false}
          disabled={busy || flags === null}
          onChange={(value) =>
            void toggle('manualMode', value)
          }
          isDark={false}
        />

        <FlagToggle
          title="Accessibility capture"
          description="Also query the focused UI element for more precise click bounds. Requires Accessibility permission and affects the next recording."
          checked={
            flags?.accessibilityCapture ?? false
          }
          disabled={busy || flags === null}
          onChange={(value) =>
            void toggle('accessibilityCapture', value)
          }
          isDark={false}
        />
      </div>
    </div>
  )
}

function TextInput({
  label,
  value,
  disabled,
  placeholder,
  secret = false,
  onChange,
  isDark
}: {
  label: string
  value: string
  disabled: boolean
  placeholder: string
  secret?: boolean
  onChange: (value: string) => void
  isDark: boolean
}) {
  return (
    <label className="block">
      <span
        className={
          isDark
            ? 'font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/35'
            : 'settings-label'
        }
      >
        {label}
      </span>

      <input
        type={secret ? 'password' : 'text'}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className={
          isDark
            ? 'mt-2 w-full rounded-lg border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/85 outline-none transition placeholder:text-white/25 focus:border-emerald-400/50 disabled:opacity-50'
            : 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60'
        }
      />
    </label>
  )
}

function FlagToggle({
  title,
  description,
  checked,
  disabled,
  onChange,
  isDark
}: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
  isDark: boolean
}) {
  return (
    <label
      className={
        isDark
          ? 'flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3'
          : 'flex items-start justify-between gap-5 rounded-xl border border-slate-200 bg-slate-50/70 px-5 py-4 transition hover:border-purple-200 hover:bg-purple-50/40'
      }
    >
      <span>
        <span
          className={
            isDark
              ? 'block text-sm font-bold text-white/85'
              : 'block text-sm font-bold text-slate-800'
          }
        >
          {title}
        </span>

        <span
          className={
            isDark
              ? 'mt-1 block text-xs leading-5 text-white/45'
              : 'mt-1 block text-xs leading-5 text-slate-500'
          }
        >
          {description}
        </span>
      </span>

      <input
        type="checkbox"
        className={
          isDark
            ? 'mt-1 size-4 shrink-0 accent-emerald-400'
            : 'mt-1 size-4 shrink-0 accent-[#a66ad8]'
        }
        disabled={disabled}
        checked={checked}
        onChange={(event) =>
          onChange(event.target.checked)
        }
      />
    </label>
  )
}

function AccountDetail({
  label,
  value,
  mono = false,
  capitalize = false,
  isDark
}: {
  label: string
  value: string
  mono?: boolean
  capitalize?: boolean
  isDark: boolean
}) {
  if (isDark) {
    return (
      <div className="bg-[#0c0c0c] px-6 py-5">
        <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          {label}
        </dt>

        <dd
          className={[
            'mt-2 break-all text-sm text-white/80',
            mono ? 'font-mono text-xs' : '',
            capitalize ? 'capitalize' : ''
          ].join(' ')}
        >
          {value}
        </dd>
      </div>
    )
  }

  return (
    <div>
      <dt className="settings-label">
        {label}
      </dt>

      <dd
        className={[
          'settings-value',
          mono ? 'settings-value-mono' : '',
          capitalize
            ? 'settings-value-capitalize'
            : ''
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  )
}

function ConnectionBadge({
  state,
  isDark
}: {
  state: string
  isDark: boolean
}) {
  const labels: Record<string, string> = {
    connected: 'Connected',
    checking: 'Checking',
    error: 'Connection failed',
    'signed-out': 'Signed out'
  }

  if (isDark) {
    const color =
      state === 'connected'
        ? 'bg-emerald-400'
        : state === 'checking'
          ? 'animate-pulse bg-amber-400'
          : state === 'error'
            ? 'bg-red-500'
            : 'bg-white/30'

    return (
      <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
        <span
          className={`size-1.5 rounded-full ${color}`}
        />

        {labels[state] || state}
      </span>
    )
  }

  return (
    <span
      className={`connection-badge connection-badge-${state}`}
    >
      <span />
      {labels[state] || state}
    </span>
  )
}
