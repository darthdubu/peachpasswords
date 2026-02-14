import { hybridDetector, HybridFormFields } from './hybrid-detector'
import { findInputInAllContexts, getElementFromPath } from './dom-traversal'

export interface FillRequest {
  url: string
  username?: string
  password?: string
  totp?: string
  fields?: Array<{
    path: string[]
    value: string
  }>
}

export interface FillResult {
  success: boolean
  filledFields: string[]
  errors: string[]
}

export interface FillOptions {
  triggerChangeEvents?: boolean
  triggerInputEvents?: boolean
  triggerFocusEvents?: boolean
  delay?: number
}

export class FillExecutor {
  private defaultOptions: FillOptions = {
    triggerChangeEvents: true,
    triggerInputEvents: true,
    triggerFocusEvents: true,
    delay: 10
  }

  async fill(
    request: FillRequest,
    options: FillOptions = {}
  ): Promise<FillResult> {
    const opts = { ...this.defaultOptions, ...options }
    const result: FillResult = {
      success: false,
      filledFields: [],
      errors: []
    }

    try {
      await hybridDetector.init()

      if (request.fields) {
        for (const field of request.fields) {
          const element = getElementFromPath(field.path)
          if (element instanceof HTMLInputElement) {
            await this.fillField(element, field.value, opts)
            result.filledFields.push(field.path.join(' > '))
          } else {
            result.errors.push(`Field not found: ${field.path.join(' > ')}`)
          }
        }
      }

      const forms = document.querySelectorAll('form')
      let targetForm: HTMLFormElement | null = null

      for (const form of forms) {
        if (this.isMatchingForm(form, request)) {
          targetForm = form
          break
        }
      }

      if (!targetForm) {
        const inputs = Array.from(document.querySelectorAll('input[type="password"]'))
        if (inputs.length > 0) {
          targetForm = inputs[0].closest('form') as HTMLFormElement
        }
      }

      if (targetForm) {
        const fields = await hybridDetector.identifyLoginFields(targetForm)
        await this.fillFormFields(fields, request, opts, result)
      } else if (!request.fields) {
        await this.fillFallbackFields(request, opts, result)
      }

      result.success = result.filledFields.length > 0
      return result
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Unknown error')
      return result
    }
  }

  private isMatchingForm(form: HTMLFormElement, request: FillRequest): boolean {
    const action = form.action || ''
    return action.includes(new URL(request.url).hostname)
  }

  private async fillFormFields(
    fields: HybridFormFields,
    request: FillRequest,
    opts: FillOptions,
    result: FillResult
  ): Promise<void> {
    if (fields.username && request.username) {
      await this.fillField(fields.username, request.username, opts)
      result.filledFields.push('username')
    }

    if (fields.password && request.password) {
      await this.fillField(fields.password, request.password, opts)
      result.filledFields.push('password')
    }

    if (fields.totp && request.totp) {
      await this.fillField(fields.totp, request.totp, opts)
      result.filledFields.push('totp')
    }

    if (fields.email && request.username && !fields.username) {
      await this.fillField(fields.email, request.username, opts)
      result.filledFields.push('email')
    }
  }

  private async fillFallbackFields(
    request: FillRequest,
    opts: FillOptions,
    result: FillResult
  ): Promise<void> {
    if (request.password) {
      const passwordInput = findInputInAllContexts(
        input => input.type === 'password' && this.isFieldVisible(input)
      )
      if (passwordInput) {
        await this.fillField(passwordInput, request.password, opts)
        result.filledFields.push('password (fallback)')
      }
    }

    if (request.username) {
      const usernameInput = findInputInAllContexts(input => {
        const type = input.type.toLowerCase()
        const name = (input.name || '').toLowerCase()
        return (type === 'text' || type === 'email') &&
               (name.includes('user') || name.includes('login') || name.includes('email')) &&
               this.isFieldVisible(input)
      })
      if (usernameInput) {
        await this.fillField(usernameInput, request.username, opts)
        result.filledFields.push('username (fallback)')
      }
    }
  }

  private async fillField(
    element: HTMLInputElement,
    value: string,
    opts: FillOptions
  ): Promise<void> {
    if (opts.delay) {
      await this.sleep(opts.delay)
    }

    if (opts.triggerFocusEvents) {
      element.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    }

    element.value = value

    if (opts.triggerInputEvents) {
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }

    if (opts.triggerChangeEvents) {
      element.dispatchEvent(new Event('blur', { bubbles: true }))
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    }
  }

  private isFieldVisible(input: HTMLInputElement): boolean {
    const style = window.getComputedStyle(input)
    const rect = input.getBoundingClientRect()

    if (style.display === 'none') return false
    if (style.visibility === 'hidden') return false
    if (parseFloat(style.opacity) === 0) return false
    if (rect.width === 0 && rect.height === 0) return false

    return true
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  focusPasswordField(): boolean {
    const passwordInput = findInputInAllContexts(
      input => input.type === 'password' && this.isFieldVisible(input)
    )
    if (passwordInput) {
      passwordInput.focus()
      passwordInput.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }
    return false
  }

  focusUsernameField(): boolean {
    const usernameInput = findInputInAllContexts(input => {
      const type = input.type.toLowerCase()
      return (type === 'text' || type === 'email') && this.isFieldVisible(input)
    })
    if (usernameInput) {
      usernameInput.focus()
      usernameInput.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }
    return false
  }
}
