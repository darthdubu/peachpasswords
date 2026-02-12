import { chromium } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function seedAutofillSession(worker) {
  await worker.evaluate(async () => {
    function toBase64(bytes) {
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

    const autofillData = []
    for (const cred of credentials) {
      const payload = new TextEncoder().encode(JSON.stringify(cred))
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload)
      autofillData.push({
        entryId: cred.entryId,
        urls: cred.urls,
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(encrypted))
      })
    }

    await chrome.storage.session.set({ autofillKey: jwk, autofillData })
  })
}

async function main() {
  const extensionPath = path.resolve(__dirname, '..', 'dist')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peach-ext-verify-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  })

  try {
    let worker = context.serviceWorkers()[0]
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 })
    await seedAutofillSession(worker)

    const page = await context.newPage()
    await page.goto('https://example.com')
    await page.setContent(`
      <form id="login-form" onsubmit="event.preventDefault(); this.dataset.submitted='yes'">
        <input id="username" type="text" autocomplete="username" />
        <input id="password" type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    `)

    await page.waitForSelector('.peach-form-trigger', { timeout: 10000 })
    await page.click('.peach-form-trigger')
    await page.waitForSelector('.peach-form-popup')
    const chooserCount = await page.locator('.peach-credential-btn').count()
    assert(chooserCount === 2, `Expected 2 account options, got ${chooserCount}`)

    await page.locator('.peach-credential-btn').nth(1).click()
    assert((await page.locator('#username').inputValue()) === 'bob@example.com', 'Expected chooser to fill secondary username')
    assert((await page.locator('#password').inputValue()) === 'bob-pass-456', 'Expected chooser to fill secondary password')

    await page.click('.peach-form-trigger')
    await page.waitForSelector('#peach-fill-submit')
    await page.click('#peach-fill-submit')
    assert((await page.locator('#login-form').getAttribute('data-submitted')) === 'yes', 'Expected fill+submit to submit the form')
    assert((await page.locator('#username').inputValue()) === 'alice@example.com', 'Expected fill+submit to use top match')

    await page.setContent(`
      <x-login></x-login>
      <script>
        class XLogin extends HTMLElement {
          connectedCallback() {
            const root = this.attachShadow({ mode: 'open' });
            root.innerHTML = '<form><input id="user" type="text"><input id="pass" type="password"><button type="submit">Go</button></form>';
          }
        }
        customElements.define('x-login', XLogin);
      </script>
    `)
    const shadowDetected = await page.waitForFunction(() => {
      const host = document.querySelector('x-login')
      return !!host && !!host.shadowRoot && !!host.shadowRoot.querySelector('.peach-form-trigger')
    }, null, { timeout: 10000 })
    assert(!!shadowDetected, 'Expected Peach trigger inside shadow DOM form')

    console.log('PASS: multi-account chooser, fill+submit, and shadow DOM detection verified.')
  } finally {
    await Promise.race([
      context.close(),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ])
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
