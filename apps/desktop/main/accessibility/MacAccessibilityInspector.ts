import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AccessibilityElement, AccessibilityInspector } from './types'

interface RawAxElement {
  role?: string | null
  label?: string | null
  value?: string | null
  frame?: { x: number; y: number; width: number; height: number } | null
  isSecure?: boolean
}

/**
 * Phase 2 (macOS, experimental): shells out to the compiled `ax_inspector`
 * helper, which calls AXUIElementCopyElementAtPosition. The helper is a separate
 * process on purpose — it keeps the native AX surface out of the Electron ABI
 * (no node-gyp / electron-rebuild) and degrades to a no-op if the binary is
 * missing or Accessibility permission is denied.
 *
 * The helper runs only at click frequency (never on mouse-move), so the
 * per-call spawn cost is acceptable.
 */
export class MacAccessibilityInspector implements AccessibilityInspector {
  private available: boolean | null = null

  constructor(private readonly binaryPath: string) {}

  async getElementAtPoint(x: number, y: number): Promise<AccessibilityElement | null> {
    if (this.available === false) return null
    if (this.available === null) {
      this.available = existsSync(this.binaryPath)
      if (!this.available) return null
    }

    return new Promise((resolve) => {
      execFile(
        this.binaryPath,
        [String(x), String(y)],
        { timeout: 1500, windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolve(null)
            return
          }
          resolve(parseAxOutput(stdout))
        }
      )
    })
  }
}

function parseAxOutput(stdout: string): AccessibilityElement | null {
  const trimmed = stdout.trim()
  if (!trimmed || trimmed === 'null') return null
  try {
    const raw = JSON.parse(trimmed) as RawAxElement
    return {
      role: raw.role ?? null,
      label: raw.label ?? '',
      bounds: raw.frame ?? null,
      text: raw.isSecure ? null : (raw.value ?? null),
      isSecure: Boolean(raw.isSecure)
    }
  } catch {
    return null
  }
}

/** Locate the compiled helper binary. Checks an env override first, then the
 * repo/dev path, then the packaged-app path. Returns null if not found. */
export function resolveAxInspectorBinary(): string | null {
  const override = process.env['WORKTRACE_AX_INSPECTOR']
  if (override && existsSync(override)) return override

  const candidates = [
    // Dev (compiled main lives in out/main/accessibility -> up 3 to desktop).
    join(__dirname, '..', '..', '..', 'native', 'ax_inspector', 'ax_inspector'),
    // Running uncompiled from source.
    join(__dirname, '..', '..', 'native', 'ax_inspector', 'ax_inspector'),
    // Packaged app.
    join(app.getAppPath(), 'native', 'ax_inspector', 'ax_inspector')
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}
