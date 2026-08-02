import { useEffect, useState } from 'react'
import type { BackendHealth } from '../../../shared/connection'

/**
 * Polls tenant-aware service health so Settings can distinguish infrastructure,
 * queue consumers, local models, and provider configuration. Returns null while
 * unknown or unreachable.
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
