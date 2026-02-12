import { AUTOFILL_STYLES } from './autofill-styles'

const DEBUG = false

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[Peach Autofill]', ...args)
  }
}

interface DetectedField {
  usernameInput: HTMLInputElement | null
  passwordInput: HTMLInputElement
  formContainer: Element
  isSignup: boolean
}

interface CredentialEntry {
  entryId: string
  name: string
  username: string
  urls: string[]
}

interface AutofillCredentials {
  username: string
  password: string
}

let activeDropdown: HTMLElement | null = null
let activeDropdownCloseHandler: ((e: MouseEvent) => void) | null = null
let mutationObserver: MutationObserver | null = null
const detectedFields = new WeakSet<HTMLInputElement>()
const fieldIcons = new WeakMap<HTMLInputElement, HTMLElement>()

const USERNAME_PATTERNS = /user|email|login|acct|name|ident/i
const PLACEHOLDER_PATTERNS = /user|email|sign.?in|log.?in/i

function isHttpsOrLocalhost(): boolean {
  const protocol = window.location.protocol
  const hostname = window.location.hostname
  
  if (protocol === 'https:') return true
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  
  log('Page not HTTPS and not localhost - skipping autofill')
  return false
}

function isInputVisible(input: HTMLInputElement): boolean {
  if (input.type === 'hidden') return false
  if (input.hasAttribute('hidden')) return false
  if (input.getAttribute('aria-hidden') === 'true') return false
  if (input.disabled) return false
  
  const style = window.getComputedStyle(input)
  if (style.display === 'none') return false
  if (style.visibility === 'hidden') return false
  if (style.opacity === '0') return false
  
  const rect = input.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (rect.width < 8 || rect.height < 8) return false
  if (rect.left < -9000) return false
  
  const tabindex = input.getAttribute('tabindex')
  if (tabindex === '-1' && parseFloat(style.opacity) === 0) {
    return false
  }
  
  return true
}

function findUsernameInput(passwordInput: HTMLInputElement): HTMLInputElement | null {
  let container: Element | null = passwordInput.closest('form')
  
  if (!container) {
    let current: Element | null = passwordInput
    let levels = 0
    while (current && levels < 5) {
      current = current.parentElement
      if (current && (
        current.tagName === 'DIV' ||
        current.tagName === 'SECTION' ||
        current.tagName === 'FIELDSET' ||
        current.getAttribute('role') === 'form'
      )) {
        container = current
        break
      }
      levels++
    }
  }
  
  if (!container) {
    container = passwordInput.parentElement
  }
  
  if (!container) return null
  
  const inputs = Array.from(container.querySelectorAll('input'))
  const candidates = inputs.filter(input => 
    input !== passwordInput && 
    (input.type === 'text' || input.type === 'email' || input.type === 'tel')
  )
  
  for (const input of candidates) {
    const autocomplete = input.getAttribute('autocomplete')
    if (autocomplete === 'username' || autocomplete === 'email') {
      return input
    }
  }
  
  for (const input of candidates) {
    if (input.type === 'email') {
      return input
    }
  }
  
  for (const input of candidates) {
    const name = (input.name || '').toLowerCase()
    const id = (input.id || '').toLowerCase()
    if (USERNAME_PATTERNS.test(name) || USERNAME_PATTERNS.test(id)) {
      return input
    }
  }
  
  for (const input of candidates) {
    const placeholder = (input.placeholder || '').toLowerCase()
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase()
    if (PLACEHOLDER_PATTERNS.test(placeholder) || PLACEHOLDER_PATTERNS.test(ariaLabel)) {
      return input
    }
  }
  
  const passwordRect = passwordInput.getBoundingClientRect()
  let closest: HTMLInputElement | null = null
  let closestDistance = Infinity
  
  for (const input of candidates) {
    const rect = input.getBoundingClientRect()
    const distance = Math.abs(passwordRect.top - rect.top)
    if (distance < closestDistance && rect.top < passwordRect.top) {
      closestDistance = distance
      closest = input
    }
  }
  
  return closest
}

function isSignupForm(passwordInput: HTMLInputElement): boolean {
  const autocomplete = passwordInput.getAttribute('autocomplete')
  if (autocomplete === 'new-password') return true
  
  const name = (passwordInput.name || '').toLowerCase()
  const id = (passwordInput.id || '').toLowerCase()
  if (name.includes('new') || id.includes('new')) return true
  if (name.includes('confirm') || id.includes('confirm')) return false
  
  let container: Element | null = passwordInput.closest('form') as Element | null
  if (!container) {
    container = passwordInput.closest('div, section, fieldset') as Element | null
    if (!container) {
      container = passwordInput.parentElement
    }
  }
  
  if (container) {
    const passwords = container.querySelectorAll('input[type="password"]')
    if (passwords.length > 1) {
      return true
    }
  }
  
  return false
}

