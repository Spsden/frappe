import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useConnection } from '../features/connection/useConnection'
import { useServices } from '../features/connection/useServices'

type IconName = 'dashboard' | 'sessions' | 'library' | 'analytics' | 'settings'

const navigation: Array<{ label: string; to: string; icon: IconName }> = [
  { label: 'Dashboard', to: '/dashboard', icon: 'dashboard' },
  { label: 'Sessions', to: '/sessions', icon: 'sessions' },
  { label: 'SOP Library', to: '/sop-library', icon: 'library' },
  { label: 'Analytics', to: '/analytics', icon: 'analytics' },
  { label: 'Settings', to: '/settings', icon: 'settings' }
]

const routeTitles: Record<string, string> = {
  '/dashboard': 'Overview',
  '/sessions': 'Sessions',
  '/sop-library': 'SOP Library',
  '/analytics': 'Analytics',
  '/settings': 'Settings'
}

const LAST_SESSION_PATH_KEY = 'worktrace:last-session-path'

function isSessionDetailPath(pathname: string): boolean {
  return /^\/sessions\/[^/]+(?:\/sop)?$/.test(pathname)
}

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    sessions: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    library: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
        <path d="M8 7h8M8 11h7" />
      </>
    ),
    analytics: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 17v-5M12 17V7M16 17v-8" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

export function AppShell() {
  const location = useLocation()
  const [lastSessionPath, setLastSessionPath] = useState(() =>
    sessionStorage.getItem(LAST_SESSION_PATH_KEY) ?? '/sessions'
  )
  const pageTitle = routeTitles[location.pathname] ?? 'WorkTrace'
  const { status: connection } = useConnection()
  const health = useServices(connection.state === 'connected')
  const connectionLabel =
    connection.state === 'connected'
      ? 'SYSTEM SYNCED'
      : connection.state === 'checking'
        ? 'CHECKING SYSTEM'
        : connection.state === 'error'
          ? 'SYSTEM OFFLINE'
          : 'SIGNED OUT'
  const connectionColor =
    connection.state === 'connected'
      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]'
      : connection.state === 'checking'
        ? 'animate-pulse bg-amber-400'
        : connection.state === 'error'
          ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.55)]'
          : 'bg-white/30'

  useEffect(() => {
    if (isSessionDetailPath(location.pathname)) {
      sessionStorage.setItem(LAST_SESSION_PATH_KEY, location.pathname)
      setLastSessionPath(location.pathname)
    } else if (location.pathname === '/sessions') {
      sessionStorage.removeItem(LAST_SESSION_PATH_KEY)
      setLastSessionPath('/sessions')
    }
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-[#070707] text-white md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#1b1b1b] md:fixed md:inset-y-0 md:w-60 md:border-b-0 md:border-r">
        <div className="flex h-full flex-col">
          <div className="px-5 py-6">
            <p className="text-xl font-extrabold tracking-[-0.04em]">WorkTrace AI</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
              Enterprise Edition
            </p>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:overflow-visible md:pb-0">
            {navigation.map((item) => {
              const to = item.icon === 'sessions' ? lastSessionPath : item.to
              return (
                <NavLink
                  key={item.to}
                  to={to}
                  className={({ isActive }) =>
                    [
                      'flex min-w-max items-center gap-3 rounded-md border-l-2 px-4 py-3 text-sm font-medium transition',
                      isActive
                        ? 'border-white bg-white/12 text-white'
                        : 'border-transparent text-white/65 hover:bg-white/6 hover:text-white'
                    ].join(' ')
                  }
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>

          <div className="mt-auto hidden border-t border-white/10 p-5 md:block">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full border border-white/20 bg-white/8 text-xs font-bold">
                {connection.account?.email.slice(0, 2).toUpperCase() || 'WT'}
              </div>
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-bold tracking-wide">
                  {connection.account?.email || 'WorkTrace user'}
                </p>
                <p className="mt-0.5 truncate text-[10px] capitalize text-white/45">
                  {connection.account?.role || 'member'} · {connection.account?.companyName}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 md:col-start-2">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/10 bg-black/90 px-5 backdrop-blur md:px-8">
          <div className="flex items-center gap-4">
            <h1 className="text-base font-bold">{pageTitle}</h1>
            <span className="h-5 w-px bg-white/15" />
            <div className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.1em] text-white/65">
              <span className={`size-1.5 rounded-full ${connectionColor}`} />
              {connectionLabel}
            </div>
          </div>

          <div className="hidden items-center gap-3 sm:flex">
            <label className="flex w-56 items-center gap-2 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white/45">
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              <input
                type="search"
                aria-label="Search sessions"
                placeholder="Search sessions..."
                className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/35"
              />
            </label>
            <button
              type="button"
              aria-label="Open account menu"
              className="size-8 rounded-full border-2 border-white/70 p-1"
            >
              <span className="block size-full rounded-full bg-white/10" />
            </button>
          </div>
        </header>

        {connection.state === 'connected' &&
          health &&
          (health.services.redis === 'down' || health.services.worker === 'down') && (
            <div className="flex items-start gap-3 border-b border-amber-500/25 bg-amber-500/10 px-5 py-2.5 text-xs text-amber-200 md:px-8">
              <span className="mt-1.5 size-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
              <p>
                Background services offline (Redis {health.services.redis}
                {health.services.worker !== 'up'
                  ? `, worker ${health.services.worker}`
                  : ''}
                ). Recordings still save, but transcription &amp; annotation won&apos;t run until
                Redis and the Celery worker are started.
              </p>
            </div>
          )}

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
