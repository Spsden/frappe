import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExperimentalFlags } from '../../shared/settings'

const DEFAULT_FLAGS: ExperimentalFlags = {
  accessibilityCapture: false,
  manualMode: false
}

/**
 * Persistent experimental feature flags (a plain JSON file, no secrets). These
 * gate in-development capture paths (e.g. Phase 2 accessibility capture) so the
 * stable Phase 3 behaviour stays the default until a flag is explicitly turned
 * on. Values are read live so a toggle applies to the next recording.
 */
export class ExperimentalSettingsStore {
  private flags: ExperimentalFlags = { ...DEFAULT_FLAGS }

  constructor(private readonly settingsPath: string) {}

  async initialize(): Promise<ExperimentalFlags> {
    this.flags = await this.read()
    return this.getFlags()
  }

  getFlags(): ExperimentalFlags {
    return { ...this.flags }
  }

  async update(flags: Partial<ExperimentalFlags>): Promise<ExperimentalFlags> {
    this.flags = { ...this.flags, ...flags }
    await this.write()
    return this.getFlags()
  }

  private async read(): Promise<ExperimentalFlags> {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, 'utf8')) as Partial<ExperimentalFlags>
      return {
        accessibilityCapture: Boolean(raw.accessibilityCapture),
        manualMode: Boolean(raw.manualMode)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Saved experimental settings are invalid.')
      }
      return { ...DEFAULT_FLAGS }
    }
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.flags, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.settingsPath)
  }
}

export function experimentalSettingsPath(userDataPath: string): string {
  return join(userDataPath, 'experimental.json')
}
