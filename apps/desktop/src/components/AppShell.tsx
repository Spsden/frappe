import { useEffect, useState } from 'react'
import {
  NavLink,
  Outlet,
  useLocation
} from 'react-router-dom'
import { SearchPalette } from './SearchPalette'
import { useConnection } from '../features/connection/useConnection'
import { useTheme } from '../features/theme/ThemeContext'

const lastWorkflowRouteKey = 'worktrace:last-workflow-route'

function rememberedWorkflowRoute() {
  const route = localStorage.getItem(lastWorkflowRouteKey)
  return route?.startsWith('/workflows/') ? route : '/sessions'
}

interface NavigationItem {
  label: string
  to: string
  end?: boolean
  icon: React.ReactNode
}

const navigation: NavigationItem[] = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    end: true,
    icon: (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect
          x="3"
          y="3"
          width="7"
          height="7"
          rx="1.5"
        />
        <rect
          x="14"
          y="3"
          width="7"
          height="7"
          rx="1.5"
        />
        <rect
          x="3"
          y="14"
          width="7"
          height="7"
          rx="1.5"
        />
        <rect
          x="14"
          y="14"
          width="7"
          height="7"
          rx="1.5"
        />
      </svg>
    )
  },
  {
    label: 'Recorded Workflows',
    to: '/sessions',
    icon: (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          rx="2"
        />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    )
  },
  {
    label: 'SOP Library',
    to: '/sop-library',
    icon: (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </svg>
    )
  },
  {
    label: 'Analytics',
    to: '/analytics',
    icon: (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
      </svg>
    )
  },
  {
    label: 'Settings',
    to: '/settings',
    icon: (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle
          cx="12"
          cy="12"
          r="3"
        />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.34.72.6 1 .3.28.69.43 1.1.4H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.6Z" />
      </svg>
    )
  }
]

function getPageTitle(pathname: string) {
  if (
    pathname.startsWith('/sessions/') &&
    pathname.endsWith('/sop')
  ) {
    return 'SOP Detail'
  }

  if (pathname.startsWith('/sessions/')) {
    return 'Session Detail'
  }

  if (pathname.startsWith('/workflows/')) {
    return 'Workflow Detail'
  }

  if (pathname.startsWith('/sessions')) {
    return 'Recorded Workflows'
  }

  if (pathname.startsWith('/sop-library')) {
    return 'SOP Library'
  }

  if (pathname.startsWith('/analytics')) {
    return 'Analytics'
  }

  if (pathname.startsWith('/settings')) {
    return 'Settings'
  }

  return 'Dashboard'
}

function connectionLabel(state: string) {
  if (state === 'connected') {
    return 'Connected'
  }

  if (state === 'checking') {
    return 'Checking'
  }

  if (state === 'error') {
    return 'Connection failed'
  }

  return 'Signed out'
}

function connectionDot(
  state: string,
  isDark: boolean
) {
  if (state === 'connected') {
    return 'bg-emerald-400'
  }

  if (state === 'checking') {
    return 'animate-pulse bg-amber-400'
  }

  if (state === 'error') {
    return 'bg-red-500'
  }

  return isDark
    ? 'bg-white/30'
    : 'bg-slate-300'
}

