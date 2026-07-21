export type ConnectionState = 'signed-out' | 'checking' | 'connected' | 'error'

export interface Account {
  userId: string
  tenantId: string
  companyName: string
  email: string
  role: 'owner' | 'admin' | 'member'
}

export interface LoginCredentials {
  apiUrl: string
  email: string
  password: string
}

export interface SignUpCredentials extends LoginCredentials {
  companyName: string
}

export interface ConnectionStatus {
  state: ConnectionState
  apiUrl: string
  account: Account | null
  hasSession: boolean
  error: string | null
}

export interface BackendHealth {
  status: string
  environment: string
  services: {
    redis: 'up' | 'down'
    worker: 'up' | 'down' | 'unknown'
  }
}

export interface LLMProviderSettings {
  base_url: string
  model: string
  has_api_key: boolean
  updated_at: string | null
}

export interface LLMProviderSettingsUpdate {
  base_url: string
  model: string
  api_key?: string | null
  clear_api_key?: boolean
}

export interface ConnectionApi {
  getStatus: () => Promise<ConnectionStatus>
  login: (credentials: LoginCredentials) => Promise<ConnectionStatus>
  signup: (credentials: SignUpCredentials) => Promise<ConnectionStatus>
  logout: () => Promise<ConnectionStatus>
  test: () => Promise<ConnectionStatus>
  getHealth: () => Promise<BackendHealth>
  getLLMProviderSettings: () => Promise<LLMProviderSettings>
  saveLLMProviderSettings: (settings: LLMProviderSettingsUpdate) => Promise<LLMProviderSettings>
  onStatusChanged: (listener: (status: ConnectionStatus) => void) => () => void
}

export const connectionIpc = {
  getStatus: 'connection:get-status',
  login: 'connection:login',
  signup: 'connection:signup',
  logout: 'connection:logout',
  test: 'connection:test',
  getHealth: 'connection:get-health',
  getLLMProviderSettings: 'connection:get-llm-provider-settings',
  saveLLMProviderSettings: 'connection:save-llm-provider-settings',
  statusChanged: 'connection:status-changed'
} as const
