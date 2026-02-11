import { generatePassword, PasswordOptions } from '../lib/password-generator'

// Content script for form autofill functionality

// Detect forms on the page
function detectForms() {
  const passwordInputs = document.querySelectorAll('input[type="password"]')
  
  passwordInputs.forEach(passwordInput => {
    if (passwordInput instanceof HTMLInputElement) {
      const form = passwordInput.closest('form') || passwordInput.closest('div') || document.body
      
      const type = isSignupField(passwordInput) ? 'signup' : 'login'
      
      if (type === 'signup') {
        if (!passwordInput.parentElement?.querySelector('.lotus-icon')) {
          addGeneratorIcon(passwordInput)
        }
      } else {
        addPeachFormTrigger(form, passwordInput)
      }
    }
  })
}

function isSignupField(input: HTMLInputElement): boolean {
  if (input.autocomplete === 'new-password') return true
  if (input.id.includes('new') || input.name.includes('new')) return true
  if (input.id.includes('confirm') || input.name.includes('confirm')) return false // Don't add generator to confirm field
  
  const form = input.form
  if (form) {
    const passwords = form.querySelectorAll('input[type="password"]')
    // If multiple password fields, usually first is new password, second is confirm
    if (passwords.length > 1 && passwords[0] === input) return true
  }
  return false
}

function findUsernameInput(container: Element, passwordInput: HTMLInputElement): HTMLInputElement | null {
  const possibleInputs = container.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i], input[id*="login" i], input[autocomplete="username"], input[autocomplete="email"]'
  )
  
  for (const input of possibleInputs) {
    if (input instanceof HTMLInputElement && input !== passwordInput) {
      return input
    }
  }
  return null
}

