import { useEffect, useState } from 'react'
import type {
  LLMProviderSettings,
  SopLimitsSettings,
  SopLimitsSettingsUpdate
} from '../../shared/connection'
import type { ExperimentalFlags } from '../../shared/settings'
import { useConnection } from '../features/connection/useConnection'

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
    <section className="dashboard-page">
      <div className="dashboard-container settings-container">
        <div className="page-header">
          <span className="eyebrow">WORKSPACE</span>

          <h1>Account settings</h1>

          <p>
            Your encrypted session connects this recorder to the correct
            tenant automatically.
          </p>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-label">Workspace</p>

              <h2>
                {account?.companyName || 'WorkTrace workspace'}
              </h2>

              <p>{status.apiUrl}</p>
            </div>

            <ConnectionBadge state={status.state} />
          </div>

          <dl className="settings-grid">
            <AccountDetail
              label="Email"
              value={account?.email || '—'}
            />

            <AccountDetail
              label="Role"
              value={account?.role || '—'}
              capitalize
            />

            <AccountDetail
              label="Tenant ID"
              value={account?.tenantId || '—'}
              mono
            />

            <AccountDetail
              label="User ID"
              value={account?.userId || '—'}
              mono
            />
          </dl>

          {(error || status.error) && (
            <p className="settings-error">
              {error || status.error}
            </p>
          )}

          <div className="settings-actions">
            <button
              type="button"
              disabled={busy || status.state === 'checking'}
              onClick={() => void test()}
              className="secondary-button"
            >
              Test connection
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void signOut()}
              className="delete-button"
            >
              {busy ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>

        <div className="security-card">
          <p>Credential security</p>

          <span>
            The access token is encrypted using the operating system
            credential service. React receives only your account and
            connection status, never the token.
          </span>
        </div>

        <LLMProviderSection
          enabled={
            status.hasSession &&
            status.state === 'connected'
          }
        />

        <SopLimitsSection
          enabled={
            status.hasSession &&
            status.state === 'connected'
          }
        />

        <ExperimentalSection />
      </div>
    </section>
  )
}

function LLMProviderSection({
  enabled
}: {
  enabled: boolean
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
    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]">
      <div className="h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />

      <div className="flex items-center justify-between gap-5 border-b border-slate-200 px-6 py-5">
        <div>
          <p className="settings-label">
            AI generation
          </p>

          <h2 className="mt-1 text-lg font-black tracking-[-0.02em] text-slate-900">
            LLM provider
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-500">
            OpenRouter-compatible generation settings.
          </p>
        </div>

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

          {settings?.has_api_key
            ? 'Key saved'
            : 'No key'}
        </span>
      </div>

      <div className="grid gap-5 p-6">
        <TextInput
          label="Endpoint"
          value={baseUrl}
          disabled={!enabled || busy}
          placeholder="https://openrouter.ai/api/v1"
          onChange={setBaseUrl}
        />

        <TextInput
          label="Model"
          value={model}
          disabled={!enabled || busy}
          placeholder="openai/gpt-4o"
          onChange={setModel}
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
        />

        <label className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            className="size-4 accent-[#a66ad8]"
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
              'rounded-xl border px-4 py-3 text-sm leading-6',
              error
                ? 'border-red-200 bg-red-50 text-red-600'
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
            className="rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
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
  enabled
}: {
  enabled: boolean
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

  const syncDraft = (
    next: SopLimitsSettings
  ) => {
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

  const resetField = (
    field: SopLimitField
  ) => {
    if (!settings) return

    setDraft((current) => ({
      ...current,
      [field]: String(settings.defaults[field])
    }))
  }

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_45px_rgba(95,60,150,0.08)]">
      <div className="h-1 bg-gradient-to-r from-[#a66ad8] via-[#c778d7] to-[#d783b6]" />

      <div className="border-b border-slate-200 px-6 py-5">
        <p className="settings-label">
          Generation controls
        </p>

        <h2 className="mt-1 text-lg font-black tracking-[-0.02em] text-slate-900">
          SOP generation limits
        </h2>

        <p className="mt-1 text-sm leading-6 text-slate-500">
          Tenant guardrails for LLM request size.
        </p>
      </div>

      <div className="grid gap-3 p-6">
        {sopLimitFields.map((field) => {
          const overridden =
            settings?.overridden[field.key] ?? false

          const defaultValue =
            settings?.defaults[field.key]

          return (
            <div
              key={field.key}
              className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-[1fr_150px_auto] sm:items-center"
            >
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {field.label}
                </p>

                <p className="mt-1 text-xs leading-5 text-slate-500">
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
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
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
                className="h-10 rounded-lg border border-purple-200 bg-white px-3 text-xs font-bold text-purple-700 transition hover:border-purple-300 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:opacity-60"
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
              'rounded-xl border px-4 py-3 text-sm leading-6',
              error
                ? 'border-red-200 bg-red-50 text-red-600'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            ].join(' ')}
          >
            {error || 'SOP limits saved.'}
          </p>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={
              !enabled ||
              busy ||
              settings === null
            }
            onClick={() => void save()}
            className="rounded-xl bg-gradient-to-r from-[#a66ad8] to-[#d783b6] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(166,106,216,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(166,106,216,0.3)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save limits'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExperimentalSection() {
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
          checked={
            flags?.manualMode ?? false
          }
          disabled={
            busy ||
            flags === null
          }
          onChange={(value) =>
            void toggle(
              'manualMode',
              value
            )
          }
        />

        <FlagToggle
          title="Accessibility capture"
          description="Also query the focused UI element for more precise click bounds. Requires Accessibility permission and affects the next recording."
          checked={
            flags?.accessibilityCapture ?? false
          }
          disabled={
            busy ||
            flags === null
          }
          onChange={(value) =>
            void toggle(
              'accessibilityCapture',
              value
            )
          }
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
  onChange
}: {
  label: string
  value: string
  disabled: boolean
  placeholder: string
  secret?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="settings-label">
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
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
      />
    </label>
  )
}

function FlagToggle({
  title,
  description,
  checked,
  disabled,
  onChange
}: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-5 rounded-xl border border-slate-200 bg-slate-50/70 px-5 py-4 transition hover:border-purple-200 hover:bg-purple-50/40">
      <span>
        <span className="block text-sm font-bold text-slate-800">
          {title}
        </span>

        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>

      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-[#a66ad8]"
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
  capitalize = false
}: {
  label: string
  value: string
  mono?: boolean
  capitalize?: boolean
}) {
  return (
    <div>
      <dt className="settings-label">
        {label}
      </dt>

      <dd
        className={[
          'settings-value',
          mono
            ? 'settings-value-mono'
            : '',
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
  state
}: {
  state: string
}) {
  const labels: Record<string, string> = {
    connected: 'Connected',
    checking: 'Checking',
    error: 'Connection failed',
    'signed-out': 'Signed out'
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