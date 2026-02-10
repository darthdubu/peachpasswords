// Content script for WebAuthn/passkey interception
console.log('Peach passkey content script loaded')

// Store original WebAuthn functions
const originalCreate = navigator.credentials.create
const originalGet = navigator.credentials.get

// Intercept WebAuthn credential creation
navigator.credentials.create = async (options?: CredentialCreationOptions): Promise<Credential | null> => {
  if (options?.publicKey) {
    console.log('Intercepting WebAuthn credential creation')
    
    try {
      // Send request to extension background script
      const response = await chrome.runtime.sendMessage({
        type: 'PASSKEY_CREATE',
        options: options
      })
      
      if (response?.credential) {
        console.log('Using Peach passkey')
        return response.credential
      }
    } catch (error) {
      console.error('Failed to create passkey with Peach:', error)
    }
  }

  // Fallback to original implementation
  return originalCreate.call(navigator.credentials, options)
}

// Intercept WebAuthn credential retrieval
navigator.credentials.get = async (options?: CredentialRequestOptions): Promise<Credential | null> => {
  if (options?.publicKey) {
    console.log('Intercepting WebAuthn credential retrieval')

    try {
      // Send request to extension background script
      const response = await chrome.runtime.sendMessage({
        type: 'PASSKEY_GET',
        options: options
      })

      if (response?.credential) {
        console.log('Using Peach passkey')
        return response.credential
      }
    } catch (error) {
      console.error('Failed to get passkey with Peach:', error)
    }
  }

  // Fallback to original implementation
  return originalGet.call(navigator.credentials, options)
}

console.log('WebAuthn functions intercepted by Peach')