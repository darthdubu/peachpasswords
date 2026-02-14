import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { identifyLoginFields, isLoginForm } from '../content/field-scoring'
import { FillExecutor } from '../content/fill-executor'

interface TestSite {
  name: string
  url: string
  expectedFields: {
    hasUsername?: boolean
    hasPassword?: boolean
    hasEmail?: boolean
    hasTotp?: boolean
  }
  html: string
}

const TEST_SITES: TestSite[] = [
  {
    name: 'GitHub Login',
    url: 'https://github.com/login',
    expectedFields: { hasUsername: true, hasPassword: true },
    html: `
      <form action="/session" method="post">
        <label for="login_field">Username or email address</label>
        <input type="text" name="login" id="login_field" 
               autocomplete="username" />
        <label for="password">Password</label>
        <input type="password" name="password" id="password" 
               autocomplete="current-password" />
        <input type="submit" name="commit" value="Sign in" />
      </form>
    `
  },
  {
    name: 'Google Sign-in (Step 1)',
    url: 'https://accounts.google.com/signin',
    expectedFields: { hasEmail: true },
    html: `
      <form>
        <input type="email" name="identifier" 
               autocomplete="username" 
               aria-label="Email or phone" />
        <button type="button">Next</button>
      </form>
    `
  },
  {
    name: 'Google Sign-in (Step 2)',
    url: 'https://accounts.google.com/signin/challenge',
    expectedFields: { hasPassword: true },
    html: `
      <form>
        <input type="password" name="Passwd" 
               autocomplete="current-password" 
               aria-label="Enter your password" />
        <button type="submit">Next</button>
      </form>
    `
  },
  {
    name: 'Microsoft Login',
    url: 'https://login.microsoftonline.com',
    expectedFields: { hasEmail: true, hasPassword: true },
    html: `
      <form>
        <input type="email" name="loginfmt" 
               autocomplete="username" 
               placeholder="Email, phone, or Skype" />
        <input type="password" name="passwd" 
               autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `
  },
  {
    name: 'AWS Console Login',
    url: 'https://signin.aws.amazon.com',
    expectedFields: { hasUsername: true, hasPassword: true },
    html: `
      <form id="signin_form">
        <input type="text" id="username" name="username" 
               autocomplete="username" 
               aria-label="Account ID (12 digits) or account alias" />
        <input type="password" id="password" name="password" 
               autocomplete="current-password" />
        <button type="submit">Sign In</button>
      </form>
    `
  },
  {
    name: 'Stripe Dashboard',
    url: 'https://dashboard.stripe.com/login',
    expectedFields: { hasEmail: true, hasPassword: true },
    html: `
      <form>
        <input type="email" name="email" 
               autocomplete="username email" 
               placeholder="Email" />
        <input type="password" name="password" 
               autocomplete="current-password" />
        <button type="submit">Sign in to your account</button>
      </form>
    `
  },
  {
    name: 'GitLab Login',
    url: 'https://gitlab.com/users/sign_in',
    expectedFields: { hasUsername: true, hasPassword: true },
    html: `
      <form>
        <input type="text" name="user[login]" 
               autocomplete="username" 
               placeholder="Username or email" />
        <input type="password" name="user[password]" 
               autocomplete="current-password" 
               placeholder="Password" />
        <button type="submit">Sign in</button>
      </form>
    `
  },
  {
    name: 'Twitter/X Login',
    url: 'https://twitter.com/i/flow/login',
    expectedFields: { hasUsername: true, hasPassword: true },
    html: `
      <form>
        <input type="text" name="text" 
               autocomplete="username" 
               placeholder="Phone, email, or username" />
        <input type="password" name="password" 
               autocomplete="current-password" />
        <button type="submit">Log in</button>
      </form>
    `
  },
  {
    name: 'Netflix Login',
    url: 'https://www.netflix.com/login',
    expectedFields: { hasEmail: true, hasPassword: true },
    html: `
      <form>
        <input type="email" name="userLoginId" 
               autocomplete="email" 
               placeholder="Email or phone number" />
        <input type="password" name="password" 
               autocomplete="current-password" 
               placeholder="Password" />
        <button type="submit">Sign In</button>
      </form>
    `
  },
  {
    name: 'Dropbox Login',
    url: 'https://www.dropbox.com/login',
    expectedFields: { hasEmail: true, hasPassword: true },
    html: `
      <form>
        <input type="email" name="login_email" 
               autocomplete="username email" 
               placeholder="Email" />
        <input type="password" name="login_password" 
               autocomplete="current-password" 
               placeholder="Password" />
        <button type="submit">Sign in</button>
      </form>
    `
  },
  {
    name: 'Discord Login',
    url: 'https://discord.com/login',
    expectedFields: { hasEmail: true, hasPassword: true },
    html: `
      <form>
        <input type="email" name="email" 
               autocomplete="email" 
               placeholder="Email" />
        <input type="password" name="password" 
               autocomplete="current-password" 
               placeholder="Password" />
        <button type="submit">Log In</button>
      </form>
    `
  },
  {
    name: 'Slack Login',
    url: 'https://slack.com/signin',
    expectedFields: { hasEmail: true },
    html: `
      <form>
        <input type="email" name="email" 
               autocomplete="username email" 
               placeholder="name@work-email.com" />
        <button type="submit">Sign In with Email</button>
      </form>
    `
  },
  {
    name: '2FA/TOTP Form',
    url: 'https://example.com/2fa',
    expectedFields: { hasTotp: true },
    html: `
      <form>
        <input type="tel" name="totpPin" 
               autocomplete="one-time-code" 
               inputmode="numeric" 
               pattern="[0-9]*"
               placeholder="6-digit code" />
        <button type="submit">Verify</button>
      </form>
    `
  },
  {
    name: 'Instagram Login',
    url: 'https://www.instagram.com/accounts/login',
    expectedFields: { hasUsername: true, hasPassword: true },
    html: `
      <form>
        <input type="text" name="username" 
               autocomplete="username" 
               placeholder="Phone number, username, or email" />
        <input type="password" name="password" 
               autocomplete="current-password" 
               placeholder="Password" />
        <button type="submit">Log In</button>
      </form>
    `
  },
  {
    name: 'LinkedIn Login',
    url: 'https://www.linkedin.com/login',
    expectedFields: { hasUsername: true, hasPassword: true },
    html: `
      <form>
        <input type="text" name="session_key" 
               autocomplete="username" 
               placeholder="Email or phone" />
        <input type="password" name="session_password" 
               autocomplete="current-password" 
               placeholder="Password" />
        <button type="submit">Sign in</button>
      </form>
    `
  }
]

