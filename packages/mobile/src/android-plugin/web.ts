import { WebPlugin } from '@capacitor/core'
import type { PeachVaultPlugin, VaultCredentials } from './definitions'

export class PeachVaultWeb extends WebPlugin implements PeachVaultPlugin {
  async isVaultUnlocked(): Promise<{ unlocked: boolean }> {
    return { unlocked: false }
  }

  async unlockVault(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not implemented on web' }
  }

  async getAutofillData(): Promise<{ credentials: VaultCredentials[] }> {
    return { credentials: [] }
  }

  async fillCredential(): Promise<{ username: string; password: string }> {
    return { username: '', password: '' }
  }

  async lockVault(): Promise<void> {
    // No-op
  }

  async hasBiometric(): Promise<{ available: boolean }> {
    return { available: false }
  }

  async authenticateWithBiometric(): Promise<{ success: boolean }> {
    return { success: false }
  }
}
