export interface VaultCredentials {
  entryId: string
  name: string
  username: string
  password: string
  urls: string[]
}

export interface PeachVaultPlugin {
  isVaultUnlocked(): Promise<{ unlocked: boolean }>
  unlockVault(options: { password: string }): Promise<{ success: boolean; error?: string }>
  getAutofillData(options: { packageName: string }): Promise<{ credentials: VaultCredentials[] }>
  fillCredential(options: { entryId: string }): Promise<{ username: string; password: string }>
  lockVault(): Promise<void>
  hasBiometric(): Promise<{ available: boolean }>
  authenticateWithBiometric(): Promise<{ success: boolean }>
}