describe('Autofill Quality Tests', () => {
  let container: HTMLDivElement

  beforeAll(() => {
    container = document.createElement('div')
    container.id = 'test-container'
    document.body.appendChild(container)
  })

  afterAll(() => {
    document.body.removeChild(container)
  })

  TEST_SITES.forEach((site) => {
    it(`should correctly detect fields for ${site.name}`, () => {
      container.innerHTML = site.html
      const form = container.querySelector('form')

      if (!form) {
        throw new Error(`No form found for ${site.name}`)
      }

      const fields = identifyLoginFields(form)

      if (site.expectedFields.hasUsername !== undefined) {
        const hasUsername = fields.username !== null
        expect(hasUsername).toBe(site.expectedFields.hasUsername)
      }

      if (site.expectedFields.hasPassword !== undefined) {
        const hasPassword = fields.password !== null
        expect(hasPassword).toBe(site.expectedFields.hasPassword)
      }

      if (site.expectedFields.hasEmail !== undefined) {
        const hasEmail = fields.email !== null
        expect(hasEmail).toBe(site.expectedFields.hasEmail)
      }

      if (site.expectedFields.hasTotp !== undefined) {
        const hasTotp = fields.totp !== null
        expect(hasTotp).toBe(site.expectedFields.hasTotp)
      }
    })

    it(`should identify ${site.name} authentication form correctly`, () => {
      container.innerHTML = site.html
      const form = container.querySelector('form')

      if (!form) {
        throw new Error(`No form found for ${site.name}`)
      }

      const isLogin = isLoginForm(form as HTMLFormElement)
      const hasAuthFields = site.expectedFields.hasPassword ||
        site.expectedFields.hasUsername ||
        site.expectedFields.hasEmail ||
        site.expectedFields.hasTotp

      if (site.expectedFields.hasPassword) {
        expect(isLogin).toBe(true)
      } else if (hasAuthFields) {
        expect(isLogin).toBe(false)
      }
    })
  })

  describe('Performance Benchmarks', () => {
    it('should detect fields in under 50ms', () => {
      const complexForm = TEST_SITES.map(s => s.html).join('\n')
      container.innerHTML = `
        <div>
          ${complexForm}
        </div>
      `

      const start = performance.now()
      const forms = container.querySelectorAll('form')
      forms.forEach(form => {
        identifyLoginFields(form as HTMLFormElement)
      })
      const end = performance.now()

      expect(end - start).toBeLessThan(50)
    })

    it('should fill fields in under 100ms', async () => {
      container.innerHTML = TEST_SITES[0].html

      const executor = new FillExecutor()
      const start = performance.now()

      await executor.fill({
        url: 'https://github.com/login',
        username: 'test@example.com',
        password: 'testpassword123'
      })

      const end = performance.now()
      expect(end - start).toBeLessThan(100)
    })
  })

  describe('False Positive Prevention', () => {
    it('should NOT detect login fields in a search form', () => {
      container.innerHTML = `
        <form action="/search" method="get">
          <input type="text" name="q" placeholder="Search..." />
          <button type="submit">Search</button>
        </form>
      `

      const form = container.querySelector('form') as HTMLFormElement
      const isLogin = isLoginForm(form)

      expect(isLogin).toBe(false)
    })

    it('should NOT detect login fields in a newsletter signup', () => {
      container.innerHTML = `
        <form>
          <input type="email" name="email" placeholder="Subscribe to newsletter" />
          <button type="submit">Subscribe</button>
        </form>
      `

      const form = container.querySelector('form') as HTMLFormElement
      const isLogin = isLoginForm(form)

      expect(isLogin).toBe(false)
    })

    it('should NOT detect login fields in a contact form', () => {
      container.innerHTML = `
        <form>
          <input type="text" name="name" placeholder="Your name" />
          <input type="email" name="email" placeholder="Your email" />
          <textarea name="message"></textarea>
          <button type="submit">Send</button>
        </form>
      `

      const form = container.querySelector('form') as HTMLFormElement
      const isLogin = isLoginForm(form)

      expect(isLogin).toBe(false)
    })
  })
})

