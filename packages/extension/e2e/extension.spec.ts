import { test, expect, chromium, BrowserContext, Page, Worker } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function launchExtensionContext(): Promise<{ context: BrowserContext; page: Page; worker: Worker; extensionId: string }> {
  const extensionPath = path.resolve(__dirname, '..', 'dist')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peach-ext-e2e-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  })

  let worker = context.serviceWorkers()[0]
  if (!worker) {
    worker = await context.waitForEvent('serviceworker')
  }
  const extensionId = worker.url().split('/')[2]
  const page = await context.newPage()
  return { context, page, worker, extensionId }
}

async function seedAutofillSession(worker: Worker) {
  await worker.evaluate(async () => {
    function toBase64(bytes: Uint8Array): string {
      let binary = ''
      for (const b of bytes) binary += String.fromCharCode(b)
      return btoa(binary)
    }

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const jwk = await crypto.subtle.exportKey('jwk', key)

    const credentials = [
      { entryId: 'entry-primary', username: 'alice@example.com', password: 'alice-pass-123', urls: ['https://example.com/login'] },
      { entryId: 'entry-secondary', username: 'bob@example.com', password: 'bob-pass-456', urls: ['https://example.com/login'] }
    ]

    const autofillData: Array<{ entryId: string; urls: string[]; iv: string; ciphertext: string }> = []
    for (const cred of credentials) {
      const payload = new TextEncoder().encode(JSON.stringify(cred))
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload)
      const encryptedBytes = new Uint8Array(encrypted)
      autofillData.push({
        entryId: cred.entryId,
        urls: cred.urls,
        iv: toBase64(iv),
        ciphertext: toBase64(encryptedBytes)
      })
    }

    await chrome.storage.session.set({
      autofillKey: jwk,
      autofillData
    })
  })
}

test.describe('Peach extension browser verification', () => {
  test('shows multi-account chooser and fills selected login', async () => {
    const { context, page, worker } = await launchExtensionContext()
    try {
      await seedAutofillSession(worker)

      await page.goto('https://example.com')
      await page.setContent(`
        <form id="login-form">
          <input id="username" type="text" autocomplete="username" />
          <input id="password" type="password" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
      `)

      await page.waitForSelector('.peach-form-trigger', { timeout: 10000 })
      await page.click('.peach-form-trigger')
      await page.waitForSelector('.peach-form-popup')
      await expect(page.locator('.peach-credential-btn')).toHaveCount(2)

      await page.locator('.peach-credential-btn').nth(1).click()
      await expect(page.locator('#username')).toHaveValue('bob@example.com')
      await expect(page.locator('#password')).toHaveValue('bob-pass-456')
    } finally {
      await context.close()
    }
  })

  test('fill + submit submits the form', async () => {
    const { context, page, worker } = await launchExtensionContext()
    try {
      await seedAutofillSession(worker)

      await page.goto('https://example.com')
      await page.setContent(`
        <form id="login-form" onsubmit="event.preventDefault(); this.dataset.submitted='yes'">
          <input id="username" type="text" autocomplete="username" />
          <input id="password" type="password" autocomplete="current-password" />
          <button id="submit-btn" type="submit">Sign in</button>
        </form>
      `)

      await page.waitForSelector('.peach-form-trigger', { timeout: 10000 })
      await page.click('.peach-form-trigger')
      await page.waitForSelector('#peach-fill-submit')
      await page.click('#peach-fill-submit')

      await expect(page.locator('#login-form')).toHaveAttribute('data-submitted', 'yes')
      await expect(page.locator('#username')).toHaveValue('alice@example.com')
    } finally {
      await context.close()
    }
  })

  test('detects password forms inside shadow DOM', async () => {
    const { context, page } = await launchExtensionContext()
    try {
      await page.goto('https://example.com')
      await page.setContent(`
        <x-login></x-login>
        <script>
          class XLogin extends HTMLElement {
            connectedCallback() {
              const root = this.attachShadow({ mode: 'open' });
              root.innerHTML = '<form><input id="user" type="text" autocomplete="username"><input id="pass" type="password"><button type="submit">Go</button></form>';
            }
          }
          customElements.define('x-login', XLogin);
        </script>
      `)

      await expect.poll(async () => {
        return page.evaluate(() => {
          const host = document.querySelector('x-login')
          if (!host || !host.shadowRoot) return false
          return !!host.shadowRoot.querySelector('.peach-form-trigger')
        })
      }, { timeout: 10000 }).toBe(true)
    } finally {
      await context.close()
    }
  })
})
