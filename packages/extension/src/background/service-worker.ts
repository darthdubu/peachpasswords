import { decrypt, base64ToBuffer } from '../lib/crypto-utils'

const LOCK_ALARM_NAME = 'lotus-auto-lock'

chrome.runtime.onInstalled.addListener(() => {})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LOCK_ALARM_NAME) {
    chrome.storage.session.remove(['masterKey', 'autofillKey', 'pendingSave'])
    chrome.action.setBadgeText({ text: '' })
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCHEDULE_LOCK') {
    const delayMs = message.delayMs || (5 * 60 * 1000)
    chrome.alarms.create(LOCK_ALARM_NAME, { delayInMinutes: delayMs / 60000 })
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'CLEAR_LOCK') {
    chrome.alarms.clear(LOCK_ALARM_NAME)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'LOCK_NOW') {
    chrome.storage.session.remove(['autofillKey', 'pendingSave'])
    chrome.action.setBadgeText({ text: '' })
    chrome.alarms.clear(LOCK_ALARM_NAME)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'STORE_AUTOFILL_KEY') {
    chrome.storage.session.set({ autofillKey: message.key })
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
    const session = await chrome.storage.session.get(['autofillKey', 'autofillData'])
    if (!session.autofillKey) return { success: false, error: 'Vault locked' }

    const autofillKey = await crypto.subtle.importKey(
      'jwk',
      session.autofillKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )

    if (!session.autofillData) return { success: false, error: 'No autofill data' }

    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()

    for (const item of session.autofillData) {
      if (item.urls.some((u: string) => {
        try {
          return new URL(u).hostname.toLowerCase() === hostname
        } catch { return false }
      })) {
        const iv = base64ToBuffer(item.iv)
        const ciphertext = base64ToBuffer(item.ciphertext)
        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
        combined.set(new Uint8Array(iv), 0)
        combined.set(new Uint8Array(ciphertext), iv.byteLength)

        const decrypted = await decrypt(autofillKey, combined.buffer)
        const data = JSON.parse(new TextDecoder().decode(decrypted))

        return {
          success: true,
          credentials: {
            username: data.username,
            password: data.password
          }
        }
      }
    }

    return { success: false, error: 'No credentials found' }
  } catch (e) {
    return { success: false, error: 'Decryption failed' }
  }
}
