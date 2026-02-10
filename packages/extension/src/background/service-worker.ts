import { decrypt, base64ToBuffer, deriveSubKey } from '../lib/crypto-utils'
import { Vault } from '@lotus/shared'

const LOCK_ALARM_NAME = 'lotus-auto-lock'
const LOCK_DELAY_MS = 5 * 60 * 1000 // 5 minutes

// Background service worker initialized silently

chrome.runtime.onInstalled.addListener(() => {
  // Extension installed successfully
})

// LOTUS-014: Handle auto-lock alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM_NAME) {
    // Clear all session data to lock the vault
    chrome.storage.session.remove(['masterKey', 'pendingSave'])
    chrome.action.setBadgeText({ text: '' })
  }
})

// Listen for messages to schedule or clear lock alarm
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCHEDULE_LOCK') {
    // Schedule auto-lock alarm
    chrome.alarms.create(LOCK_ALARM_NAME, { delayInMinutes: LOCK_DELAY_MS / 60000 })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CLEAR_LOCK') {
    // Clear auto-lock alarm (user is active)
    chrome.alarms.clear(LOCK_ALARM_NAME)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'LOCK_NOW') {
    // Immediate lock
    chrome.storage.session.remove(['masterKey', 'pendingSave'])
    chrome.action.setBadgeText({ text: '' })
    chrome.alarms.clear(LOCK_ALARM_NAME)
    sendResponse({ success: true })
    return true
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REQUEST_CREDENTIALS') {
    handleGetCredentials(message.url)
      .then(sendResponse)
      .catch(err => {
        console.error('Autofill error:', err)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (message.type === 'PROMPT_SAVE') {
    // Store pending save in session with timestamp
    chrome.storage.session.set({
      pendingSave: {
        ...message.data,
        _timestamp: Date.now()
      }
    })
    // Set badge to indicate action needed
    chrome.action.setBadgeText({ text: '!' })
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' })

    // LOTUS-013: Auto-clear pending save after 5 minutes
    setTimeout(() => {
      chrome.storage.session.get('pendingSave').then((result) => {
        if (result.pendingSave?._timestamp === message.data._timestamp) {
          chrome.storage.session.remove('pendingSave')
          chrome.action.setBadgeText({ text: '' })
        }
      })
    }, 5 * 60 * 1000)

    return true
  }
})

async function handleGetCredentials(url: string) {
  try {
    // 1. Get master key from session
    const session = await chrome.storage.session.get('masterKey')
    if (!session.masterKey) return { success: false, error: 'Vault locked' }
    
    const masterKey = await crypto.subtle.importKey(
      'jwk',
      session.masterKey,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    )

    // 2. Get vault
    const local = await chrome.storage.local.get('vault')
    if (!local.vault) return { success: false, error: 'No vault' }

    // 3. Decrypt vault
    const encryptedVault = new Uint8Array(local.vault)
    const vaultKey = await deriveSubKey(masterKey, 'vault-main', ['encrypt', 'decrypt'])
    const decryptedData = await decrypt(vaultKey, encryptedVault.buffer)
    const vault: Vault = JSON.parse(new TextDecoder().decode(decryptedData))

    // 4. Find matching entry
    // SECURITY FIX (LOTUS-003): Use strict hostname equality - no substring matching
    const urlObj = new URL(url)
    const hostname = urlObj.hostname

    const entry = vault.entries.find(e => {
      return e.login?.urls.some(u => {
        try {
          const entryHostname = new URL(u).hostname.toLowerCase()
          const pageHostname = hostname.toLowerCase()
          // Strict hostname equality - prevents evil-bank.com matching bank.com
          return entryHostname === pageHostname
        } catch {
          // Invalid URL stored - skip this entry
          return false
        }
      })
    })

    if (!entry || !entry.login) return { success: false, error: 'No credentials found' }

    // 5. Decrypt credentials
    const entryKey = await deriveSubKey(masterKey, `entry-${entry.id}`, ['encrypt', 'decrypt'])
    
    let password = ''
    if (entry.login.password) {
      const buffer = base64ToBuffer(entry.login.password)
      const decrypted = await decrypt(entryKey, buffer)
      password = new TextDecoder().decode(decrypted)
    }

    return {
      success: true,
      credentials: {
        username: entry.login.username,
        password: password
      }
    }
  } catch (e) {
    console.error('Handler error:', e)
    throw e
  }
}
