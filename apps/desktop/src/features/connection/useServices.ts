import { useEffect, useState } from 'react'
import type { BackendHealth } from '../../../shared/connection'

/**
 * Polls GET /health so the UI can show when the async pipeline (Redis +
 * Celery worker) is offline. Only polls while `enabled` (typically when the API
 * connection itself is up — otherwise the "SYSTEM OFFLINE" indicator already
 * covers it). Returns null while unknown or unreachable.
 */
export function useServices(enabled: boolean): BackendHealth | null {
  const [health, setHealth] = useState<BackendHealth | null>(null)

  useEffect(() => {
    if (!enabled) {
      setHealth(null)
      return
    }

    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await window.api.connection.getHealth()
        if (active) setHealth(next)
      } catch {
        if (active) setHealth(null)
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 10_000)
      }
    }

    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [enabled])

  return health
}
