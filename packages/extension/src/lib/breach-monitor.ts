export interface BreachAlert {
  id: string
  title: string
  domain: string
  breachDate: string
  description: string
  dataClasses: string[]
  compromisedAccounts: string[]
}

export interface BreachCheckResult {
  breached: boolean
  breaches: BreachAlert[]
  checkedAt: Date
}

export interface PasswordHealth {
  totalPasswords: number
  weakPasswords: number
  reusedPasswords: number
  breachedPasswords: number
  overallScore: number // 0-100
}

const HIBP_API_BASE = 'https://haveibeenpwned.com/api/v3'

export class BreachMonitor {
  private apiKey: string | null = null
  private breachCache = new Map<string, BreachCheckResult>()
  private cacheExpiry = 24 * 60 * 60 * 1000 // 24 hours

  constructor(apiKey?: string) {
    this.apiKey = apiKey || null
  }

  setApiKey(key: string): void {
    this.apiKey = key
  }

  async checkEmail(email: string): Promise<BreachCheckResult> {
    if (!this.apiKey) {
      throw new Error('HIBP API key not set')
    }

    const cached = this.getCachedResult(email)
    if (cached) return cached

    try {
      const response = await fetch(
        `${HIBP_API_BASE}/breachedaccount/${encodeURIComponent(email)}`,
        {
          headers: {
            'hibp-api-key': this.apiKey,
            'user-agent': 'PeachPasswordManager/1.0'
          }
        }
      )

      if (response.status === 404) {
        const result: BreachCheckResult = {
          breached: false,
          breaches: [],
          checkedAt: new Date()
        }
        this.cacheResult(email, result)
        return result
      }

      if (!response.ok) {
        throw new Error(`HIBP API error: ${response.status}`)
      }

      const breaches = await response.json()
      const result: BreachCheckResult = {
        breached: true,
        breaches: breaches.map((b: unknown) => this.parseBreach(b)),
        checkedAt: new Date()
      }

      this.cacheResult(email, result)
      return result
    } catch (error) {
      throw new Error(`Failed to check breach status: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async checkPassword(password: string): Promise<boolean> {
    if (!this.apiKey) {
      throw new Error('HIBP API key not set')
    }

    const sha1 = await this.sha1(password)
    const prefix = sha1.substring(0, 5)
    const suffix = sha1.substring(5).toUpperCase()

    try {
      const response = await fetch(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        {
          headers: {
            'user-agent': 'PeachPasswordManager/1.0'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`Pwned Passwords API error: ${response.status}`)
      }

      const text = await response.text()
      const hashes = text.split('\n')

      for (const line of hashes) {
        const [hash] = line.split(':')
        if (hash === suffix) {
          return true
        }
      }

      return false
    } catch (error) {
      throw new Error(`Failed to check password: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async checkMultipleEmails(emails: string[]): Promise<Map<string, BreachCheckResult>> {
    const results = new Map<string, BreachCheckResult>()

    for (const email of emails) {
      try {
        const result = await this.checkEmail(email)
        results.set(email, result)
        await this.sleep(1500)
      } catch {
        results.set(email, {
          breached: false,
          breaches: [],
          checkedAt: new Date()
        })
      }
    }

    return results
  }

  analyzePasswordHealth(
    passwords: Array<{ value: string; entryId: string }>
  ): PasswordHealth {
    const health: PasswordHealth = {
      totalPasswords: passwords.length,
      weakPasswords: 0,
      reusedPasswords: 0,
      breachedPasswords: 0,
      overallScore: 100
    }

    const passwordMap = new Map<string, string[]>()

    for (const { value, entryId } of passwords) {
      if (this.isWeakPassword(value)) {
        health.weakPasswords++
      }

      const existing = passwordMap.get(value) || []
      existing.push(entryId)
      passwordMap.set(value, existing)
    }

    for (const [, entryIds] of passwordMap) {
      if (entryIds.length > 1) {
        health.reusedPasswords += entryIds.length
      }
    }

    health.overallScore = this.calculateHealthScore(health)

    return health
  }

  private isWeakPassword(password: string): boolean {
    if (password.length < 8) return true
    if (!/[A-Z]/.test(password)) return true
    if (!/[a-z]/.test(password)) return true
    if (!/[0-9]/.test(password)) return true
    if (!/[^A-Za-z0-9]/.test(password)) return true

    const commonPatterns = [
      '123456', 'password', 'qwerty', 'abc123',
      'letmein', 'welcome', 'admin', 'login'
    ]

    const lowerPassword = password.toLowerCase()
    for (const pattern of commonPatterns) {
      if (lowerPassword.includes(pattern)) return true
    }

    return false
  }

  private calculateHealthScore(health: PasswordHealth): number {
    let score = 100

    if (health.totalPasswords === 0) return 100

    const weakRatio = health.weakPasswords / health.totalPasswords
    const reuseRatio = health.reusedPasswords / health.totalPasswords
    const breachRatio = health.breachedPasswords / health.totalPasswords

    score -= weakRatio * 30
    score -= reuseRatio * 40
    score -= breachRatio * 30

    return Math.max(0, Math.round(score))
  }

  private parseBreach(breach: unknown): BreachAlert {
    const b = breach as Record<string, unknown>
    return {
      id: String(b.Name || ''),
      title: String(b.Title || ''),
      domain: String(b.Domain || ''),
      breachDate: String(b.BreachDate || ''),
      description: String(b.Description || ''),
      dataClasses: Array.isArray(b.DataClasses) ? b.DataClasses.map(String) : [],
      compromisedAccounts: []
    }
  }

  private async sha1(text: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  }

  private getCachedResult(key: string): BreachCheckResult | null {
    const cached = this.breachCache.get(key)
    if (!cached) return null

    const age = Date.now() - cached.checkedAt.getTime()
    if (age > this.cacheExpiry) {
      this.breachCache.delete(key)
      return null
    }

    return cached
  }

  private cacheResult(key: string, result: BreachCheckResult): void {
    this.breachCache.set(key, result)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const breachMonitor = new BreachMonitor()