function isInputVisible(input: HTMLInputElement): boolean {
  const style = window.getComputedStyle(input)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = input.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function addGeneratorIcon(input: HTMLInputElement) {
  const icon = createIcon('G', '#3b82f6') // Blue for generator
  icon.title = 'Generate Password'
  
  setupIconContainer(input, icon)
  
  icon.addEventListener('click', (e) => {
    e.stopPropagation()
    showGeneratorPopup(input, icon)
  })
}

function createIcon(text: string, color: string) {
  const icon = document.createElement('div')
  icon.className = 'lotus-icon'
  icon.style.cssText = `
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    background: ${color};
    border-radius: 50%;
    cursor: pointer;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: white;
    font-weight: bold;
    user-select: none;
  `
  icon.textContent = text
  return icon
}

function setupIconContainer(input: HTMLInputElement, icon: HTMLElement) {
  const container = input.parentElement
  if (container) {
    const originalPosition = window.getComputedStyle(container).position
    if (originalPosition === 'static') {
      container.style.position = 'relative'
    }
    container.appendChild(icon)
  }
}

function addPeachFormTrigger(formContainer: Element, passwordInput: HTMLInputElement) {
  if (!(formContainer instanceof HTMLElement)) return
  if (formContainer.querySelector('.peach-form-trigger')) return

  const icon = createIcon('P', '#f97316')
  icon.classList.add('peach-form-trigger')
  icon.title = 'Open Peach login actions'
  setupIconContainer(passwordInput, icon)

  icon.addEventListener('click', (e) => {
    e.stopPropagation()
    void showPeachFormPopup(formContainer, icon, passwordInput)
  })

  passwordInput.addEventListener('focus', () => {
    if (!activePeachPopup) {
      void showPeachFormPopup(formContainer, icon, passwordInput)
    }
  })
}

// --- Generator UI ---

function showGeneratorPopup(input: HTMLInputElement, anchor: HTMLElement) {
  // Remove existing popup
  const existing = document.getElementById('lotus-generator-popup')
  if (existing) existing.remove()

  const popup = document.createElement('div')
  popup.id = 'lotus-generator-popup'
  popup.style.cssText = `
    position: absolute;
    z-index: 10001;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    width: 240px;
    font-family: sans-serif;
    font-size: 14px;
    color: #0f172a;
  `
  
  // Position popup
  const rect = anchor.getBoundingClientRect()
  popup.style.top = `${window.scrollY + rect.bottom + 8}px`
  popup.style.left = `${window.scrollX + rect.left - 200}px`

  // State
  const options: PasswordOptions = {
    length: 16,
    useNumbers: true,
    useSymbols: true,
    useUppercase: true
  }

  const render = () => {
    const password = generatePassword(options)
    
    popup.innerHTML = `
      <div style="margin-bottom: 8px; font-weight: bold;">Generate Password</div>
      <div style="display: flex; gap: 4px; margin-bottom: 8px;">
        <input type="text" value="${password}" readonly style="flex: 1; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;">
        <button id="lotus-refresh" style="padding: 4px 8px; cursor: pointer;">↻</button>
      </div>
      <div style="margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <label>Length: <span id="lotus-len-val">${options.length}</span></label>
          <input type="range" min="8" max="32" value="${options.length}" id="lotus-len">
        </div>
        <label style="display: block;"><input type="checkbox" id="lotus-num" ${options.useNumbers ? 'checked' : ''}> Numbers</label>
        <label style="display: block;"><input type="checkbox" id="lotus-sym" ${options.useSymbols ? 'checked' : ''}> Symbols</label>
      </div>
      <button id="lotus-use" style="width: 100%; background: #3b82f6; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-weight: bold;">Use Password</button>
    `

    // Bind events
    popup.querySelector('#lotus-refresh')?.addEventListener('click', render)
    
    popup.querySelector('#lotus-len')?.addEventListener('input', (e) => {
      options.length = parseInt((e.target as HTMLInputElement).value)
      render()
    })
    
    popup.querySelector('#lotus-num')?.addEventListener('change', (e) => {
      options.useNumbers = (e.target as HTMLInputElement).checked
      render()
    })
    
    popup.querySelector('#lotus-sym')?.addEventListener('change', (e) => {
      options.useSymbols = (e.target as HTMLInputElement).checked
      render()
    })

    popup.querySelector('#lotus-use')?.addEventListener('click', () => {
      input.value = password
      input.dispatchEvent(new Event('input', { bubbles: true }))
      
      // Also fill confirm password if exists
      const form = input.form
      if (form) {
        const passwords = form.querySelectorAll('input[type="password"]')
        passwords.forEach(p => {
          if (p !== input) {
            (p as HTMLInputElement).value = password
            p.dispatchEvent(new Event('input', { bubbles: true }))
          }
        })
      }
      
      popup.remove()
    })
  }

  render()
  document.body.appendChild(popup)

  // Close on click outside
  const closeHandler = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node) && e.target !== anchor) {
      popup.remove()
      document.removeEventListener('click', closeHandler)
    }
  }
  setTimeout(() => document.addEventListener('click', closeHandler), 0)
}

// --- Autofill Logic ---

let activePeachPopup: HTMLElement | null = null
let activeCloseHandler: ((e: MouseEvent) => void) | null = null

function closeActivePeachPopup() {
  if (activePeachPopup) {
    activePeachPopup.remove()
    activePeachPopup = null
  }
  if (activeCloseHandler) {
    document.removeEventListener('click', activeCloseHandler)
    activeCloseHandler = null
  }
}

