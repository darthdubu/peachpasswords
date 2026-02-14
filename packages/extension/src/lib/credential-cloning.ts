export interface PasswordChangeEvent {
  entryId: string
  domain: string
  oldPassword: string
  newPassword: string
  changedAt: Date
  detectedAt: Date
  autoUpdated: boolean
}

export interface CredentialClone {
  entryId: string
  name: string
  username: string
  password: string
  url: string
  detectedAt: Date
}

export interface PasswordUpdateSuggestion {
  entryId: string
  currentPassword: string
  suggestedPassword?: string
  reason: 'weak' | 'breached' | 'old' | 'reused'
  priority: 'high' | 'medium' | 'low'
}

export class CredentialCloning {
  private passwordHistory = new Map<string, string[]>()
  private changeEvents: PasswordChangeEvent[] = []

  trackPasswordInput(
    entryId: string,
    domain: string,
    username: string,
    password: string
  ): void {
    const history = this.passwordHistory.get(entryId) || []

    if (history.length > 0 && history[history.length - 1] !== password) {
      const oldPassword = history[history.length - 1]
      this.detectPasswordChange(entryId, domain, username, oldPassword, password)
    }

    if (!history.includes(password)) {
      history.push(password)
      if (history.length > 5) {
        history.shift()
      }
      this.passwordHistory.set(entryId, history)
    }
  }

  private detectPasswordChange(
    entryId: string,
    domain: string,
    _username: string,
    oldPassword: string,
    newPassword: string
  ): void {
    const event: PasswordChangeEvent = {
      entryId,
      domain,
      oldPassword,
      newPassword,
      changedAt: new Date(),
      detectedAt: new Date(),
      autoUpdated: false
    }

    this.changeEvents.push(event)

    chrome.runtime.sendMessage({
      type: 'PASSWORD_CHANGE_DETECTED',
      data: {
        entryId,
        domain,
        detectedAt: event.detectedAt.toISOString()
      }
    }).catch(() => {})
  }

  async suggestPasswordUpdate(
    entryId: string,
    currentPassword: string,
    vaultPasswords: Array<{ entryId: string; password: string }>
  ): Promise<PasswordUpdateSuggestion | null> {
    const reasons: PasswordUpdateSuggestion['reason'][] = []

    if (this.isWeakPassword(currentPassword)) {
      reasons.push('weak')
    }

    const reuseCount = vaultPasswords.filter(p => 
      p.password === currentPassword && p.entryId !== entryId
    ).length
    if (reuseCount > 0) {
      reasons.push('reused')
    }

    if (reasons.length === 0) {
      return null
    }

    return {
      entryId,
      currentPassword,
      reason: reasons.includes('breached') ? 'breached' :
              reasons.includes('weak') ? 'weak' :
              reasons.includes('reused') ? 'reused' : 'old',
      priority: reasons.includes('breached') ? 'high' :
                reasons.includes('weak') ? 'medium' : 'low'
    }
  }

  private isWeakPassword(password: string): boolean {
    if (password.length < 12) return true
    if (!/[A-Z]/.test(password)) return true
    if (!/[a-z]/.test(password)) return true
    if (!/[0-9]/.test(password)) return true
    if (!/[^A-Za-z0-9]/.test(password)) return true

    const commonPatterns = [
      '123456', 'password', 'qwerty', 'abc123',
      'letmein', 'welcome', 'admin', 'login',
      'monkey', 'dragon', 'master', 'hello'
    ]

    const lowerPassword = password.toLowerCase()
    for (const pattern of commonPatterns) {
      if (lowerPassword.includes(pattern)) return true
    }

    return false
  }

  generateStrongPassword(length = 16): string {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const lowercase = 'abcdefghijklmnopqrstuvwxyz'
    const numbers = '0123456789'
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?'

    const all = uppercase + lowercase + numbers + symbols
    let password = ''

    password += uppercase[Math.floor(Math.random() * uppercase.length)]
    password += lowercase[Math.floor(Math.random() * lowercase.length)]
    password += numbers[Math.floor(Math.random() * numbers.length)]
    password += symbols[Math.floor(Math.random() * symbols.length)]

    for (let i = 4; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)]
    }

    return password.split('').sort(() => Math.random() - 0.5).join('')
  }

  async assistPasswordChange(
    entryId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    const event: PasswordChangeEvent = {
      entryId,
      domain: window.location.hostname,
      oldPassword,
      newPassword,
      changedAt: new Date(),
      detectedAt: new Date(),
      autoUpdated: true
    }

    this.changeEvents.push(event)

    await chrome.runtime.sendMessage({
      type: 'UPDATE_PASSWORD',
      data: {
        entryId,
        newPassword,
        url: window.location.href,
        domain: window.location.hostname
      }
    })
  }

  getChangeHistory(entryId: string): PasswordChangeEvent[] {
    return this.changeEvents.filter(e => e.entryId === entryId)
  }

  getAllChangeEvents(): PasswordChangeEvent[] {
    return [...this.changeEvents]
  }

  clearHistory(entryId?: string): void {
    if (entryId) {
      this.changeEvents = this.changeEvents.filter(e => e.entryId !== entryId)
      this.passwordHistory.delete(entryId)
    } else {
      this.changeEvents = []
      this.passwordHistory.clear()
    }
  }

  detectPasswordChangeForm(): boolean {
    const forms = document.querySelectorAll('form')

    for (const form of forms) {
      const hasCurrentPassword = form.querySelector('input[type="password"]') !== null
      const passwordInputs = form.querySelectorAll('input[type="password"]')
      const hasNewPassword = passwordInputs.length >= 2
      const hasConfirmPassword = Array.from(passwordInputs).some(input => {
        const name = (input as HTMLInputElement).name.toLowerCase()
        const id = (input as HTMLInputElement).id.toLowerCase()
        const placeholder = ((input as HTMLInputElement).placeholder || '').toLowerCase()
        return name.includes('confirm') || name.includes('verify') ||
               id.includes('confirm') || id.includes('verify') ||
               placeholder.includes('confirm') || placeholder.includes('verify')
      })

      if (hasCurrentPassword && hasNewPassword && hasConfirmPassword) {
        return true
      }
    }

    return false
  }
}

export const credentialCloning = new CredentialCloning()