export function runQualityReport(): void {
  console.log('\n=== Autofill Quality Report ===\n')

  let passed = 0
  let failed = 0

  TEST_SITES.forEach((site) => {
    const container = document.createElement('div')
    container.innerHTML = site.html
    document.body.appendChild(container)

    const form = container.querySelector('form')
    if (!form) {
      console.log(`❌ ${site.name}: No form found`)
      failed++
      document.body.removeChild(container)
      return
    }

    const fields = identifyLoginFields(form as HTMLFormElement)
    const errors: string[] = []

    if (site.expectedFields.hasUsername && !fields.username) {
      errors.push('Missing username field')
    }
    if (site.expectedFields.hasPassword && !fields.password) {
      errors.push('Missing password field')
    }
    if (site.expectedFields.hasEmail && !fields.email) {
      errors.push('Missing email field')
    }
    if (site.expectedFields.hasTotp && !fields.totp) {
      errors.push('Missing TOTP field')
    }

    if (errors.length === 0) {
      console.log(`✅ ${site.name}`)
      passed++
    } else {
      console.log(`❌ ${site.name}: ${errors.join(', ')}`)
      failed++
    }

    document.body.removeChild(container)
  })

  const successRate = (passed / TEST_SITES.length) * 100
  console.log(`\nResults: ${passed}/${TEST_SITES.length} passed (${successRate.toFixed(1)}%)`)
  console.log('================================\n')
}
