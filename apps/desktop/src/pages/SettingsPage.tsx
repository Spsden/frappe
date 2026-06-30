import { useState } from 'react'
import { useConnection } from '../features/connection/useConnection'

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
      </div>
    </section>
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