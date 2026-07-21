export interface AccessibilityRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AccessibilityElement {
  role: string | null
  label: string
  /** Element frame in GLOBAL SCREEN POINTS (the AX frame). The caller converts
   * this to screenshot-pixel space via the display bounds + scale factor. */
  bounds: AccessibilityRect | null
  /** Field value, already nulled for secure (password) fields. */
  text: string | null
  isSecure: boolean
}

export interface AccessibilityInspector {
  getElementAtPoint(x: number, y: number): Promise<AccessibilityElement | null>
}

/**
 * Injected into InputEventService. `enabled` is read live so the experimental
 * flag in Settings takes effect on the next recording without a restart of the
 * capture services.
 */
export interface AccessibilityBundle {
  enabled: () => boolean
  inspector: AccessibilityInspector
}

/** Default no-op inspector: Phase 3 baseline. AX is unavailable (non-macOS, or
 * the helper binary/permission is missing) so clicks carry no element data and
 * annotations fall back to the coordinate-based box. */
export class NoopAccessibilityInspector implements AccessibilityInspector {
  async getElementAtPoint(): Promise<null> {
    return null
  }
}
