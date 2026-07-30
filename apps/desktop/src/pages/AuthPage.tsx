import {
  type FormEvent,
  type ReactNode,
  useState
} from 'react'
import { useConnection } from '../features/connection/useConnection'
import { useTheme } from '../features/theme/ThemeContext'

type AuthMode = 'login' | 'signup'

function cleanError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : 'Authentication failed.'

  return message
    .replace(
      /^Error invoking remote method '[^']+': Error:\s*/i,
      ''
    )
    .replace(/^Error:\s*/i, '')
}

export function AuthPage() {
  const { status, login, signup } = useConnection()
  const { theme } = useTheme()

  const isDark = theme === 'dark'

  const [mode, setMode] =
    useState<AuthMode>('login')
  const [apiUrl, setApiUrl] =
    useState(status.apiUrl)
  const [companyName, setCompanyName] =
    useState('')
  const [email, setEmail] =
    useState('')
  const [password, setPassword] =
    useState('')
  const [submitting, setSubmitting] =
    useState(false)
  const [error, setError] =
    useState<string | null>(null)

  const inputClassName = [
    'w-full rounded-lg border px-4 py-3.5 text-sm outline-none transition',
    isDark
      ? 'border-white/10 bg-white text-black placeholder:text-slate-400 focus:border-white/30 focus:ring-2 focus:ring-white/10'
      : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-purple-300 focus:ring-4 focus:ring-purple-100'
  ].join(' ')

  const submit = async (
    event: FormEvent
  ) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      if (mode === 'signup') {
        await signup({
          apiUrl,
          companyName,
          email,
          password
        })
      } else {
        await login({
          apiUrl,
          email,
          password
        })
      }
    } catch (submitError) {
      setError(cleanError(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main
      className={[
        'grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]',
        isDark
          ? 'bg-[#070707] text-white'
          : 'bg-[#faf8fc] text-slate-900'
      ].join(' ')}
    >
      {/* Left introduction section */}

      <section
        className={[
          'hidden border-r p-12 lg:flex lg:flex-col',
          isDark
            ? 'border-white/10 bg-[#111]'
            : 'border-purple-100 bg-[radial-gradient(circle_at_20%_20%,rgba(216,180,254,0.24),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(249,168,212,0.18),transparent_32%),linear-gradient(145deg,#ffffff,#faf5ff)]'
        ].join(' ')}
      >
        <div>
          <p
            className={[
              'text-2xl font-black tracking-[-0.04em]',
              isDark
                ? 'text-white'
                : 'text-slate-950'
            ].join(' ')}
          >
            WorkTrace AI
          </p>

          <p
            className={[
              'mt-1 font-mono text-[10px] uppercase tracking-[0.25em]',
              isDark
                ? 'text-white/40'
                : 'text-purple-500'
            ].join(' ')}
          >
            Enterprise Edition
          </p>
        </div>

        <div className="my-auto max-w-xl">
          <div
            className={[
              'size-3 rounded-full',
              isDark
                ? 'bg-red-500 shadow-[0_0_22px_rgba(239,68,68,0.7)]'
                : 'bg-purple-500 shadow-[0_0_22px_rgba(168,85,247,0.38)]'
            ].join(' ')}
          />

          <p
            className={[
              'mt-7 font-mono text-xs font-bold uppercase tracking-[0.28em]',
              isDark
                ? 'text-white/55'
                : 'text-purple-600'
            ].join(' ')}
          >
            Capture knowledge as it happens
          </p>

          <h1
            className={[
              'mt-6 text-5xl font-black leading-[1.04] tracking-[-0.055em]',
              isDark
                ? 'text-white'
                : 'text-slate-950'
            ].join(' ')}
          >
            Turn real work into repeatable
            process.
          </h1>

          <p
            className={[
              'mt-6 max-w-lg text-base leading-7',
              isDark
                ? 'text-white/50'
                : 'text-slate-500'
            ].join(' ')}
          >
            Record desktop workflows,
            generate reviewable SOPs, and keep
            company evidence inside the tenant
            environment.
          </p>
        </div>

        <p
          className={[
            'font-mono text-[10px] uppercase tracking-[0.18em]',
            isDark
              ? 'text-white/30'
              : 'text-slate-400'
          ].join(' ')}
        >
          Tenant-isolated workflow intelligence
        </p>
      </section>

      {/* Authentication section */}

      <section
        className={[
          'grid place-items-center px-6 py-12',
          isDark
            ? 'bg-[#070707]'
            : 'bg-white'
        ].join(' ')}
      >
        <div
          className={[
            'w-full max-w-md',
            isDark
              ? ''
              : 'rounded-[2rem] border border-purple-100 bg-white p-8 shadow-[0_28px_70px_rgba(126,63,182,0.13)] sm:p-10'
          ].join(' ')}
        >
          <div className="lg:hidden">
            <p
              className={[
                'text-xl font-black',
                isDark
                  ? 'text-white'
                  : 'text-slate-950'
              ].join(' ')}
            >
              WorkTrace AI
            </p>
          </div>

          <p
            className={[
              'mt-10 font-mono text-[10px] font-bold uppercase tracking-[0.24em] lg:mt-0',
              isDark
                ? 'text-emerald-400'
                : 'text-purple-600'
            ].join(' ')}
          >
            {mode === 'signup'
              ? 'Create workspace'
              : 'Secure sign in'}
          </p>

          <h2
            className={[
              'mt-4 text-4xl font-black tracking-[-0.045em]',
              isDark
                ? 'text-white'
                : 'text-slate-950'
            ].join(' ')}
          >
            {mode === 'signup'
              ? 'Start recording work.'
              : 'Welcome back.'}
          </h2>

          <p
            className={[
              'mt-3 text-sm leading-6',
              isDark
                ? 'text-white/45'
                : 'text-slate-500'
            ].join(' ')}
          >
            {mode === 'signup'
              ? 'Your first account becomes the workspace owner.'
              : 'Sign in to your company-hosted WorkTrace environment.'}
          </p>

          <form
            onSubmit={(event) =>
              void submit(event)
            }
            className="mt-8 grid gap-5"
          >
            <AuthField
              label="API URL"
              isDark={isDark}
            >
              <input
                required
                value={apiUrl}
                onChange={(event) =>
                  setApiUrl(event.target.value)
                }
                placeholder="http://127.0.0.1:8000"
                className={inputClassName}
              />
            </AuthField>

            {mode === 'signup' && (
              <AuthField
                label="Company name"
                isDark={isDark}
              >
                <input
                  required
                  minLength={2}
                  value={companyName}
                  onChange={(event) =>
                    setCompanyName(
                      event.target.value
                    )
                  }
                  placeholder="Acme Operations"
                  className={inputClassName}
                />
              </AuthField>
            )}

            <AuthField
              label="Email"
              isDark={isDark}
            >
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="you@company.com"
                className={inputClassName}
              />
            </AuthField>

            <AuthField
              label="Password"
              isDark={isDark}
            >
              <input
                required
                type="password"
                minLength={
                  mode === 'signup' ? 10 : 1
                }
                autoComplete={
                  mode === 'signup'
                    ? 'new-password'
                    : 'current-password'
                }
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                placeholder={
                  mode === 'signup'
                    ? 'At least 10 characters'
                    : 'Your password'
                }
                className={inputClassName}
              />
            </AuthField>

            {(error || status.error) && (
              <p
                className={[
                  'rounded-lg border px-4 py-3 text-xs leading-5',
                  isDark
                    ? 'border-red-500/25 bg-red-500/8 text-red-300'
                    : 'border-red-200 bg-red-50 text-red-600'
                ].join(' ')}
              >
                {error || status.error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={[
                'mt-2 rounded-lg px-5 py-3.5 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50',
                isDark
                  ? 'bg-white text-black hover:bg-white/85'
                  : 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white shadow-[0_14px_30px_rgba(166,106,216,0.26)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(166,106,216,0.32)]'
              ].join(' ')}
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

          <p
            className={[
              'mt-6 text-center text-xs',
              isDark
                ? 'text-white/45'
                : 'text-slate-500'
            ].join(' ')}
          >
            {mode === 'signup'
              ? 'Already have an account?'
              : 'New to WorkTrace?'}{' '}

            <button
              type="button"
              onClick={() => {
                setMode(
                  mode === 'signup'
                    ? 'login'
                    : 'signup'
                )
                setError(null)
              }}
              className={[
                'font-bold hover:underline',
                isDark
                  ? 'text-white'
                  : 'text-purple-700'
              ].join(' ')}
            >
              {mode === 'signup'
                ? 'Sign in'
                : 'Create workspace'}
            </button>
          </p>
        </div>
      </section>
    </main>
  )
}

function AuthField({
  label,
  children,
  isDark
}: {
  label: string
  children: ReactNode
  isDark: boolean
}) {
  return (
    <label className="grid gap-2">
      <span
        className={[
          'text-xs font-bold',
          isDark
            ? 'text-white'
            : 'text-slate-800'
        ].join(' ')}
      >
        {label}
      </span>

      {children}
    </label>
  )
}