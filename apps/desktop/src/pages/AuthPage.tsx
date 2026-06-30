import { type FormEvent, useState } from 'react'
import { useConnection } from '../features/connection/useConnection'

type AuthMode = 'login' | 'signup'

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Authentication failed.'
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
}

export function AuthPage() {
  const { status, login, signup } = useConnection()
  const [mode, setMode] = useState<AuthMode>('login')
  const [apiUrl, setApiUrl] = useState(status.apiUrl)
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'signup') {
        await signup({ apiUrl, companyName, email, password })
      } else {
        await login({ apiUrl, email, password })
      }
    } catch (submitError) {
      setError(cleanError(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-screen bg-[#070707] text-white lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden border-r border-white/10 bg-[#111] p-12 lg:flex lg:flex-col">
        <div>
          <p className="text-2xl font-black tracking-[-0.04em]">WorkTrace AI</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
            Enterprise Edition
          </p>
        </div>
        <div className="my-auto max-w-xl">
          <div className="size-3 rounded-full bg-purple-400 shadow-[0_0_22px_rgba(168,85,247,0.55)]" />
          <p className="mt-7 font-mono text-xs font-bold uppercase tracking-[0.28em] text-white/55">
            Capture knowledge as it happens
          </p>
          <h1 className="mt-6 text-5xl font-black leading-[1.04] tracking-[-0.055em]">
            Turn real work into repeatable process.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/50">
            Record desktop workflows, generate reviewable SOPs, and keep company evidence
            inside the tenant environment.
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
          Tenant-isolated workflow intelligence
        </p>
      </section>

      <section className="grid place-items-center px-6 py-12">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#18181b] p-10 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
          <div className="lg:hidden">
            <p className="text-xl font-black">WorkTrace AI</p>
          </div>
          <p className="mt-10 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-purple-400 lg:mt-0">
            {mode === 'signup' ? 'Create workspace' : 'Secure sign in'}
          </p>
          <h2 className="mt-4 text-4xl font-black tracking-[-0.045em]">
            {mode === 'signup' ? 'Start recording work.' : 'Welcome back.'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/45">
            {mode === 'signup'
              ? 'Your first account becomes the workspace owner.'
              : 'Sign in to your company-hosted WorkTrace environment.'}
          </p>

          <form onSubmit={(event) => void submit(event)} className="mt-8 grid gap-5">
            <AuthField label="API URL">
              <input
                required
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder="http://127.0.0.1:8000"
                className="auth-input"
              />
            </AuthField>
            {mode === 'signup' && (
              <AuthField label="Company name">
                <input
                  required
                  minLength={2}
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Acme Operations"
                  className="auth-input"
                />
              </AuthField>
            )}
            <AuthField label="Email">
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                className="auth-input"
              />
            </AuthField>
            <AuthField label="Password">
              <input
                required
                type="password"
                minLength={mode === 'signup' ? 10 : 1}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'}
                className="auth-input"
              />
            </AuthField>

            {(error || status.error) && (
              <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-3 text-xs leading-5 text-red-300">
                {error || status.error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="primary-gradient-button mt-2"
            >
              {submitting
                ? mode === 'signup'
                  ? 'Creating workspace...'
                  : 'Signing in...'
                : mode === 'signup'
                  ? 'Create workspace'
                  : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-white/45">
            {mode === 'signup' ? 'Already have an account?' : 'New to WorkTrace?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signup' ? 'login' : 'signup')
                setError(null)
              }}
              className="font-bold text-white hover:underline"
            >
              {mode === 'signup' ? 'Sign in' : 'Create workspace'}
            </button>
          </p>
        </div>
      </section>
    </main>
  )
}

function AuthField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-bold">{label}</span>
      {children}
    </label>
  )
}