function fillLoginForm(
  container: Element,
  passwordInput: HTMLInputElement,
  username: string,
  password: string
) {
  const usernameInput = findUsernameInput(container, passwordInput)
  if (usernameInput && isInputVisible(usernameInput) && username) {
    usernameInput.value = username
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
    usernameInput.dispatchEvent(new Event('change', { bubbles: true }))
  }

  if (isInputVisible(passwordInput) && password) {
    passwordInput.value = password
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

async function showPeachFormPopup(formContainer: Element, anchor: HTMLElement, passwordInput: HTMLInputElement) {
  closeActivePeachPopup()

  const popup = document.createElement('div')
  popup.className = 'peach-form-popup'
  popup.style.cssText = `
    position: absolute;
    z-index: 10002;
    background: white;
    border: 1px solid #fed7aa;
    border-radius: 10px;
    padding: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
    min-width: 260px;
    max-width: 320px;
    font-family: sans-serif;
    font-size: 12px;
    color: #0f172a;
  `

  popup.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600;color:#ea580c;">
      <span style="width:16px;height:16px;border-radius:9999px;background:#f97316;color:white;display:inline-flex;align-items:center;justify-content:center;font-size:10px;">P</span>
      Peach
    </div>
    <div style="color:#64748b;">Checking saved logins...</div>
  `

  const formRect = (formContainer as HTMLElement).getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()
  const left = Math.max(8, Math.min(window.scrollX + anchorRect.left, window.scrollX + window.innerWidth - 340))
  popup.style.left = `${left}px`
  popup.style.top = `${window.scrollY + formRect.bottom + 8}px`

  document.body.appendChild(popup)
  activePeachPopup = popup

  const pageUrl = window.location.href
  const currentUsername = findUsernameInput(formContainer, passwordInput)?.value || ''
  const currentPassword = passwordInput.value || ''

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'REQUEST_CREDENTIALS',
      url: pageUrl
    })

    const hasCredentials = !!(response?.success && response?.credentials)
    const escapedUser = hasCredentials && response.credentials.username
      ? String(response.credentials.username)
      : ''

    popup.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600;color:#ea580c;">
        <span style="width:16px;height:16px;border-radius:9999px;background:#f97316;color:white;display:inline-flex;align-items:center;justify-content:center;font-size:10px;">P</span>
        Peach
      </div>
      ${
        hasCredentials
          ? `<button id="peach-fill-login" style="width:100%;background:#10b981;color:white;border:none;padding:8px;border-radius:8px;cursor:pointer;font-weight:600;">Fill saved login${escapedUser ? ` (${escapedUser})` : ''}</button>`
          : `<div style="color:#64748b;margin-bottom:8px;">No saved login found for this site.</div>`
      }
      <button id="peach-create-login" style="width:100%;margin-top:${hasCredentials ? '8px' : '0'};background:#f97316;color:white;border:none;padding:8px;border-radius:8px;cursor:pointer;font-weight:600;">Create new login in Peach</button>
    `

    const fillBtn = popup.querySelector('#peach-fill-login')
    if (fillBtn && hasCredentials) {
      fillBtn.addEventListener('click', () => {
        fillLoginForm(
          formContainer,
          passwordInput,
          response.credentials.username || '',
          response.credentials.password || ''
        )
        closeActivePeachPopup()
      })
    }

    const createBtn = popup.querySelector('#peach-create-login')
    createBtn?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'PROMPT_SAVE',
        data: {
          url: pageUrl,
          username: currentUsername,
          password: currentPassword
        }
      })

      await chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => undefined)
      closeActivePeachPopup()
    })
  } catch (error) {
    popup.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:600;color:#ea580c;">
        <span style="width:16px;height:16px;border-radius:9999px;background:#f97316;color:white;display:inline-flex;align-items:center;justify-content:center;font-size:10px;">P</span>
        Peach
      </div>
      <div style="color:#ef4444;margin-bottom:8px;">Unable to load login suggestions.</div>
      <button id="peach-create-login" style="width:100%;background:#f97316;color:white;border:none;padding:8px;border-radius:8px;cursor:pointer;font-weight:600;">Create new login in Peach</button>
    `
    popup.querySelector('#peach-create-login')?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'PROMPT_SAVE',
        data: {
          url: pageUrl,
          username: currentUsername,
          password: currentPassword
        }
      })
      await chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => undefined)
      closeActivePeachPopup()
    })
    console.error('Failed to load Peach form popup:', error)
  }

  activeCloseHandler = (e: MouseEvent) => {
    const target = e.target as Node
    if (!popup.contains(target) && target !== anchor) {
      closeActivePeachPopup()
    }
  }
  setTimeout(() => {
    if (activeCloseHandler) document.addEventListener('click', activeCloseHandler)
  }, 0)
}

// --- Save Prompt Logic ---

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement
  const passwordInput = form.querySelector('input[type="password"]') as HTMLInputElement
  if (!passwordInput || !passwordInput.value) return

  const usernameInput = findUsernameInput(form, passwordInput)
  const username = usernameInput ? usernameInput.value : ''
  const password = passwordInput.value

  if (password) {
    chrome.runtime.sendMessage({
      type: 'PROMPT_SAVE',
      data: {
        url: window.location.href,
        username,
        password
      }
    })
  }
})

// --- Init ---

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', detectForms)
} else {
  detectForms()
}

const observer = new MutationObserver(() => {
  detectForms()
})

observer.observe(document.body, {
  childList: true,
  subtree: true
})
