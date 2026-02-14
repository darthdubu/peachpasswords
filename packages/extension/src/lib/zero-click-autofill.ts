export interface TrustedSite {
  domain: string
  entryId: string
  enabled: boolean
  requireBiometric: boolean
  lastUsed: Date
  createdAt: Date
}

export interface ZeroClickSettings {
  enabled: boolean
  requireBiometric: boolean
  maxSites: number
  trustedSites: TrustedSite[]
}

const DEFAULT_SETTINGS: ZeroClickSettings = {
  enabled: false,
  requireBiometric: true,
  maxSites: 10,
  trustedSites: []
}

const STORAGE_KEY = 'peach_zero_click_settings'

export class ZeroClickAutofill {
  private settings: ZeroClickSettings = DEFAULT_SETTINGS

  async loadSettings(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      if (result[STORAGE_KEY]) {
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...result[STORAGE_KEY],
          trustedSites: (result[STORAGE_KEY].trustedSites || []).map((s: Record<string, string>) => ({
            ...s,
            lastUsed: new Date(s.lastUsed),
            createdAt: new Date(s.createdAt)
          }))
        }
      }
    } catch {
      this.settings = DEFAULT_SETTINGS
    }
  }

  async saveSettings(): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEY]: this.settings
    })
  }

  isEnabled(): boolean {
    return this.settings.enabled
  }

  async enable(): Promise<void> {
    this.settings.enabled = true
    await this.saveSettings()
  }

  async disable(): Promise<void> {
    this.settings.enabled = false
    await this.saveSettings()
  }

  isSiteTrusted(domain: string): boolean {
    if (!this.settings.enabled) return false
    return this.settings.trustedSites.some(s => 
      s.domain === domain && s.enabled
    )
  }

  async addTrustedSite(domain: string, entryId: string): Promise<void> {
    if (this.settings.trustedSites.length >= this.settings.maxSites) {
      throw new Error(`Maximum number of trusted sites (${this.settings.maxSites}) reached`)
    }

    const existing = this.settings.trustedSites.find(s => s.domain === domain)
    if (existing) {
      existing.entryId = entryId
      existing.enabled = true
      existing.lastUsed = new Date()
    } else {
      this.settings.trustedSites.push({
        domain,
        entryId,
        enabled: true,
        requireBiometric: this.settings.requireBiometric,
        lastUsed: new Date(),
        createdAt: new Date()
      })
    }

    await this.saveSettings()
  }

  async removeTrustedSite(domain: string): Promise<void> {
    this.settings.trustedSites = this.settings.trustedSites.filter(
      s => s.domain !== domain
    )
    await this.saveSettings()
  }

  async toggleTrustedSite(domain: string): Promise<void> {
    const site = this.settings.trustedSites.find(s => s.domain === domain)
    if (site) {
      site.enabled = !site.enabled
      await this.saveSettings()
    }
  }

  getTrustedSite(domain: string): TrustedSite | null {
    return this.settings.trustedSites.find(s => s.domain === domain) || null
  }

  getAllTrustedSites(): TrustedSite[] {
    return [...this.settings.trustedSites]
  }

  async shouldAutoFill(domain: string): Promise<boolean> {
    if (!this.settings.enabled) return false
    
    const site = this.getTrustedSite(domain)
    if (!site || !site.enabled) return false

    if (site.requireBiometric) {
      return await this.verifyBiometric()
    }

    return true
  }

  private async verifyBiometric(): Promise<boolean> {
    try {
      // Check if WebAuthn is available
      if (!window.PublicKeyCredential) {
        return false
      }

      // Request user verification through browser's biometric prompt
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      
      const options: PublicKeyCredentialRequestOptions = {
        challenge,
        rpId: location.hostname,
        userVerification: 'required',
        timeout: 60000,
      }

      await navigator.credentials.get({ publicKey: options })
      return true
    } catch {
      return false
    }
  }

  async recordSiteUsage(domain: string): Promise<void> {
    const site = this.settings.trustedSites.find(s => s.domain === domain)
    if (site) {
      site.lastUsed = new Date()
      await this.saveSettings()
    }
  }

  getSettings(): ZeroClickSettings {
    return { ...this.settings }
  }

  async updateSettings(settings: Partial<ZeroClickSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings }
    await this.saveSettings()
  }
}

export const zeroClickAutofill = new ZeroClickAutofill()
