import { PageCollector, PageDetails } from './page-collector'
import { SubmissionDetector, SubmissionEvent, SubmissionData } from './submission-detector'
import { FillExecutor, FillRequest, FillResult } from './fill-executor'
import { hybridDetector, HybridFormFields } from './hybrid-detector'

const DEBUG = true

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[Peach Autofill Service]', ...args)
  }
}

export interface AutofillEntry {
  entryId: string
  name: string
  username: string
  password: string
  urls: string[]
  totp?: string
}

export interface AutofillOptions {
  autoFillOnLoad?: boolean
  autoFillDelay?: number
  triggerNotifications?: boolean
}

export type AutofillCallback = (event: AutofillEvent) => void

export interface AutofillEvent {
  type: 'form-detected' | 'form-filled' | 'credentials-submitted' | 'save-requested'
  data?: unknown
  url: string
}

export class AutofillService {
  private collector: PageCollector
  private detector: SubmissionDetector
  private executor: FillExecutor
  private callback: AutofillCallback | null = null
  private options: AutofillOptions
  private autoFillAttempted = false
  private pendingEntries: AutofillEntry[] = []

  constructor(options: AutofillOptions = {}) {
    this.options = {
      autoFillOnLoad: true,
      autoFillDelay: 1500,
      triggerNotifications: true,
      ...options
    }

    this.collector = new PageCollector()
    this.detector = new SubmissionDetector(this.collector)
    this.executor = new FillExecutor()
  }

  start(callback: AutofillCallback): void {
    this.callback = callback

    this.collector.start((details) => {
      this.handlePageUpdate(details)
    })

    this.detector.start((event) => {
      this.handleSubmission(event)
    })

    if (this.options.autoFillOnLoad) {
      setTimeout(() => {
        this.attemptAutoFill()
      }, this.options.autoFillDelay)
    }

    log('Autofill service started')
  }

  stop(): void {
    this.collector.stop()
    this.detector.stop()
    this.callback = null
    log('Autofill service stopped')
  }

  setEntries(entries: AutofillEntry[]): void {
    this.pendingEntries = entries
    log(`Set ${entries.length} pending entries`)
  }

  private handlePageUpdate(details: PageDetails): void {
    const loginForms = details.forms.filter(f => f.isLoginForm)

    if (loginForms.length > 0 && this.callback) {
      this.callback({
        type: 'form-detected',
        data: { forms: loginForms, fields: details.fields },
        url: details.url
      })
    }

    if (!this.autoFillAttempted && this.options.autoFillOnLoad) {
      this.autoFillAttempted = true
      setTimeout(() => this.attemptAutoFill(), 500)
    }
  }

  private handleSubmission(event: SubmissionEvent): void {
    if (!this.callback) return

    switch (event.type) {
      case 'submit':
        if (event.data.username || event.data.password) {
          this.callback({
            type: 'credentials-submitted',
            data: event.data,
            url: window.location.href
          })

          if (this.options.triggerNotifications) {
            this.showSaveNotification(event.data)
          }
        }
        break

      case 'navigation':
        if (this.detector.wasSubmittedWithin(5000)) {
          const lastData = this.detector.getLastSubmittedData()
          if (lastData) {
            this.callback({
              type: 'save-requested',
              data: lastData,
              url: window.location.href
            })
          }
        }
        break
    }
  }

  private async attemptAutoFill(): Promise<void> {
    if (this.pendingEntries.length === 0) {
      log('No entries available for autofill')
      return
    }

    const matchingEntry = this.findMatchingEntry(window.location.href)
    if (!matchingEntry) {
      log('No matching entry for current URL')
      return
    }

    log('Attempting autofill with entry:', matchingEntry.name)

    const forms = this.collector.getLoginForms()
    if (forms.length === 0) {
      log('No login forms found')
      return
    }

    const request: FillRequest = {
      url: window.location.href,
      username: matchingEntry.username,
      password: matchingEntry.password
    }

    const result = await this.executor.fill(request)

    if (result.success && this.callback) {
      this.callback({
        type: 'form-filled',
        data: {
          entry: matchingEntry,
          fields: result.filledFields
        },
        url: window.location.href
      })
    }

    log('Autofill result:', result)
  }

  async fillWithEntry(entry: AutofillEntry): Promise<boolean> {
    const request: FillRequest = {
      url: window.location.href,
      username: entry.username,
      password: entry.password,
      totp: entry.totp
    }

    const result = await this.executor.fill(request)
    return result.success
  }

  private findMatchingEntry(url: string): AutofillEntry | null {
    const hostname = new URL(url).hostname

    for (const entry of this.pendingEntries) {
      for (const entryUrl of entry.urls) {
        try {
          const entryHostname = new URL(entryUrl).hostname
          if (hostname === entryHostname ||
              hostname.endsWith(`.${entryHostname}`) ||
              entryHostname.endsWith(`.${hostname}`)) {
            return entry
          }
        } catch {
          continue
        }
      }
    }

    return null
  }

  private showSaveNotification(data: SubmissionData): void {
    log('Showing save notification for:', data.username)
  }

  async getDetectedFields(): Promise<HybridFormFields> {
    await hybridDetector.init()

    const forms = this.collector.getLoginForms()
    if (forms.length > 0) {
      return hybridDetector.identifyLoginFields(forms[0].element)
    }

    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
    if (passwordInput) {
      return hybridDetector.identifyLoginFields(passwordInput.closest('form') as HTMLFormElement)
    }

    return { username: null, password: null, email: null, totp: null, confidence: { username: 0, password: 0, email: 0, totp: 0 } }
  }

  isLoginPage(): boolean {
    const forms = this.collector.getLoginForms()
    return forms.length > 0 || !!document.querySelector('input[type="password"]')
  }
}

export { PageCollector, SubmissionDetector, FillExecutor }
export type { PageDetails, SubmissionEvent, FillRequest, FillResult, HybridFormFields as FormFields }