function detectLoginFields(): DetectedField[] {
  const results: DetectedField[] = []
  const processedContainers = new WeakSet<Element>()
  
  const passwordInputs = document.querySelectorAll('input[type="password"]:not([aria-hidden="true"])')
  log(`Found ${passwordInputs.length} password inputs`)
  
  for (const passwordInput of passwordInputs) {
    if (!(passwordInput instanceof HTMLInputElement)) continue
    if (!isInputVisible(passwordInput)) continue
    
    const usernameInput = findUsernameInput(passwordInput)
    const isSignup = isSignupForm(passwordInput)
    
    let formContainer = passwordInput.closest('form') as Element | null
    if (!formContainer) {
      let current: Element | null = passwordInput
      let levels = 0
      while (current && levels < 5) {
        current = current.parentElement
        if (current && (
          current.tagName === 'DIV' ||
          current.tagName === 'SECTION' ||
          current.tagName === 'FIELDSET'
        )) {
          formContainer = current
          break
        }
        levels++
      }
    }
    
    if (!formContainer) {
      formContainer = passwordInput.parentElement || document.body
    }
    
    if (processedContainers.has(formContainer)) continue
    processedContainers.add(formContainer)
    
    results.push({
      usernameInput,
      passwordInput,
      formContainer,
      isSignup
    })
  }
  
  log(`Detected ${results.length} login field groups`)
  return results
}

function createIconSVG(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'currentColor')
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M12 2C8.5 2 6 4.5 6 7c0 1.5.5 2.5 1.5 3.5-1 1-2.5 2.5-2.5 5v3c0 1.5 1 2.5 2.5 2.5h9c1.5 0 2.5-1 2.5-2.5v-3c0-2.5-1.5-4-2.5-5C17.5 9.5 18 8.5 18 7c0-2.5-2.5-5-6-5zm0 2c2 0 3.5 1.5 3.5 3S14 10 12 10 8.5 8.5 8.5 7s1.5-3 3.5-3z')
  
  svg.appendChild(path)
  return svg
}

function createPeachIcon(onClick: () => void): HTMLElement {
  const icon = document.createElement('div')
  icon.className = 'peach-icon'
  icon.appendChild(createIconSVG())

  icon.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })

  return icon
}

function positionIcon(icon: HTMLElement, input: HTMLInputElement): void {
  const computedStyle = window.getComputedStyle(input)
  
  let rightOffset = 10
  if (computedStyle.paddingRight) {
    rightOffset = parseInt(computedStyle.paddingRight, 10) || 10
  }
  
  icon.style.right = `${rightOffset}px`
}

function injectIcon(input: HTMLInputElement, onIconClick: () => void): void {
  if (detectedFields.has(input)) return
  if (fieldIcons.has(input)) return
  
  const icon = createPeachIcon(onIconClick)
  fieldIcons.set(input, icon)
  detectedFields.add(input)
  
  const parent = input.parentElement
  if (!parent) return
  
  const computedStyle = window.getComputedStyle(parent)
  if (computedStyle.position === 'static') {
    parent.style.position = 'relative'
  }
  
  parent.appendChild(icon)
  positionIcon(icon, input)
  
  const resizeObserver = new ResizeObserver(() => {
    positionIcon(icon, input)
  })
  resizeObserver.observe(input)
  
  const cleanup = () => {
    resizeObserver.disconnect()
    if (icon.parentElement) {
      icon.parentElement.removeChild(icon)
    }
    fieldIcons.delete(input)
  }
  
  input.addEventListener('DOMNodeRemoved', cleanup, { once: true })
}

function closeActiveDropdown(): void {
  if (activeDropdownCloseHandler) {
    document.removeEventListener('click', activeDropdownCloseHandler)
    activeDropdownCloseHandler = null
  }
  
  if (activeDropdown) {
    activeDropdown.classList.add('closing')
    setTimeout(() => {
      if (activeDropdown?.parentElement) {
        activeDropdown.parentElement.removeChild(activeDropdown)
      }
      activeDropdown = null
    }, 80)
  }
}

function createDropdownContainer(anchorElement: HTMLElement): HTMLElement {
  const host = document.createElement('div')
  host.style.cssText = 'position: fixed; z-index: 2147483647;'
  
  const shadow = host.attachShadow({ mode: 'closed' })
  
  const style = document.createElement('style')
  style.textContent = AUTOFILL_STYLES
  shadow.appendChild(style)
  
  const container = document.createElement('div')
  container.className = 'peach-dropdown'
  shadow.appendChild(container)
  
  const anchorRect = anchorElement.getBoundingClientRect()
  const dropdownWidth = 320
  
  let left = anchorRect.left
  if (left + dropdownWidth > window.innerWidth) {
    left = window.innerWidth - dropdownWidth - 16
  }
  left = Math.max(16, left)
  
  const top = anchorRect.bottom + 8 + window.scrollY
  
  host.style.left = `${left}px`
  host.style.top = `${top}px`
  
  document.body.appendChild(host)
  activeDropdown = container
  
  return container
}