export function AppShell() {
  const { status } = useConnection()
  const { theme } = useTheme()
  const location = useLocation()

  const [searchOpen, setSearchOpen] = useState(false)
  const [recordedWorkflowsPath, setRecordedWorkflowsPath] = useState(
    rememberedWorkflowRoute
  )

  useEffect(() => {
    if (location.pathname.startsWith('/workflows/')) {
      const route = `${location.pathname}${location.search}`
      localStorage.setItem(lastWorkflowRouteKey, route)
      setRecordedWorkflowsPath(route)
      return
    }

    if (location.pathname === '/sessions') {
      localStorage.removeItem(lastWorkflowRouteKey)
      setRecordedWorkflowsPath('/sessions')
    }
  }, [location.pathname, location.search])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const isDark = theme === 'dark'
  const account = status.account

  const email =
    account?.email || 'WorkTrace user'

  const company =
    account?.companyName ||
    'WorkTrace workspace'

  const role =
    account?.role || 'Member'

  const avatarLetter =
    email
      .trim()
      .charAt(0)
      .toUpperCase() || 'W'

  const title = getPageTitle(
    location.pathname
  )

  return (
    <div
      className={[
        'min-h-screen',
        isDark
          ? 'bg-[#070707] text-white'
          : 'bg-[#fafafb] text-slate-900'
      ].join(' ')}
    >
      {/* Sidebar */}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r',
          isDark
            ? 'border-white/10 bg-[#1b1b1b]'
            : 'border-slate-200 bg-white shadow-[8px_0_35px_rgba(95,60,150,0.05)]'
        ].join(' ')}
      >
        {/* Logo */}

        <div
          className={[
            'flex h-16 shrink-0 items-center gap-3 border-b px-5',
            isDark
              ? 'border-white/10'
              : 'border-slate-200'
          ].join(' ')}
        >
          <div
            className={[
              'grid size-9 shrink-0 place-items-center rounded-xl text-sm font-black',
              isDark
                ? 'border border-white/15 bg-white text-black'
                : 'bg-gradient-to-br from-[#a66ad8] to-[#d783b6] text-white shadow-[0_8px_20px_rgba(166,106,216,0.24)]'
            ].join(' ')}
          >
            W
          </div>

          <div className="min-w-0">
            <p
              className={[
                'truncate text-sm font-black tracking-[-0.02em]',
                isDark
                  ? 'text-white'
                  : 'text-slate-900'
              ].join(' ')}
            >
              WorkTrace
            </p>

            <p
              className={[
                'mt-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em]',
                isDark
                  ? 'text-white/35'
                  : 'text-slate-400'
              ].join(' ')}
            >
              Desktop recorder
            </p>
          </div>
        </div>

        {/* Navigation */}

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          <p
            className={[
              'mb-3 px-3 font-mono text-[9px] font-bold uppercase tracking-[0.2em]',
              isDark
                ? 'text-white/30'
                : 'text-slate-400'
            ].join(' ')}
          >
            Workspace
          </p>

          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={
                item.to === '/sessions'
                  ? recordedWorkflowsPath
                  : item.to
              }
              end={item.end}
              className={({ isActive }) => {
                const active =
                  isActive ||
                  (item.to === '/sessions' && location.pathname.startsWith('/workflows/'))

                return [
                  'group relative flex min-h-11 items-center gap-3 px-3 py-2.5 text-sm font-bold transition',
                  isDark
                    ? 'rounded-md'
                    : 'rounded-xl',
                  active
                    ? isDark
                      ? 'border-l-2 border-white bg-white/12 text-white'
                      : 'bg-gradient-to-r from-purple-100 to-pink-50 text-purple-800 shadow-[0_8px_20px_rgba(166,106,216,0.08)]'
                    : isDark
                      ? 'border-l-2 border-transparent text-white/50 hover:bg-white/[0.06] hover:text-white'
                      : 'text-slate-500 hover:bg-purple-50 hover:text-purple-700'
                ].join(' ')
              }}
            >
              <span className="size-[18px] shrink-0">
                {item.icon}
              </span>

              <span className="truncate">
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* Sidebar account/status */}

        <div
          className={[
            'shrink-0 border-t p-4',
            isDark
              ? 'border-white/10'
              : 'border-slate-200'
          ].join(' ')}
        >
          <div
            className={[
              'rounded-xl border p-3',
              isDark
                ? 'border-white/10 bg-black/20'
                : 'border-purple-100 bg-purple-50/50'
            ].join(' ')}
          >
            <div className="flex items-center gap-3">
              <div
                className={[
                  'grid size-9 shrink-0 place-items-center rounded-full border text-xs font-black',
                  isDark
                    ? 'border-white/15 bg-white/[0.06] text-white'
                    : 'border-purple-200 bg-white text-purple-700'
                ].join(' ')}
              >
                {avatarLetter}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className={[
                    'truncate text-xs font-bold',
                    isDark
                      ? 'text-white/80'
                      : 'text-slate-800'
                  ].join(' ')}
                >
                  {email}
                </p>

                <p
                  className={[
                    'mt-1 truncate text-[10px]',
                    isDark
                      ? 'text-white/35'
                      : 'text-slate-400'
                  ].join(' ')}
                >
                  {role} · {company}
                </p>
              </div>
            </div>

            <div
              className={[
                'mt-3 flex items-center gap-2 border-t pt-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em]',
                isDark
                  ? 'border-white/10 text-white/45'
                  : 'border-purple-100 text-slate-500'
              ].join(' ')}
            >
              <span
                className={[
                  'size-1.5 rounded-full',
                  connectionDot(
                    status.state,
                    isDark
                  )
                ].join(' ')}
              />

              {connectionLabel(
                status.state
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Right side */}

      <div className="ml-64 flex min-h-screen flex-col">
        {/* Header */}

        <header
          className={[
            'sticky top-0 z-30 flex shrink-0 items-center border-b px-6',
            isDark
              ? 'h-16 border-white/10 bg-black/90 backdrop-blur'
              : 'h-16 border-slate-200 bg-white/90 shadow-[0_8px_25px_rgba(95,60,150,0.04)] backdrop-blur'
          ].join(' ')}
        >
          <div className="min-w-0">
            <p
              className={[
                'font-mono text-[9px] font-bold uppercase tracking-[0.18em]',
                isDark
                  ? 'text-white/35'
                  : 'text-purple-500'
              ].join(' ')}
            >
              WorkTrace workspace
            </p>

            <h1
              className={[
                'mt-0.5 truncate text-sm font-black',
                isDark
                  ? 'text-white'
                  : 'text-slate-900'
              ].join(' ')}
            >
              {title}
            </h1>
          </div>

          {/* Search — both themes */}

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search SOPs and workflows"
              className={[
                'flex h-9 w-64 items-center gap-2 rounded-lg border px-3 transition',
                isDark
                  ? 'border-white/10 bg-white/[0.04] text-white/45 hover:border-white/25 hover:text-white/70'
                  : 'border-slate-200 bg-white text-slate-400 shadow-sm hover:border-purple-300 hover:text-slate-600'
              ].join(' ')}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="size-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                />

                <path d="m20 20-3.5-3.5" />
              </svg>

              <span className="min-w-0 flex-1 text-left text-xs">
                Search…
              </span>

              <kbd
                className={[
                  'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold',
                  isDark
                    ? 'border-white/15 text-white/40'
                    : 'border-slate-200 text-slate-400'
                ].join(' ')}
              >
                ⌘K
              </kbd>
            </button>

          </div>
        </header>

        {/* Connection error */}

        {status.error && (
          <div
            className={
              isDark
                ? 'shrink-0 border-b border-amber-400/20 bg-amber-400/[0.06] px-6 py-2.5 text-xs text-amber-200'
                : 'shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-xs text-amber-700'
            }
          >
            {status.error}
          </div>
        )}

        {/* Page content */}

        <main
          className={[
            'min-h-0 flex-1',
            isDark
              ? 'bg-[#070707]'
              : 'bg-[#fafafb]'
          ].join(' ')}
        >
          <Outlet />
        </main>
      </div>

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  )
}
