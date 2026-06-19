import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import type { Account, ConnectionStatus } from '../../shared/connection'

interface StoredConnectionSettings {
  apiUrl: string
  encryptedApiToken: string
  account: Account | null
}

export interface ResolvedConnectionSettings {
  apiUrl: string
  apiToken: string
  tenantId: string | null
}

const defaultApiUrl = process.env['WORKTRACE_API_URL'] ?? 'http://127.0.0.1:8000'
const environmentApiToken = process.env['WORKTRACE_API_TOKEN'] ?? ''

export class ConnectionSettingsStore {
  private stored: StoredConnectionSettings = {
    apiUrl: defaultApiUrl,
    encryptedApiToken: '',
    account: null
  }
  private status: ConnectionStatus = this.toStatus(this.stored)

  constructor(private readonly settingsPath: string) {}

  async initialize(): Promise<ConnectionStatus> {
    this.stored = await this.readStoredSettings()
    this.status = this.toStatus(this.stored)
    return this.getStatus()
  }

  getStatus(): ConnectionStatus {
    return { ...this.status, account: this.status.account ? { ...this.status.account } : null }
  }

  normalizeApiUrl(value: string): string {
    return normalizeApiUrl(value)
  }

  assertSecureStorage(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this device.')
    }
  }

  async saveSession(apiUrl: string, apiToken: string, account: Account): Promise<ConnectionStatus> {
    this.assertSecureStorage()
    this.stored = {
      apiUrl: normalizeApiUrl(apiUrl),
      encryptedApiToken: safeStorage.encryptString(apiToken).toString('base64'),
      account
    }
    await this.writeStoredSettings()
    this.status = {
      state: 'connected',
      apiUrl: this.stored.apiUrl,
      account,
      hasSession: true,
      error: null
    }
    return this.getStatus()
  }

  async clearSession(): Promise<ConnectionStatus> {
    this.stored = {
      apiUrl: this.stored.apiUrl,
      encryptedApiToken: '',
      account: null
    }
    await this.writeStoredSettings()
    this.status = this.toStatus(this.stored)
    return this.getStatus()
  }

  async resolve(): Promise<ResolvedConnectionSettings> {
    const apiToken = this.decryptToken(this.stored.encryptedApiToken)
    if (!apiToken) {
      throw new Error('Sign in to WorkTrace first.')
    }
    return {
      apiUrl: normalizeApiUrl(this.stored.apiUrl),
      apiToken,
      tenantId: this.stored.account?.tenantId ?? null
    }
  }

  setChecking(): ConnectionStatus {
    this.status = { ...this.status, state: 'checking', error: null }
    return this.getStatus()
  }

  async setConnected(account?: Account): Promise<ConnectionStatus> {
    if (account) {
      this.stored.account = account
      await this.writeStoredSettings()
    }
    this.status = {
      state: 'connected',
      apiUrl: this.stored.apiUrl,
      account: this.stored.account,
      hasSession: true,
      error: null
    }
    return this.getStatus()
  }

  setError(error: unknown): ConnectionStatus {
    this.status = {
      ...this.status,
      state: this.status.hasSession ? 'error' : 'signed-out',
      error: error instanceof Error ? error.message : 'Could not connect to the WorkTrace API.'
    }
    return this.getStatus()
  }

  private async readStoredSettings(): Promise<StoredConnectionSettings> {
    try {
      const stored = JSON.parse(await readFile(this.settingsPath, 'utf8')) as {
        apiUrl?: string
        encryptedApiToken?: string
        account?: Account | null
      }
      return {
        apiUrl: stored.apiUrl || defaultApiUrl,
        encryptedApiToken: stored.encryptedApiToken || '',
        account: stored.account || null
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Saved WorkTrace connection settings are invalid.')
      }
      return {
        apiUrl: defaultApiUrl,
        encryptedApiToken: '',
        account: null
      }
    }
  }

  private async writeStoredSettings(): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true })
    const temporaryPath = `${this.settingsPath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.stored, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.settingsPath)
  }

  private decryptToken(encryptedApiToken: string): string {
    if (!encryptedApiToken) {
      return environmentApiToken
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this device.')
    }
    try {
      return safeStorage.decryptString(Buffer.from(encryptedApiToken, 'base64'))
    } catch {
      throw new Error('The saved WorkTrace session could not be decrypted.')
    }
  }

  private toStatus(settings: StoredConnectionSettings): ConnectionStatus {
    const hasSession = Boolean(settings.encryptedApiToken || environmentApiToken)
    return {
      state: hasSession ? 'checking' : 'signed-out',
      apiUrl: settings.apiUrl,
      account: settings.account,
      hasSession,
      error: null
    }
  }
}

export function connectionSettingsPath(userDataPath: string): string {
  return join(userDataPath, 'connection.json')
}

function normalizeApiUrl(value: string): string {
  const url = new URL(value.trim())
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
  ) {
    throw new Error('Use HTTPS for remote APIs. HTTP is allowed only for localhost.')
  }
  return url.toString().replace(/\/$/, '')
}
