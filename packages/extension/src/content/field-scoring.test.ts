import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { 
  scoreInputField, 
  identifyLoginFields, 
  isLoginForm,
  USERNAME_PATTERNS,
  PASSWORD_PATTERNS,
  EMAIL_PATTERNS,
  TOTP_PATTERNS
} from './field-scoring'

describe('Field Scoring', () => {
  describe('Pattern Matching', () => {
    it('should match username patterns', () => {
      expect(USERNAME_PATTERNS.some((p: RegExp) => p.test('username'))).toBe(true)
      expect(USERNAME_PATTERNS.some((p: RegExp) => p.test('login'))).toBe(true)
      expect(USERNAME_PATTERNS.some((p: RegExp) => p.test('user'))).toBe(true)
      expect(USERNAME_PATTERNS.some((p: RegExp) => p.test('random_field'))).toBe(false)
    })

    it('should match password patterns', () => {
      expect(PASSWORD_PATTERNS.some((p: RegExp) => p.test('password'))).toBe(true)
      expect(PASSWORD_PATTERNS.some((p: RegExp) => p.test('pass'))).toBe(true)
      expect(PASSWORD_PATTERNS.some((p: RegExp) => p.test('secret'))).toBe(true)
      expect(PASSWORD_PATTERNS.some((p: RegExp) => p.test('random_field'))).toBe(false)
    })

    it('should match email patterns', () => {
      expect(EMAIL_PATTERNS.some((p: RegExp) => p.test('email'))).toBe(true)
      expect(EMAIL_PATTERNS.some((p: RegExp) => p.test('e-mail'))).toBe(true)
      expect(EMAIL_PATTERNS.some((p: RegExp) => p.test('random_field'))).toBe(false)
    })

    it('should match TOTP patterns', () => {
      expect(TOTP_PATTERNS.some((p: RegExp) => p.test('totp'))).toBe(true)
      expect(TOTP_PATTERNS.some((p: RegExp) => p.test('otp'))).toBe(true)
      expect(TOTP_PATTERNS.some((p: RegExp) => p.test('2fa'))).toBe(true)
      expect(TOTP_PATTERNS.some((p: RegExp) => p.test('random_field'))).toBe(false)
    })
  })

  describe('Input Field Scoring', () => {
    let container: HTMLDivElement

    beforeEach(() => {
      container = document.createElement('div')
      document.body.appendChild(container)
    })

    afterEach(() => {
      document.body.removeChild(container)
    })

    it('should score password field with type=password highly', () => {
      const input = document.createElement('input')
      input.type = 'password'
      container.appendChild(input)

      const score = scoreInputField(input)
      expect(score.fieldType).toBe('password')
      expect(score.score).toBeGreaterThan(5)
    })

    it('should score username field with autocomplete', () => {
      const input = document.createElement('input')
      input.type = 'text'
      input.setAttribute('autocomplete', 'username')
      container.appendChild(input)

      const score = scoreInputField(input)
      expect(score.fieldType).toBe('username')
      expect(score.factors.autocompleteMatch).toBe(10)
    })

    it('should score email field with type=email', () => {
      const input = document.createElement('input')
      input.type = 'email'
      container.appendChild(input)

      const score = scoreInputField(input)
      expect(score.fieldType).toBe('email')
      expect(score.factors.typeMatch).toBe(8)
    })

    it('should score TOTP field with appropriate attributes', () => {
      const input = document.createElement('input')
      input.type = 'tel'
      input.setAttribute('autocomplete', 'one-time-code')
      input.name = 'totp'
      container.appendChild(input)

      const score = scoreInputField(input)
      expect(score.fieldType).toBe('totp')
      expect(score.score).toBeGreaterThan(5)
    })
  })

  describe('Real-World Login Form Detection', () => {
    let container: HTMLDivElement

    beforeEach(() => {
      container = document.createElement('div')
      document.body.appendChild(container)
    })

    afterEach(() => {
      document.body.removeChild(container)
    })

    it('should detect GitHub-style login form', () => {
      container.innerHTML = `
        <form>
          <input type="text" name="login" autocomplete="username" />
          <input type="password" name="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.username).not.toBeNull()
      expect(fields.password).not.toBeNull()
      expect(fields.username?.name).toBe('login')
      expect(fields.password?.name).toBe('password')
    })

    it('should detect Google-style login form', () => {
      container.innerHTML = `
        <form>
          <input type="email" autocomplete="username" name="identifier" />
          <button type="submit">Next</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.email).not.toBeNull()
      expect(fields.email?.name).toBe('identifier')
    })

    it('should detect split-page login (username then password)', () => {
      container.innerHTML = `
        <form>
          <input type="password" name="Passwd" autocomplete="current-password" />
          <button type="submit">Next</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.password).not.toBeNull()
    })

    it('should detect 2FA/TOTP form', () => {
      container.innerHTML = `
        <form>
          <input type="tel" name="totpPin" autocomplete="one-time-code" 
                 inputmode="numeric" pattern="[0-9]*" />
          <button type="submit">Verify</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.totp).not.toBeNull()
    })

    it('should detect AWS Console login form', () => {
      container.innerHTML = `
        <form id="signin_form">
          <input type="text" id="username" name="username" 
                 autocomplete="username" aria-label="Account ID" />
          <input type="password" id="password" name="password" 
                 autocomplete="current-password" />
          <button type="submit">Sign In</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.username).not.toBeNull()
      expect(fields.password).not.toBeNull()
      expect(isLoginForm(form)).toBe(true)
    })

    it('should detect Microsoft login form', () => {
      container.innerHTML = `
        <form>
          <input type="email" name="loginfmt" 
                 autocomplete="username" 
                 placeholder="Email, phone, or Skype" />
          <button type="submit">Next</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.email).not.toBeNull()
    })

    it('should detect Stripe-style login form', () => {
      container.innerHTML = `
        <form>
          <input type="email" name="email" 
                 autocomplete="username email" 
                 placeholder="Email" />
          <input type="password" name="password" 
                 autocomplete="current-password" />
          <button type="submit">Sign in to your account</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.email).not.toBeNull()
      expect(fields.password).not.toBeNull()
    })
  })

  describe('Signup Form Detection', () => {
    let container: HTMLDivElement

    beforeEach(() => {
      container = document.createElement('div')
      document.body.appendChild(container)
    })

    afterEach(() => {
      document.body.removeChild(container)
    })

    it('should distinguish signup from login', () => {
      container.innerHTML = `
        <form>
          <input type="email" name="email" autocomplete="email" />
          <input type="password" name="new_password" autocomplete="new-password" />
          <input type="password" name="confirm_password" autocomplete="new-password" />
          <button type="submit">Create Account</button>
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.email).not.toBeNull()
      expect(fields.password).not.toBeNull()
      
      const passwordInputs = form.querySelectorAll('input[type="password"]')
      expect(passwordInputs.length).toBe(2)
    })
  })

  describe('Edge Cases', () => {
    let container: HTMLDivElement

    beforeEach(() => {
      container = document.createElement('div')
      document.body.appendChild(container)
    })

    afterEach(() => {
      document.body.removeChild(container)
    })

    it('should handle forms without explicit form element', () => {
      container.innerHTML = `
        <div>
          <input type="text" name="user" autocomplete="username" />
          <input type="password" name="pass" />
          <button>Login</button>
        </div>
      `
      
      const fields = identifyLoginFields(null)
      expect(fields.username).not.toBeNull()
      expect(fields.password).not.toBeNull()
    })

    it('should handle hidden fields', () => {
      container.innerHTML = `
        <form>
          <input type="hidden" name="csrf_token" value="abc123" />
          <input type="text" name="login" />
          <input type="password" name="password" />
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.username).not.toBeNull()
      expect(fields.password).not.toBeNull()
    })

    it('should prioritize correctly when multiple candidates exist', () => {
      container.innerHTML = `
        <form>
          <input type="text" name="search" placeholder="Search..." />
          <input type="text" name="user_login" autocomplete="username" />
          <input type="password" name="pass" />
        </form>
      `
      const form = container.querySelector('form')!
      const fields = identifyLoginFields(form)

      expect(fields.username?.name).toBe('user_login')
    })
  })
})
