import * as ort from 'onnxruntime-web'

export type FieldType = 'username' | 'password' | 'email' | 'totp' | 'none'

export interface FieldPrediction {
  type: FieldType
  confidence: number
  probabilities: Record<FieldType, number>
}

export interface MLFieldFeatures {
  type_text: number
  type_email: number
  type_password: number
  type_tel: number
  type_number: number
  type_search: number
  type_url: number
  type_other: number
  auto_username: number
  auto_email: number
  auto_current_password: number
  auto_new_password: number
  auto_one_time_code: number
  auto_off: number
  auto_other: number
  name_has_user: number
  name_has_login: number
  name_has_email: number
  name_has_pass: number
  name_length: number
  id_has_user: number
  id_has_login: number
  id_has_email: number
  id_has_pass: number
  id_length: number
  placeholder_has_user: number
  placeholder_has_email: number
  placeholder_has_pass: number
  placeholder_length: number
  aria_label_has_user: number
  aria_label_has_email: number
  aria_label_has_pass: number
  aria_label_length: number
  parent_is_form: number
  parent_is_div: number
  parent_is_section: number
  sibling_count: number
  has_password_sibling: number
  has_email_sibling: number
  form_has_submit: number
  form_action_has_login: number
  is_required: number
  has_placeholder: number
  has_aria_label: number
  inputmode_numeric: number
}

const LABELS: FieldType[] = ['username', 'password', 'email', 'totp', 'none']

export class MLFieldDetector {
  private session: ort.InferenceSession | null = null
  private isLoading = false
  private loadPromise: Promise<void> | null = null

  async init(modelUrl?: string): Promise<void> {
    if (this.session) return
    if (this.isLoading) {
      await this.loadPromise
      return
    }

    this.isLoading = true
    this.loadPromise = this.loadModel(modelUrl)
    await this.loadPromise
    this.isLoading = false
  }

  private async loadModel(modelUrl?: string): Promise<void> {
    const url = modelUrl || chrome.runtime.getURL('models/form_detector.onnx')
    this.session = await ort.InferenceSession.create(url)
  }

  extractFeatures(input: HTMLInputElement): MLFieldFeatures {
    const inputType = input.type.toLowerCase()
    const features: MLFieldFeatures = {
      type_text: inputType === 'text' ? 1 : 0,
      type_email: inputType === 'email' ? 1 : 0,
      type_password: inputType === 'password' ? 1 : 0,
      type_tel: inputType === 'tel' ? 1 : 0,
      type_number: inputType === 'number' ? 1 : 0,
      type_search: inputType === 'search' ? 1 : 0,
      type_url: inputType === 'url' ? 1 : 0,
      type_other: ['text', 'email', 'password', 'tel', 'number', 'search', 'url'].includes(inputType) ? 0 : 1,
      auto_username: 0,
      auto_email: 0,
      auto_current_password: 0,
      auto_new_password: 0,
      auto_one_time_code: 0,
      auto_off: 0,
      auto_other: 0,
      name_has_user: this.matchScore(input.name, [/user/i, /login/i, /usr/i, /uname/i, /account/i, /acct/i, /signin/i, /sign-in/i, /session/i, /member/i, /alias/i]),
      name_has_login: this.matchScore(input.name, [/login/i]),
      name_has_email: this.matchScore(input.name, [/email/i, /e-mail/i, /mail/i]),
      name_has_pass: this.matchScore(input.name, [/pass/i, /password/i, /pwd/i, /secret/i, /passphrase/i, /key/i, /credential/i]),
      name_length: input.name.length / 50,
      id_has_user: this.matchScore(input.id, [/user/i, /login/i, /usr/i, /uname/i, /account/i, /acct/i, /signin/i, /sign-in/i, /session/i, /member/i, /alias/i]),
      id_has_login: this.matchScore(input.id, [/login/i]),
      id_has_email: this.matchScore(input.id, [/email/i, /e-mail/i, /mail/i]),
      id_has_pass: this.matchScore(input.id, [/pass/i, /password/i, /pwd/i, /secret/i, /passphrase/i, /key/i, /credential/i]),
      id_length: input.id.length / 50,
      placeholder_has_user: this.matchScore(input.placeholder, [/user/i, /login/i, /usr/i, /uname/i, /account/i, /acct/i, /signin/i, /sign-in/i, /session/i, /member/i, /alias/i]),
      placeholder_has_email: this.matchScore(input.placeholder, [/email/i, /e-mail/i, /mail/i]),
      placeholder_has_pass: this.matchScore(input.placeholder, [/pass/i, /password/i, /pwd/i, /secret/i, /passphrase/i, /key/i, /credential/i]),
      placeholder_length: input.placeholder.length / 100,
      aria_label_has_user: this.matchScore(input.getAttribute('aria-label') || '', [/user/i, /login/i, /usr/i, /uname/i, /account/i, /acct/i, /signin/i, /sign-in/i, /session/i, /member/i, /alias/i]),
      aria_label_has_email: this.matchScore(input.getAttribute('aria-label') || '', [/email/i, /e-mail/i, /mail/i]),
      aria_label_has_pass: this.matchScore(input.getAttribute('aria-label') || '', [/pass/i, /password/i, /pwd/i, /secret/i, /passphrase/i, /key/i, /credential/i]),
      aria_label_length: (input.getAttribute('aria-label') || '').length / 100,
      parent_is_form: 0,
      parent_is_div: 0,
      parent_is_section: 0,
      sibling_count: 0,
      has_password_sibling: 0,
      has_email_sibling: 0,
      form_has_submit: 0,
      form_action_has_login: 0,
      is_required: input.required ? 1 : 0,
      has_placeholder: input.placeholder ? 1 : 0,
      has_aria_label: input.getAttribute('aria-label') ? 1 : 0,
      inputmode_numeric: input.inputMode === 'numeric' ? 1 : 0,
    }

    const auto = (input.getAttribute('autocomplete') || '').toLowerCase()
    if (auto.includes('username')) features.auto_username = 1
    else if (auto.includes('email')) features.auto_email = 1
    else if (auto.includes('current-password')) features.auto_current_password = 1
    else if (auto.includes('new-password')) features.auto_new_password = 1
    else if (auto.includes('one-time-code')) features.auto_one_time_code = 1
    else if (auto === 'off') features.auto_off = 1
    else features.auto_other = 1

    const parent = input.parentElement
    if (parent) {
      const parentName = parent.tagName.toLowerCase()
      features.parent_is_form = parentName === 'form' ? 1 : 0
      features.parent_is_div = parentName === 'div' ? 1 : 0
      features.parent_is_section = parentName === 'section' ? 1 : 0

      const siblings = Array.from(parent.children).filter(el => el.tagName === 'INPUT')
      features.sibling_count = siblings.length / 10

      for (const sibling of siblings) {
        if (sibling === input) continue
        const sibType = (sibling as HTMLInputElement).type
        if (sibType === 'password') features.has_password_sibling = 1
        if (sibType === 'email') features.has_email_sibling = 1
      }
    }

    const form = input.closest('form')
    if (form) {
      features.form_has_submit = form.querySelector('button[type="submit"], input[type="submit"]') ? 1 : 0
      const action = form.getAttribute('action') || ''
      features.form_action_has_login = /login|signin|auth|session/i.test(action) ? 1 : 0
    }

    return features
  }

