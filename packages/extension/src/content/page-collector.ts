import { identifyLoginFields, isLoginForm } from './field-scoring'
import { findAllForms, findAllInputFields, getFormData, watchForMutations, debounce } from './dom-traversal'

export interface PageDetails {
  url: string
  title: string
  forms: FormDetails[]
  fields: FieldDetails[]
  timestamp: number
}

export interface FormDetails {
  id: string
  action: string
  method: string
  fields: string[]
  isLoginForm: boolean
  element: HTMLFormElement
}

export interface FieldDetails {
  id: string
  name: string
  type: string
  autocomplete: string
  placeholder: string
  isVisible: boolean
  path: string[]
  element: HTMLInputElement
}

export class PageCollector {
  private forms: Map<HTMLFormElement, FormDetails> = new Map()
  private fields: Map<HTMLInputElement, FieldDetails> = new Map()
  private mutationObserver: MutationObserver | null = null
  private onUpdateCallback: ((details: PageDetails) => void) | null = null
  private debouncedCollect: () => void

  constructor() {
    this.debouncedCollect = debounce(() => this.collect(), 500)
  }

  start(onUpdate?: (details: PageDetails) => void): void {
    this.onUpdateCallback = onUpdate || null
    this.collect()
    this.mutationObserver = watchForMutations(
      () => this.debouncedCollect(),
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['type', 'name', 'id', 'autocomplete', 'style', 'class']
      }
    )
  }

  stop(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }
  }

  collect(): PageDetails {
    this.scanForms()
    this.scanFields()

    const details: PageDetails = {
      url: window.location.href,
      title: document.title,
      forms: Array.from(this.forms.values()),
      fields: Array.from(this.fields.values()),
      timestamp: Date.now()
    }

    if (this.onUpdateCallback) {
      this.onUpdateCallback(details)
    }

    return details
  }

  private scanForms(): void {
    const forms = findAllForms()
    const seenForms = new Set<HTMLFormElement>()

    for (const form of forms) {
      seenForms.add(form)

      if (!this.forms.has(form)) {
        const formDetails = this.createFormDetails(form)
        this.forms.set(form, formDetails)
        this.attachFormListeners(form)
      }
    }

    for (const [form] of this.forms) {
      if (!seenForms.has(form)) {
        this.forms.delete(form)
      }
    }
  }

  private scanFields(): void {
    const inputs = findAllInputFields()
    const seenInputs = new Set<HTMLInputElement>()

    for (const input of inputs) {
      seenInputs.add(input.element)

      if (!this.fields.has(input.element)) {
        const fieldDetails = this.createFieldDetails(input.element, input.path)
        this.fields.set(input.element, fieldDetails)
      }
    }

    for (const [input] of this.fields) {
      if (!seenInputs.has(input)) {
        this.fields.delete(input)
      }
    }
  }

  private createFormDetails(form: HTMLFormElement): FormDetails {
    const fields = identifyLoginFields(form)
    const inputNames: string[] = []

    if (fields.username) inputNames.push(fields.username.name || 'username')
    if (fields.password) inputNames.push(fields.password.name || 'password')
    if (fields.email) inputNames.push(fields.email.name || 'email')
    if (fields.totp) inputNames.push(fields.totp.name || 'totp')

    return {
      id: form.id || `form-${Math.random().toString(36).substr(2, 9)}`,
      action: form.action || window.location.href,
      method: form.method || 'GET',
      fields: inputNames,
      isLoginForm: isLoginForm(form),
      element: form
    }
  }

  private createFieldDetails(input: HTMLInputElement, path: string[]): FieldDetails {
    return {
      id: input.id || `input-${Math.random().toString(36).substr(2, 9)}`,
      name: input.name || '',
      type: input.type || 'text',
      autocomplete: input.getAttribute('autocomplete') || '',
      placeholder: input.placeholder || '',
      isVisible: this.isFieldVisible(input),
      path,
      element: input
    }
  }

  private isFieldVisible(input: HTMLInputElement): boolean {
    const style = window.getComputedStyle(input)
    const rect = input.getBoundingClientRect()

    if (style.display === 'none') return false
    if (style.visibility === 'hidden') return false
    if (parseFloat(style.opacity) === 0) return false
    if (rect.width === 0 && rect.height === 0) return false
    if (input.disabled) return false
    if (input.readOnly && input.type !== 'password') return false

    return true
  }

  private attachFormListeners(form: HTMLFormElement): void {
    form.addEventListener('submit', () => {
      this.handleFormSubmit(form)
    })

    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]')
    if (submitButton) {
      submitButton.addEventListener('click', () => {
        this.handleFormSubmit(form)
      })
    }
  }

  private handleFormSubmit(form: HTMLFormElement): void {
    const formDetails = this.forms.get(form)
    if (!formDetails) return

    const event = new CustomEvent('peach:form-submit', {
      detail: {
        form: formDetails,
        data: getFormData(form)
      }
    })
    document.dispatchEvent(event)
  }

  getForms(): FormDetails[] {
    return Array.from(this.forms.values())
  }

  getLoginForms(): FormDetails[] {
    return this.getForms().filter(f => f.isLoginForm)
  }

  getFields(): FieldDetails[] {
    return Array.from(this.fields.values())
  }
}
