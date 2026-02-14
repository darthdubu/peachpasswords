import { identifyLoginFields as regexIdentifyLoginFields, FormFields as RegexFormFields } from './field-scoring'
import { mlDetector, FieldPrediction, FieldType } from './ml-field-detector'

export interface HybridFormFields {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
  email: HTMLInputElement | null
  totp: HTMLInputElement | null
  confidence: {
    username: number
    password: number
    email: number
    totp: number
  }
}

export interface HybridOptions {
  useML: boolean
  mlThreshold: number
  preferMLWhenConfident: boolean
}

const DEFAULT_OPTIONS: HybridOptions = {
  useML: true,
  mlThreshold: 0.85,
  preferMLWhenConfident: true,
}

export class HybridFieldDetector {
  private options: HybridOptions
  private mlInitialized = false

  constructor(options: Partial<HybridOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  async init(): Promise<void> {
    if (this.options.useML && !this.mlInitialized) {
      try {
        await mlDetector.init()
        this.mlInitialized = true
      } catch (error) {
        console.warn('Failed to initialize ML detector, falling back to regex:', error)
        this.options.useML = false
      }
    }
  }

  async identifyLoginFields(form: HTMLFormElement | null): Promise<HybridFormFields> {
    const regexResult = regexIdentifyLoginFields(form)

    if (!this.options.useML || !this.mlInitialized) {
      return {
        username: regexResult.username,
        password: regexResult.password,
        email: regexResult.email,
        totp: regexResult.totp,
        confidence: { username: 0.7, password: 0.7, email: 0.7, totp: 0.7 },
      }
    }

    return this.identifyWithHybrid(form, regexResult)
  }

  private async identifyWithHybrid(
    form: HTMLFormElement | null,
    regexResult: RegexFormFields
  ): Promise<HybridFormFields> {
    const inputs = form
      ? Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'))
      : Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'))

    const predictions = new Map<HTMLInputElement, FieldPrediction>()

    for (const input of inputs) {
      if (input instanceof HTMLInputElement) {
        try {
          const prediction = await mlDetector.predict(input)
          predictions.set(input, prediction)
        } catch {}
      }
    }

    const result: HybridFormFields = {
      username: null,
      password: null,
      email: null,
      totp: null,
      confidence: { username: 0, password: 0, email: 0, totp: 0 },
    }

    const usedElements = new Set<HTMLInputElement>()

    for (const [input, prediction] of predictions) {
      if (usedElements.has(input)) continue

      const { type, confidence } = prediction

      if (type === 'none') continue
      if (confidence < this.options.mlThreshold) {
        const regexField = this.getRegexFieldForType(regexResult, type)
        if (regexField === input) {
          this.assignField(result, type, input, confidence, usedElements)
        }
        continue
      }

      if (this.options.preferMLWhenConfident && confidence >= this.options.mlThreshold) {
        this.assignField(result, type, input, confidence, usedElements)
      } else {
        const regexField = this.getRegexFieldForType(regexResult, type)
        if (regexField === input) {
          this.assignField(result, type, input, confidence, usedElements)
        }
      }
    }

    for (const type of ['username', 'password', 'email', 'totp'] as FieldType[]) {
      if (type === 'none') continue
      const field = this.getResultField(result, type)
      const regexField = this.getRegexFieldForType(regexResult, type)

      if (!field && regexField) {
        const prediction = predictions.get(regexField)
        const confidence = prediction?.confidence || 0.5
        this.assignField(result, type, regexField, confidence, usedElements)
      }
    }

    return result
  }

  private getRegexFieldForType(regexResult: RegexFormFields, type: FieldType): HTMLInputElement | null {
    switch (type) {
      case 'username': return regexResult.username
      case 'password': return regexResult.password
      case 'email': return regexResult.email
      case 'totp': return regexResult.totp
      default: return null
    }
  }

  private getResultField(result: HybridFormFields, type: FieldType): HTMLInputElement | null {
    switch (type) {
      case 'username': return result.username
      case 'password': return result.password
      case 'email': return result.email
      case 'totp': return result.totp
      default: return null
    }
  }

  private assignField(
    result: HybridFormFields,
    type: FieldType,
    element: HTMLInputElement,
    confidence: number,
    usedElements: Set<HTMLInputElement>
  ): void {
    if (type === 'none') return

    switch (type) {
      case 'username':
        if (!result.username) {
          result.username = element
          result.confidence.username = confidence
          usedElements.add(element)
        }
        break
      case 'password':
        if (!result.password) {
          result.password = element
          result.confidence.password = confidence
          usedElements.add(element)
        }
        break
      case 'email':
        if (!result.email && !result.username) {
          result.email = element
          result.confidence.email = confidence
          usedElements.add(element)
        }
        break
      case 'totp':
        if (!result.totp) {
          result.totp = element
          result.confidence.totp = confidence
          usedElements.add(element)
        }
        break
    }
  }
}

export const hybridDetector = new HybridFieldDetector()