  private matchScore(text: string, patterns: RegExp[]): number {
    if (!text) return 0
    const matches = patterns.reduce((count, p) => count + (p.test(text) ? 1 : 0), 0)
    return Math.min((matches / patterns.length) * 3, 1)
  }

  private featuresToVector(features: MLFieldFeatures): Float32Array {
    return new Float32Array([
      features.type_text, features.type_email, features.type_password, features.type_tel,
      features.type_number, features.type_search, features.type_url, features.type_other,
      features.auto_username, features.auto_email, features.auto_current_password,
      features.auto_new_password, features.auto_one_time_code, features.auto_off, features.auto_other,
      features.name_has_user, features.name_has_login, features.name_has_email, features.name_has_pass,
      features.name_length, features.id_has_user, features.id_has_login, features.id_has_email,
      features.id_has_pass, features.id_length, features.placeholder_has_user,
      features.placeholder_has_email, features.placeholder_has_pass, features.placeholder_length,
      features.aria_label_has_user, features.aria_label_has_email, features.aria_label_has_pass,
      features.aria_label_length, features.parent_is_form, features.parent_is_div,
      features.parent_is_section, features.sibling_count, features.has_password_sibling,
      features.has_email_sibling, features.form_has_submit, features.form_action_has_login,
      features.is_required, features.has_placeholder, features.has_aria_label,
      features.inputmode_numeric,
    ])
  }

  async predict(input: HTMLInputElement): Promise<FieldPrediction> {
    if (!this.session) {
      await this.init()
      if (!this.session) {
        throw new Error('Failed to initialize ML model')
      }
    }

    const features = this.extractFeatures(input)
    const vector = this.featuresToVector(features)

    const tensor = new ort.Tensor('float32', vector, [1, 45])
    const inputName = this.session.inputNames[0]
    const outputName = this.session.outputNames[0]

    const feeds: Record<string, ort.Tensor> = {}
    feeds[inputName] = tensor

    const results = await this.session.run(feeds)
    const output = results[outputName]
    const probs = output.data as Float32Array

    let maxIndex = 0
    let maxProb = probs[0]
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > maxProb) {
        maxProb = probs[i]
        maxIndex = i
      }
    }

    return {
      type: LABELS[maxIndex],
      confidence: maxProb,
      probabilities: {
        username: probs[0],
        password: probs[1],
        email: probs[2],
        totp: probs[3],
        none: probs[4],
      }
    }
  }

  dispose(): void {
    if (this.session) {
      this.session.release()
      this.session = null
    }
  }
}

export const mlDetector = new MLFieldDetector()
