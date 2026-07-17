import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { useConnection } from './features/connection/useConnection'
import { DashboardPage } from './pages/DashboardPage'
import { AuthPage } from './pages/AuthPage'
import { AudioRecorderPage } from './pages/AudioRecorderPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { RecordingControlsPage } from './pages/RecordingControlsPage'
import { SessionsPage } from './pages/SessionsPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { SOPDetailPage } from './pages/SOPDetailPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  if (window.location.hash.startsWith('#/audio-recorder')) {
    return <AudioRecorderPage />
  }

  const { status } = useConnection()

  if (status.state === 'checking') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#070707] text-white">
        <div className="text-center">
          <span className="mx-auto block size-2.5 animate-pulse rounded-full bg-emerald-400" />
          <p className="mt-5 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
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
        <Route path="/recording-controls" element={<RecordingControlsPage />} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/sessions/:id/sop" element={<SOPDetailPage />} />
          <Route
            path="/sop-library"
            element={
              <PlaceholderPage
                eyebrow="Documentation"
                title="SOP Library"
                description="Review, edit and publish generated procedures."
              />
            }
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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
