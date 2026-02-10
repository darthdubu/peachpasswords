import { generatePassword, PasswordOptions } from '../lib/password-generator'

// Content script for form autofill functionality

// Detect forms on the page
function detectForms() {
  const passwordInputs = document.querySelectorAll('input[type="password"]')
  
  passwordInputs.forEach(passwordInput => {
    if (passwordInput instanceof HTMLInputElement) {
      // Check if already processed
      if (passwordInput.parentElement?.querySelector('.lotus-icon')) return

      const form = passwordInput.closest('form') || passwordInput.closest('div') || document.body
      const usernameInput = findUsernameInput(form, passwordInput)
      
      const type = isSignupField(passwordInput) ? 'signup' : 'login'
      
      if (type === 'signup') {
        addGeneratorIcon(passwordInput)
      } else {
        if (usernameInput && !usernameInput.parentElement?.querySelector('.lotus-icon')) {
          addIconToInput(usernameInput, 'username')
        }
        addIconToInput(passwordInput, 'password')
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
  const possibleInputs = container.querySelectorAll('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[name*="login"]')
  
  for (const input of possibleInputs) {
    if (input instanceof HTMLInputElement && input !== passwordInput) {
      return input
    }
  }
  return null
}

function addIconToInput(input: HTMLInputElement, type: 'username' | 'password') {
  const icon = createIcon('L', '#10b981') // Green for login
  icon.title = 'Click to fill with Lotus'
  
  setupIconContainer(input, icon)
  
  icon.addEventListener('click', (e) => {
    e.stopPropagation()
    handleAutofillClick(input, type)
  })
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

async function handleAutofillClick(input: HTMLInputElement, type: 'username' | 'password') {
  try {
    const pageUrl = window.location.origin
    const response = await chrome.runtime.sendMessage({
      type: 'REQUEST_CREDENTIALS',
      url: pageUrl
    })
    
    if (response.success && response.credentials) {
      if (type === 'username' && response.credentials.username) {
        input.value = response.credentials.username
        input.dispatchEvent(new Event('input', { bubbles: true }))
      } else if (type === 'password' && response.credentials.password) {
        input.value = response.credentials.password
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    } else {
      // No credentials found - this is expected behavior
      // TODO: Show "No credentials" tooltip
    }
  } catch (error) {
    console.error('Failed to autofill:', error)
  }
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
        url: window.location.origin,
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
