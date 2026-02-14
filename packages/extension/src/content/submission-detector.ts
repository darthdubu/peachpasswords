import { PageCollector } from './page-collector'
import { hybridDetector } from './hybrid-detector'
import { debounce, getFormData } from './dom-traversal'

export interface SubmissionData {
  url: string
  formId: string
  formAction: string
  username?: string
  password?: string
  totp?: string
  timestamp: number
}

export interface SubmissionEvent {
  type: 'submit' | 'change' | 'navigation'
  data: SubmissionData
  form: HTMLFormElement
}

type SubmissionCallback = (event: SubmissionEvent) => void

export class SubmissionDetector {
  private collector: PageCollector
  private callback: SubmissionCallback | null = null
  private observedForms: Map<HTMLFormElement, boolean> = new Map()
  private lastSubmittedData: SubmissionData | null = null
  private navigationObserver: MutationObserver | null = null
  private originalPushState: typeof history.pushState | null = null
  private originalReplaceState: typeof history.replaceState | null = null
  private lastUrl: string = ''

  constructor(collector: PageCollector) {
    this.collector = collector
  }

  async start(callback: SubmissionCallback): Promise<void> {
    this.callback = callback
    await hybridDetector.init()
    this.setupFormListeners()
    this.setupNavigationDetection()
    this.startFormPolling()
  }

  stop(): void {
    this.callback = null
    this.observedForms.clear()

    if (this.navigationObserver) {
      this.navigationObserver.disconnect()
      this.navigationObserver = null
    }

    if (this.originalPushState) {
      history.pushState = this.originalPushState
    }
    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState
    }
  }

  private setupFormListeners(): void {
    document.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement
      if (form instanceof HTMLFormElement) {
        void this.handleFormSubmission(form)
      }
    }, true)

    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const button = target.closest('button[type="submit"], input[type="submit"]')
      if (button) {
        const form = button.closest('form') as HTMLFormElement
        if (form) {
          setTimeout(() => void this.handleFormSubmission(form), 100)
        }
      }
    }, true)

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement
        if (target instanceof HTMLInputElement) {
          const form = target.closest('form') as HTMLFormElement
          if (form) {
            setTimeout(() => void this.handleFormSubmission(form), 100)
          }
        }
      }
    }, true)
  }

  private setupNavigationDetection(): void {
    this.lastUrl = window.location.href

    this.originalPushState = history.pushState.bind(history)
    history.pushState = (...args) => {
      this.originalPushState!(...args)
      this.handleNavigation()
    }

    this.originalReplaceState = history.replaceState.bind(history)
    history.replaceState = (...args) => {
      this.originalReplaceState!(...args)
      this.handleNavigation()
    }

    window.addEventListener('popstate', () => {
      this.handleNavigation()
    })

    this.navigationObserver = new MutationObserver(() => {
      const currentUrl = window.location.href
      if (currentUrl !== this.lastUrl) {
        this.lastUrl = currentUrl
        this.handleNavigation()
      }
    })

    this.navigationObserver.observe(document, {
      childList: true,
      subtree: true
    })
  }

  private startFormPolling(): void {
    const poll = debounce(() => {
      const forms = this.collector.getForms()
      for (const form of forms) {
        if (!this.observedForms.has(form.element)) {
          this.observedForms.set(form.element, true)
        }
      }
    }, 1000)

    setInterval(poll, 1000)
  }

  private async handleFormSubmission(form: HTMLFormElement): Promise<void> {
    const forms = this.collector.getForms()
    const formDetails = forms.find(f => f.element === form)

    if (!formDetails) return

    const fields = await hybridDetector.identifyLoginFields(form)
    const formData = getFormData(form)

    const submissionData: SubmissionData = {
      url: window.location.href,
      formId: formDetails.id,
      formAction: formDetails.action,
      timestamp: Date.now()
    }

    if (fields.username) {
      submissionData.username = fields.username.value || formData[fields.username.name] || ''
    }

    if (fields.password) {
      submissionData.password = fields.password.value || formData[fields.password.name] || ''
    }

    if (fields.totp) {
      submissionData.totp = fields.totp.value || formData[fields.totp.name] || ''
    }

    if (!submissionData.username && !submissionData.password) {
      for (const [, value] of Object.entries(formData)) {
        if (!submissionData.username && value.length > 0 && value.length < 100) {
          submissionData.username = value
          break
        }
      }
    }

    this.lastSubmittedData = submissionData

    if (this.callback) {
      this.callback({
        type: 'submit',
        data: submissionData,
        form
      })
    }
  }

  private handleNavigation(): void {
    if (!this.callback) return

    setTimeout(() => {
      this.callback!({
        type: 'navigation',
        data: {
          url: window.location.href,
          formId: '',
          formAction: '',
          timestamp: Date.now()
        },
        form: null as unknown as HTMLFormElement
      })
    }, 100)
  }

  getLastSubmittedData(): SubmissionData | null {
    return this.lastSubmittedData
  }

  wasSubmittedWithin(timeMs: number): boolean {
    if (!this.lastSubmittedData) return false
    return Date.now() - this.lastSubmittedData.timestamp < timeMs
  }
}
