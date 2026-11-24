export type CloudProviderType = 'jellyfin' | 'navidrome'

export interface CloudServerConfig {
  id: string
  name: string
  type: CloudProviderType
  serverUrl: string
  username: string
  token?: string | undefined
  userId?: string | undefined
  salt?: string | undefined
  createdAt: number
}
