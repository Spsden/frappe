import { create } from 'zustand'
import type { BackendScreenshotEvidence } from '../../../shared/recording'
import { mapWithConcurrency } from '../../utils/async'

export interface EvidenceFrame {
  evidence: BackendScreenshotEvidence
  url: string
}

interface EvidenceSessionCache {
  frames: EvidenceFrame[]
  isLoading: boolean
  error: string | null
  loadedAt: number | null
}

interface EvidenceStore {
  sessions: Record<string, EvidenceSessionCache>
  loadSession: (sessionId: string, options?: { force?: boolean }) => Promise<void>
  updateScreenshot: (sessionId: string, evidence: BackendScreenshotEvidence) => void
  removeScreenshot: (sessionId: string, screenshotId: string) => void
  clearSession: (sessionId: string) => void
  clearAll: () => void
}

const imageRequests = new Map<string, Promise<string>>()
const sessionRequests = new Map<string, Promise<void>>()

function imageKey(sessionId: string, screenshotId: string) {
  return `${sessionId}:${screenshotId}`
}

function revokeFrameUrls(frames: EvidenceFrame[]) {
  for (const frame of frames) URL.revokeObjectURL(frame.url)
}

async function loadImageUrl(
  sessionId: string,
  evidence: BackendScreenshotEvidence,
  existingUrl: string | undefined
): Promise<string> {
  if (existingUrl) return existingUrl

  const key = imageKey(sessionId, evidence.id)
  const existingRequest = imageRequests.get(key)
  if (existingRequest) return existingRequest

  const request = (async () => {
    const buffer = await window.api.recording.getScreenshotImage(
      sessionId,
      evidence.id,
      evidence.media_url
    )
    const blob = new Blob([buffer], { type: evidence.media_type || 'image/png' })
    return URL.createObjectURL(blob)
  })()

  imageRequests.set(key, request)
  try {
    return await request
  } finally {
    imageRequests.delete(key)
  }
}

export const useEvidenceStore = create<EvidenceStore>((set, get) => ({
  sessions: {},

  async loadSession(sessionId, options) {
    const cached = get().sessions[sessionId]
    if (!options?.force && cached?.frames.length) return

    const existingRequest = sessionRequests.get(sessionId)
    if (existingRequest) return existingRequest

    const request = (async () => {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            frames: state.sessions[sessionId]?.frames ?? [],
            isLoading: true,
            error: null,
            loadedAt: state.sessions[sessionId]?.loadedAt ?? null
          }
        }
      }))

      try {
        const screenshots = await window.api.recording.getSessionScreenshots(sessionId)
        const currentFrames = get().sessions[sessionId]?.frames ?? []
        const currentUrls = new Map(
          currentFrames.map((frame) => [frame.evidence.id, frame.url])
        )
        const seenIds = new Set(screenshots.map((item) => item.id))
        for (const frame of currentFrames) {
          if (!seenIds.has(frame.evidence.id)) URL.revokeObjectURL(frame.url)
        }

        const frames = await mapWithConcurrency(screenshots, 4, async (evidence) => ({
          evidence,
          url: await loadImageUrl(sessionId, evidence, currentUrls.get(evidence.id))
        }))

        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              frames,
              isLoading: false,
              error: null,
              loadedAt: Date.now()
            }
          }
        }))
      } catch (caught) {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              frames: state.sessions[sessionId]?.frames ?? [],
              isLoading: false,
              error: caught instanceof Error ? caught.message : 'Could not load evidence.',
              loadedAt: state.sessions[sessionId]?.loadedAt ?? null
            }
          }
        }))
      }
    })()

    sessionRequests.set(sessionId, request)
    try {
      await request
    } finally {
      sessionRequests.delete(sessionId)
    }
  },

  updateScreenshot(sessionId, evidence) {
    set((state) => {
      const cache = state.sessions[sessionId]
      if (!cache) return state
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...cache,
            frames: cache.frames.map((frame) =>
              frame.evidence.id === evidence.id ? { ...frame, evidence } : frame
            )
          }
        }
      }
    })
  },

  removeScreenshot(sessionId, screenshotId) {
    set((state) => {
      const cache = state.sessions[sessionId]
      if (!cache) return state
      const removed = cache.frames.find((frame) => frame.evidence.id === screenshotId)
      if (removed) URL.revokeObjectURL(removed.url)
      imageRequests.delete(imageKey(sessionId, screenshotId))
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...cache,
            frames: cache.frames.filter((frame) => frame.evidence.id !== screenshotId)
          }
        }
      }
    })
  },

  clearSession(sessionId) {
    set((state) => {
      const cache = state.sessions[sessionId]
      if (!cache) return state
      revokeFrameUrls(cache.frames)
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      return { sessions }
    })
  },

  clearAll() {
    const { sessions } = get()
    for (const cache of Object.values(sessions)) revokeFrameUrls(cache.frames)
    set({ sessions: {} })
  }
}))
