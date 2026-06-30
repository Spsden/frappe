import { useEffect, useMemo, useState } from 'react'
import { useConnection } from '../features/connection/useConnection'

type SopStatus = 'draft' | 'approved' | 'archived'

type BackendSop = {
  id: string
  source_session_id: string
  title: string
  status: SopStatus
  version: number
  created_at: string
  steps: {
    id: string
    position: number
    title: string
    instruction: string
    screenshot_reference?: string | null
  }[]
}

type ExportBundle = {
  session: {
    id: string
    workflow_name: string
  }
  sops: BackendSop[]
}

type SopCard = {
  id: string
  sourceSessionId: string
  title: string
  updatedAt: string
  steps: number
  screenshots: number
  status: SopStatus
  version: number
}

function formatSopStatus(status: SopStatus) {
  if (status === 'draft') return 'Draft'
  if (status === 'approved') return 'Approved'
  if (status === 'archived') return 'Archived'

  return status
}

function sopStatusClassName(status: SopStatus) {
  if (status === 'approved') return 'sop-status sop-status-approved'
  if (status === 'archived') return 'sop-status sop-status-archived'

  return 'sop-status sop-status-draft'
}

function actionLabel(status: SopStatus) {
  if (status === 'draft') return 'Review'
  return 'View'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function mapSopToCard(sop: BackendSop): SopCard {
  const screenshotCount = sop.steps.filter((step) => Boolean(step.screenshot_reference)).length

  return {
    id: sop.id,
    sourceSessionId: sop.source_session_id,
    title: sop.title || 'Untitled SOP',
    updatedAt: sop.created_at,
    steps: sop.steps.length,
    screenshots: screenshotCount,
    status: sop.status,
    version: sop.version
  }
}

function SopPreviewIllustration() {
  return (
    <div className="sop-preview-illustration">
      <span className="sop-line sop-line-one" />
      <span className="sop-line sop-line-two" />
      <span className="sop-line sop-line-three" />
    </div>
  )
}

export function SopLibraryPage() {
  const { status } = useConnection()
  const [searchTerm, setSearchTerm] = useState('')
  const [sops, setSops] = useState<SopCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSops = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // TEMP WORKAROUND:
      // Build SOP Library from session exports because backend does not currently provide GET /sops.
      const sessions = await window.api.recording.listSessions()

      const remoteSessionIds = Array.from(
        new Set(
          sessions
            .map((session) => session.remoteSessionId)
            .filter((sessionId): sessionId is string => Boolean(sessionId))
        )
      )

      if (remoteSessionIds.length === 0) {
        setSops([])
        return
      }

      const exportResults = await Promise.allSettled(
        remoteSessionIds.map(async (sessionId) => {
          const response = await fetch(`${status.apiUrl}/exports/${sessionId}`)

          if (!response.ok) {
            throw new Error(`Could not load export for session ${sessionId}: ${response.status}`)
          }

          return response.json() as Promise<ExportBundle>
        })
      )

      const successfulExports = exportResults
        .filter((result): result is PromiseFulfilledResult<ExportBundle> => {
          return result.status === 'fulfilled'
        })
        .map((result) => result.value)

      const nextSops = successfulExports
        .flatMap((bundle) => bundle.sops)
        .map(mapSopToCard)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

      setSops(nextSops)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load SOPs from backend.')
      setSops([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSops()
  }, [status.apiUrl])

  const filteredSops = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()

    return sops.filter((sop) => {
      const searchableText = [
        sop.title,
        sop.status,
        formatSopStatus(sop.status),
        sop.sourceSessionId,
        sop.version
      ]
        .join(' ')
        .toLowerCase()

      return searchableText.includes(keyword)
    })
  }, [searchTerm, sops])

  return (
    <section className="dashboard-page">
      <div className="dashboard-container">
        <div className="page-header">
          <h1>SOP Library</h1>
          <p>Review and manage SOPs generated from recorded workflows.</p>
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="list-controls sop-list-controls">
          <input
            className="search-input"
            type="text"
            placeholder="Search SOPs..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <button
            type="button"
            className="gradient-button"
            onClick={() => void loadSops()}
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>

          <span className="sop-count">
            {isLoading ? 'Loading SOPs...' : `${filteredSops.length} SOPs`}
          </span>
        </div>

        {filteredSops.length === 0 ? (
          <div className="table-card">
            <div className="table-card-topline" />

            <div className="empty-table-message">
              <strong>{isLoading ? 'Loading SOPs' : 'No SOPs found'}</strong>
              <p>
                {isLoading
                  ? 'Collecting generated SOPs from session exports.'
                  : 'No generated SOPs were found from backend session exports yet.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="sop-grid">
            {filteredSops.map((sop) => (
              <article className="sop-card" key={sop.id}>
                <div className="sop-card-preview">
                  <SopPreviewIllustration />
                </div>

                <div className="sop-card-body">
                  <h2 className="sop-card-title">{sop.title}</h2>

                  <p className="sop-card-meta">
                    {sop.steps} steps · {sop.screenshots} screenshots · v{sop.version}
                  </p>

                  <p className="sop-card-date">Created {formatDate(sop.updatedAt)}</p>

                  <div className="sop-card-footer">
                    <span className={sopStatusClassName(sop.status)}>
                      {formatSopStatus(sop.status)}
                    </span>

                    <button
                      type="button"
                      className="action-button"
                      onClick={() => {
                        console.log('SOP action:', sop.id)
                      }}
                    >
                      {actionLabel(sop.status)}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}