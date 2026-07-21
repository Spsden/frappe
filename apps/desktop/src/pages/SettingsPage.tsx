import { useEffect, useState } from 'react'
import { useConnection } from '../features/connection/useConnection'
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
    <section className="dashboard-page">
      <div className="dashboard-container settings-container">
        <div className="page-header">
          <span className="eyebrow">WORKSPACE</span>
          <h1>Account settings</h1>
          <p>
            Your encrypted session connects this recorder to the correct tenant automatically.
          </p>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-label">Workspace</p>
              <h2>{account?.companyName || 'WorkTrace workspace'}</h2>
              <p>{status.apiUrl}</p>
            </div>

            <ConnectionBadge state={status.state} />
          </div>

          <dl className="settings-grid">
            <AccountDetail label="Email" value={account?.email || '—'} />
            <AccountDetail label="Role" value={account?.role || '—'} capitalize />
            <AccountDetail label="Tenant ID" value={account?.tenantId || '—'} mono />
            <AccountDetail label="User ID" value={account?.userId || '—'} mono />
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
            The access token is encrypted using the operating system credential service.
            React receives only your account and connection status, never the token.
          </span>
        </div>

        <ExperimentalSection />
      </div>
    </section>
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
    <div>
      <dt className="settings-label">{label}</dt>
      <dd
        className={[
          'settings-value',
          mono ? 'settings-value-mono' : '',
          capitalize ? 'settings-value-capitalize' : ''
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

  return (
    <span className={`connection-badge connection-badge-${state}`}>
      <span />
      {labels[state] || state}
    </span>
  )
}