import { useEffect, useState } from 'react'
import { useConnection } from '../features/connection/useConnection'
import type { LLMProviderSettings } from '../../shared/connection'
import type { ExperimentalFlags } from '../../shared/settings'

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Account action failed.'
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
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
    <section className="px-5 py-8 md:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
          Workspace
        </p>
        <h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">Account settings</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
          Your encrypted session connects this recorder to the correct tenant automatically.
        </p>

        <div className="mt-8 overflow-hidden rounded-xl border border-white/15 bg-[#0c0c0c]">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
            <div>
              <p className="text-sm font-bold">{account?.companyName || 'WorkTrace workspace'}</p>
              <p className="mt-1 text-xs text-white/45">{status.apiUrl}</p>
            </div>
            <ConnectionBadge state={status.state} />
          </div>

          <dl className="grid gap-px bg-white/10 sm:grid-cols-2">
            <AccountDetail label="Email" value={account?.email || '—'} />
            <AccountDetail label="Role" value={account?.role || '—'} capitalize />
            <AccountDetail label="Tenant ID" value={account?.tenantId || '—'} mono />
            <AccountDetail label="User ID" value={account?.userId || '—'} mono />
          </dl>

          {(error || status.error) && (
            <p className="mx-6 mt-5 rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-3 text-xs leading-5 text-red-300">
              {error || status.error}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-3 border-t border-white/10 px-6 py-5">
            <button
              type="button"
              disabled={busy || status.state === 'checking'}
              onClick={() => void test()}
              className="rounded-lg border border-white/15 px-5 py-2.5 text-xs font-bold transition hover:bg-white/8 disabled:opacity-50"
            >
              Test connection
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void signOut()}
              className="rounded-lg border border-red-500/35 bg-red-500/8 px-5 py-2.5 text-xs font-bold text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
            >
              {busy ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-5">
          <p className="text-xs font-bold">Credential security</p>
          <p className="mt-2 text-xs leading-5 text-white/45">
            The access token is encrypted using the operating system credential service. React
            receives only your account and connection status, never the token.
          </p>
        </div>

        <LLMProviderSection enabled={status.hasSession && status.state === 'connected'} />

        <ExperimentalSection />
      </div>
    </section>
  )
}

function LLMProviderSection({ enabled }: { enabled: boolean }) {
  const [settings, setSettings] = useState<LLMProviderSettings | null>(null)
  const [baseUrl, setBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [model, setModel] = useState('openai/gpt-4o')
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
        const current = await window.api.connection.getLLMProviderSettings()
        if (!active) return
        setSettings(current)
        setBaseUrl(current.base_url)
        setModel(current.model)
      } catch (loadError) {
        if (active) setError(cleanError(loadError))
      } finally {
        if (active) setBusy(false)
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
      const next = await window.api.connection.saveLLMProviderSettings({
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
    <div className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs font-bold">LLM provider</p>
          <p className="mt-1 text-xs text-white/45">OpenRouter-compatible generation settings.</p>
        </div>
        <span className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
          <span
            className={`size-1.5 rounded-full ${
              settings?.has_api_key ? 'bg-emerald-400' : 'bg-white/25'
            }`}
          />
          {settings?.has_api_key ? 'Key saved' : 'No key'}
        </span>
      </div>

      <div className="grid gap-4 p-5">
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
          placeholder={settings?.has_api_key ? 'Saved key remains unchanged' : 'sk-or-...'}
          secret
          onChange={setApiKey}
        />

        <label className="flex items-center gap-3 text-xs text-white/55">
          <input
            type="checkbox"
            className="size-4 accent-emerald-400"
            checked={clearApiKey}
            disabled={!enabled || busy}
            onChange={(event) => setClearApiKey(event.target.checked)}
          />
          Clear saved API key
        </label>

        {(error || saved) && (
          <p
            className={[
              'rounded-lg border px-4 py-3 text-xs leading-5',
              error
                ? 'border-red-500/25 bg-red-500/8 text-red-300'
                : 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300'
            ].join(' ')}
          >
            {error || 'Provider settings saved.'}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!enabled || busy || !baseUrl.trim() || !model.trim()}
            onClick={() => void save()}
            className="rounded-lg border border-white/15 bg-white px-5 py-2.5 text-xs font-black text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save provider'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExperimentalSection() {
  const [flags, setFlags] = useState<ExperimentalFlags | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const current = await window.api.settings.getFlags()
        if (active) setFlags(current)
      } catch {
        // Settings are best-effort; the rest of the page still renders.
      }
    }
    void load()
    const off = window.api.settings.onFlagsChanged((next) => setFlags(next))
    return () => {
      active = false
      off()
    }
  }, [])

  const toggle = async (flag: keyof ExperimentalFlags, value: boolean) => {
    setBusy(true)
    try {
      await window.api.settings.setFlag(flag, value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] p-5">
      <p className="text-xs font-bold">Experimental</p>
      <div className="mt-4 space-y-4">
        <FlagToggle
          title="Manual mode"
          description="Pause after annotation and transcription so you can adjust evidence before creating the SOP."
          checked={flags?.manualMode ?? false}
          disabled={busy || flags === null}
          onChange={(value) => void toggle('manualMode', value)}
        />
        <FlagToggle
          title="Accessibility capture"
          description="Also query the focused UI element for more precise click bounds. Requires Accessibility permission and affects the next recording."
          checked={flags?.accessibilityCapture ?? false}
          disabled={busy || flags === null}
          onChange={(value) => void toggle('accessibilityCapture', value)}
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
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
        {label}
      </span>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/85 outline-none transition placeholder:text-white/25 focus:border-emerald-400/50 disabled:opacity-50"
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
    <label className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <span>
        <span className="block text-sm font-bold text-white/85">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-white/45">{description}</span>
      </span>
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-emerald-400"
        disabled={disabled}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
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
    <div className="bg-[#0c0c0c] px-6 py-5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</dt>
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

function ConnectionBadge({ state }: { state: string }) {
  const labels: Record<string, string> = {
    connected: 'Connected',
    checking: 'Checking',
    error: 'Connection failed',
    'signed-out': 'Signed out'
  }
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
      <span className={`size-1.5 rounded-full ${color}`} />
      {labels[state] || state}
    </span>
  )
}
