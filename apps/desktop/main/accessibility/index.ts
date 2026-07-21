import { MacAccessibilityInspector, resolveAxInspectorBinary } from './MacAccessibilityInspector'
import { NoopAccessibilityInspector } from './types'

export type {
  AccessibilityBundle,
  AccessibilityElement,
  AccessibilityInspector,
  AccessibilityRect
} from './types'

/**
 * Phase 2 entry point. Builds the platform-appropriate accessibility inspector.
 * On macOS it shells out to the compiled `ax_inspector` helper; everywhere else
 * (or if the binary is missing) it returns a no-op so capture stays on the
 * Phase 3 coordinate baseline.
 */
export function createAccessibilityInspector() {
  if (process.platform !== 'darwin') {
    return new NoopAccessibilityInspector()
  }
  const binaryPath = resolveAxInspectorBinary()
  if (!binaryPath) {
    return new NoopAccessibilityInspector()
  }
  return new MacAccessibilityInspector(binaryPath)
}
