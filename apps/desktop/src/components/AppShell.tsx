import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useConnection } from '../features/connection/useConnection'

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
  '/sop-library': 'SOPs',
  '/analytics': 'Analytics',
  '/settings': 'Settings'
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
  const pageTitle = routeTitles[location.pathname] ?? 'WorkTrace'
  const { status: connection } = useConnection()

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
      ? 'bg-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.7)]'
      : connection.state === 'checking'
        ? 'animate-pulse bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.55)]'
        : connection.state === 'error'
          ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.55)]'
          : 'bg-zinc-300'

  return (
    <div className="min-h-screen bg-[#fafafb] text-zinc-950 md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#18181b] text-white md:fixed md:inset-y-0 md:w-60 md:border-b-0 md:border-r md:border-white/10">
        <div className="flex h-full flex-col">
          <div className="px-5 py-7">
            <p className="text-xl font-bold tracking-[-0.03em]">
              WorkTrace AI
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
              Enterprise Edition
            </p>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:overflow-visible md:pb-0">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'flex min-w-max items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-medium transition duration-200',
                    isActive
                      ? 'bg-gradient-to-r from-[#a66ad8] to-[#d783b6] text-white shadow-[0_14px_32px_rgba(166,106,216,0.26)]'
                      : 'text-white/60 hover:bg-white/10 hover:text-white'
                  ].join(' ')
                }
              >
                <NavIcon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto hidden border-t border-white/10 p-5 md:block">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full border border-white/15 bg-white/8 text-xs font-bold">
                {connection.account?.email.slice(0, 2).toUpperCase() || 'WT'}
              </div>

              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-bold tracking-wide text-white">
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
        <header className="sticky top-0 z-20 flex h-14 items-center bg-[#fafafb] px-8 text-zinc-950">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold tracking-[-0.03em]">
              {pageTitle}
            </h1>

            <span className="h-5 w-px bg-zinc-200" />

            <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
              <span className={`size-1.5 rounded-full ${connectionColor}`} />
              {connectionLabel}
            </div>
          </div>
        </header>

        <main className="min-h-[calc(100vh-3.5rem)] bg-[#fafafb]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}