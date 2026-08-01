import {
  HashRouter,
  Navigate,
  Route,
  Routes
} from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useConnection } from './features/connection/useConnection'
import { ThemeProvider } from './features/theme/ThemeContext'
import { DashboardPage } from './pages/DashboardPage'
import { AuthPage } from './pages/AuthPage'
import { AudioRecorderPage } from './pages/AudioRecorderPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { RecordingControlsPage } from './pages/RecordingControlsPage'
import { SessionsPage } from './pages/SessionsPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { SOPDetailPage } from './pages/SOPDetailPage'
import { SOPLibraryPage } from './pages/SOPLibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { WalkthroughPage } from './pages/WalkthroughPage'

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

function AppContent() {
  if (
    window.location.hash.startsWith(
      '#/audio-recorder'
    )
  ) {
    return <AudioRecorderPage />
  }

  return <ConnectedApp />
}

function ConnectedApp() {
  const { status } = useConnection()

  if (status.state === 'checking') {
    return (
      <main className="app-loading-screen grid min-h-screen place-items-center">
        <div className="text-center">
          <span className="mx-auto block size-2.5 animate-pulse rounded-full bg-purple-400" />

          <p className="app-loading-text mt-5 font-mono text-[10px] font-bold uppercase tracking-[0.24em]">
            Restoring secure session
          </p>
        </div>
      </main>
    )
  }

  if (!status.account || !status.hasSession) {
    return <AuthPage />
  }

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/recording-controls"
          element={<RecordingControlsPage />}
        />

        <Route
          path="/walkthrough"
          element={<WalkthroughPage />}
        />

        <Route element={<AppShell />}>
          <Route
            index
            element={
              <Navigate
                to="/dashboard"
                replace
              />
            }
          />

          <Route
            path="/dashboard"
            element={<DashboardPage />}
          />

          <Route
            path="/sessions"
            element={<SessionsPage />}
          />

          <Route
            path="/sessions/:id"
            element={<SessionDetailPage />}
          />

          <Route
            path="/sessions/:id/sop"
            element={<SOPDetailPage />}
          />

          <Route
            path="/sop-library"
            element={<SOPLibraryPage />}
          />

          <Route
            path="/analytics"
            element={
              <PlaceholderPage
                eyebrow="Intelligence"
                title="Analytics"
                description="Compare workflow paths and identify process friction."
              />
            }
          />

          <Route
            path="/settings"
            element={<SettingsPage />}
          />

          <Route
            path="*"
            element={
              <Navigate
                to="/dashboard"
                replace
              />
            }
          />
        </Route>
      </Routes>
    </HashRouter>
  )
}