function createDropdownHeader(): HTMLElement {
  const header = document.createElement('div')
  header.className = 'peach-dropdown-header'
  
  const logo = document.createElement('div')
  logo.className = 'peach-logo'
  logo.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C8.5 2 6 4.5 6 7c0 1.5.5 2.5 1.5 3.5-1 1-2.5 2.5-2.5 5v3c0 1.5 1 2.5 2.5 2.5h9c1.5 0 2.5-1 2.5-2.5v-3c0-2.5-1.5-4-2.5-5C17.5 9.5 18 8.5 18 7c0-2.5-2.5-5-6-5zm0 2c2 0 3.5 1.5 3.5 3S14 10 12 10 8.5 8.5 8.5 7s1.5-3 3.5-3z"/></svg>'
  
  const brand = document.createElement('span')
  brand.className = 'peach-brand'
  brand.textContent = 'Peach'
  
  header.appendChild(logo)
  header.appendChild(brand)
  
  return header
}

function createCredentialRow(
  entry: CredentialEntry,
  onClick: () => void
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'peach-credential-row'
  row.setAttribute('tabindex', '0')
  row.setAttribute('role', 'button')
  
  const favicon = document.createElement('div')
  favicon.className = 'peach-favicon'
  
  const hostname = entry.urls[0] ? new URL(entry.urls[0]).hostname : ''
  const initial = entry.name.charAt(0).toUpperCase()
  
  if (hostname) {
    const img = document.createElement('img')
    img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`
    img.alt = ''
    img.onerror = () => {
      img.style.display = 'none'
      const fallback = document.createElement('div')
      fallback.className = 'peach-favicon-fallback'
      fallback.textContent = initial
      favicon.appendChild(fallback)
    }
    favicon.appendChild(img)
  } else {
    const fallback = document.createElement('div')
    fallback.className = 'peach-favicon-fallback'
    fallback.textContent = initial
    favicon.appendChild(fallback)
  }
  
  const info = document.createElement('div')
  info.className = 'peach-credential-info'
  
  const name = document.createElement('div')
  name.className = 'peach-credential-name'
  name.textContent = entry.name
  
  const username = document.createElement('div')
  username.className = 'peach-credential-username'
  username.textContent = entry.username || 'No username'
  
  info.appendChild(name)
  info.appendChild(username)
  
  const arrow = document.createElement('div')
  arrow.className = 'peach-credential-arrow'
  arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>'
  
  row.appendChild(favicon)
  row.appendChild(info)
  row.appendChild(arrow)
  
  row.addEventListener('click', onClick)
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  })
  
  return row
}

function createDropdownFooter(isSignup: boolean): HTMLElement {
  const footer = document.createElement('div')
  footer.className = 'peach-dropdown-footer'
  
  const openBtn = document.createElement('button')
  openBtn.className = 'peach-btn'
  openBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg> Open Peach'
  openBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
    closeActiveDropdown()
  })
  
  footer.appendChild(openBtn)
  
  if (isSignup) {
    const genBtn = document.createElement('button')
    genBtn.className = 'peach-btn peach-btn-primary'
    genBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg> Generate Password'
    genBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP', action: 'generate' }).catch(() => {})
      closeActiveDropdown()
    })
    footer.appendChild(genBtn)
  }
  
  return footer
}

async function showAutofillDropdown(
  anchorElement: HTMLElement,
  fields: DetectedField
): Promise<void> {
  closeActiveDropdown()
  
  const container = createDropdownContainer(anchorElement)
  container.appendChild(createDropdownHeader())
  
  const body = document.createElement('div')
  body.className = 'peach-dropdown-body'
  
  const loading = document.createElement('div')
  loading.className = 'peach-loading'
  loading.textContent = 'Checking saved logins...'
  body.appendChild(loading)
  container.appendChild(body)
  
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'AUTOFILL_GET_ENTRIES',
      payload: { url: window.location.href }
    })
    
    body.innerHTML = ''
    
    if (response?.success && Array.isArray(response.entries) && response.entries.length > 0) {
      for (const entry of response.entries as CredentialEntry[]) {
        const row = createCredentialRow(entry, async () => {
          const credResponse = await chrome.runtime.sendMessage({
            type: 'AUTOFILL_FILL',
            payload: { entryId: entry.entryId }
          })
          
          if (credResponse?.success && credResponse.credentials) {
            const creds = credResponse.credentials as AutofillCredentials
            fillCredentials(fields, creds.username, creds.password)
            showSuccessFeedback(fields.passwordInput)
            chrome.runtime.sendMessage({
              type: 'MARK_AUTOFILL_USED',
              entryId: entry.entryId
            }).catch(() => {})
          }
          
          closeActiveDropdown()
        })
        body.appendChild(row)
      }
    } else {
      const empty = document.createElement('div')
      empty.className = 'peach-empty-state'
      empty.textContent = 'No saved logins for this site.'
      body.appendChild(empty)
    }
    
    container.appendChild(createDropdownFooter(fields.isSignup))
    
  } catch (error) {
    log('Error loading credentials:', error)
    body.innerHTML = ''
    const errorDiv = document.createElement('div')
    errorDiv.className = 'peach-empty-state'
    errorDiv.textContent = 'Unable to load saved logins.'
    body.appendChild(errorDiv)
    container.appendChild(createDropdownFooter(fields.isSignup))
  }
  
  activeDropdownCloseHandler = (e: MouseEvent) => {
    const target = e.target as Node
    if (!container.contains(target)) {
      closeActiveDropdown()
    }
  }
  
  setTimeout(() => {
    document.addEventListener('click', activeDropdownCloseHandler!)
  }, 0)
  
  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeActiveDropdown()
      document.removeEventListener('keydown', escapeHandler)
    }
  }
  document.addEventListener('keydown', escapeHandler)
}

function setInputValueNative(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (descriptor?.set) {
    descriptor.set.call(input, value)
  } else {
    input.value = value
  }
  
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
  
  input.dispatchEvent(new Event('focus', { bubbles: true }))
}

function fillCredentials(fields: DetectedField, username: string, password: string): void {
  log('Filling credentials', { hasUsername: !!username, hasPassword: !!password })
  
  if (fields.usernameInput && username) {
    setInputValueNative(fields.usernameInput, username)
  }
  
  if (password) {
    setInputValueNative(fields.passwordInput, password)
  }
}

function showSuccessFeedback(passwordInput: HTMLInputElement): void {
  const icon = fieldIcons.get(passwordInput)
  if (icon) {
    icon.classList.add('peach-icon-success')
    setTimeout(() => {
      icon.classList.remove('peach-icon-success')
    }, 1500)
  }
}

function processDetectedFields(): void {
  if (!isHttpsOrLocalhost()) return
  
  const fields = detectLoginFields()
  
  for (const field of fields) {
    if (field.isSignup) continue
    
    injectIcon(field.passwordInput, () => {
      const icon = fieldIcons.get(field.passwordInput)
      if (icon) {
        showAutofillDropdown(icon, field)
      }
    })
    
    if (field.usernameInput) {
      injectIcon(field.usernameInput, () => {
        const icon = fieldIcons.get(field.usernameInput!)
        if (icon) {
          showAutofillDropdown(icon, field)
        }
      })
    }
  }
}

function setupMutationObserver(): void {
  if (mutationObserver) return
  
  let debounceTimer: number | null = null
  
  const handleMutation = () => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer)
    }
    debounceTimer = window.setTimeout(() => {
      processDetectedFields()
    }, 100)
  }
  
  mutationObserver = new MutationObserver((mutations) => {
    let shouldProcess = false
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            if (node.querySelector('input[type="password"]') ||
                (node.tagName === 'INPUT' && (node as HTMLInputElement).type === 'password')) {
              shouldProcess = true
              break
            }
          }
        }
      } else if (mutation.type === 'attributes' && 
                 mutation.attributeName === 'type' &&
                 mutation.target instanceof HTMLInputElement) {
        if (mutation.target.type === 'password') {
          shouldProcess = true
        }
      }
      
      if (shouldProcess) break
    }
    
    if (shouldProcess) {
      handleMutation()
    }
  })
  
  const target = document.body || document.documentElement
  if (target) {
    mutationObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type']
    })
  }
}

function init(): void {
  log('Initializing Peach autofill')
  
  if (!isHttpsOrLocalhost()) {
    log('Not HTTPS or localhost - autofill disabled')
    return
  }
  
  processDetectedFields()
  setupMutationObserver()
  
  chrome.runtime.sendMessage({
    type: 'AUTOFILL_PAGE_LOADED',
    payload: { url: window.location.href }
  }).catch(() => {})
  
  setTimeout(() => {
    processDetectedFields()
  }, 1000)
  
  setTimeout(() => {
    processDetectedFields()
  }, 3000)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PEACH_REFRESH_AUTOFILL') {
    processDetectedFields()
    sendResponse?.({ success: true })
    return false
  }
  
  return false
})

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

export function cleanup(): void {
  if (mutationObserver) {
    mutationObserver.disconnect()
    mutationObserver = null
  }
  
  closeActiveDropdown()
  
  document.querySelectorAll('.peach-icon').forEach(icon => {
    if (icon.parentElement) {
      icon.parentElement.removeChild(icon)
    }
  })
}
