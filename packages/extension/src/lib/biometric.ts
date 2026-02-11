import { encrypt, decrypt, bufferToBase64, base64ToBuffer } from './crypto-utils'

export interface BiometricCredential {
  credentialId: string
  createdAt: number
  encryptedKey?: string
  prfSupported: boolean
}

const BIOMETRIC_STORAGE_KEY = 'peach_biometric_credential'

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy.buffer
}

/**
 * Derive a wrapping key from PRF (Pseudo-Random Function) output.
 * The PRF extension provides deterministic output for the same credential,
 * unlike signatures which include random challenges and counters.
 */
async function deriveWrappingKeyFromPRF(
  prfOutput: ArrayBuffer,
  salt: Uint8Array
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: new TextEncoder().encode('peach-biometric-prf-v1'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Check if the browser supports WebAuthn PRF extension.
 * PRF extension is available in Chrome 108+, Edge 108+, Opera 94+
 */
export interface BiometricSupportInfo {
  supported: boolean
  reason?: 'not-secure-context' | 'api-not-available' | 'prf-not-supported' | 'no-platform-authenticator'
  browserVersion?: string
}

export function getBiometricSupportInfo(): BiometricSupportInfo {
  if (!window.isSecureContext) {
    return { supported: false, reason: 'not-secure-context' }
  }

  if (!window.PublicKeyCredential) {
    return { supported: false, reason: 'api-not-available' }
  }

  const ua = navigator.userAgent
  const chromeMatch = ua.match(/Chrome\/(\d+)/)
  const edgeMatch = ua.match(/Edg\/(\d+)/)
  const version = chromeMatch ? parseInt(chromeMatch[1]) : edgeMatch ? parseInt(edgeMatch[1]) : 0

  if (version > 0 && version < 108) {
    return { 
      supported: false, 
      reason: 'prf-not-supported',
      browserVersion: version.toString()
    }
  }

  return { supported: true }
}

export function isPRFSupported(): boolean {
  return getBiometricSupportInfo().supported
}



export async function registerBiometric(
  _masterKey: CryptoKey,
  masterKeyRaw?: ArrayBuffer
): Promise<BiometricCredential | null> {
  try {
    const prfSupported = isPRFSupported()
    
    if (!prfSupported) {
      throw new Error('Biometric authentication requires WebAuthn PRF extension (Chrome 108+). Please use password authentication.')
    }

    // We need the raw key bytes to encrypt them
    if (!masterKeyRaw) {
      throw new Error('Raw master key bytes required for biometric registration')
    }

    const challengeBytes = crypto.getRandomValues(new Uint8Array(32))
    const wrappingSalt = crypto.getRandomValues(new Uint8Array(32))

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challengeBytes,
        rp: {
          name: 'Peach Password Manager',
          id: window.location.hostname,
        },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'peach-user',
          displayName: 'Peach User',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        attestation: 'none',
        extensions: {
          prf: {
            eval: {
              first: new Uint8Array(32).fill(1)
            }
          }
        } as any
      },
    })) as PublicKeyCredential | null

    if (!credential) return null

    const credentialId = new Uint8Array(credential.rawId)

    const extensionResults = (credential as any).getClientExtensionResults()
    let prfOutput: ArrayBuffer | undefined

    if (extensionResults?.prf?.enabled) {
      const authChallenge = crypto.getRandomValues(new Uint8Array(32))
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: authChallenge,
          allowCredentials: [
            {
              type: 'public-key',
              id: credentialId,
            },
          ],
          userVerification: 'required',
          timeout: 60000,
          extensions: {
            prf: {
              eval: {
                first: new Uint8Array(32).fill(1)
              }
            }
          } as any
        },
      })) as PublicKeyCredential | null

      if (!assertion) {
        throw new Error('Failed to authenticate immediately after registration')
      }

      const assertionExtensionResults = (assertion as any).getClientExtensionResults()
      if (assertionExtensionResults?.prf?.results?.first) {
        prfOutput = assertionExtensionResults.prf.results.first
      }
    }

    if (!prfOutput) {
      throw new Error('PRF extension not available or did not return results')
    }

    const wrappingKey = await deriveWrappingKeyFromPRF(prfOutput, wrappingSalt)

    const encryptedKeyBuffer = await encrypt(wrappingKey, masterKeyRaw.slice(0))

    const combined = new Uint8Array(wrappingSalt.length + encryptedKeyBuffer.byteLength)
    combined.set(wrappingSalt, 0)
    combined.set(new Uint8Array(encryptedKeyBuffer), wrappingSalt.length)

    const biometricCred: BiometricCredential = {
      credentialId: bufferToBase64(credentialId.buffer),
      createdAt: Date.now(),
      encryptedKey: bufferToBase64(combined.buffer),
      prfSupported: true
    }

    await chrome.storage.local.set({ [BIOMETRIC_STORAGE_KEY]: biometricCred })
    return biometricCred
  } catch (error) {
    console.error('Biometric registration error:', error)
    return null
  }
}

export async function authenticateWithBiometric(): Promise<CryptoKey | null> {
  try {
    const result = await chrome.storage.local.get(BIOMETRIC_STORAGE_KEY)
    const storedCred = result[BIOMETRIC_STORAGE_KEY] as
      | BiometricCredential
      | undefined

    if (!storedCred || !storedCred.encryptedKey) return null

    if (!storedCred.prfSupported) {
      throw new Error('Legacy biometric credential detected. Please re-register biometric authentication.')
    }

    const credentialId = new Uint8Array(base64ToBuffer(storedCred.credentialId))
    const combined = new Uint8Array(base64ToBuffer(storedCred.encryptedKey))

    const wrappingSalt = combined.slice(0, 32)
    const encryptedKey = combined.slice(32)

    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            type: 'public-key',
            id: credentialId,
          },
        ],
        userVerification: 'required',
        timeout: 60000,
        extensions: {
          prf: {
            eval: {
              first: new Uint8Array(32).fill(1)
            }
          }
        } as any
      },
    })) as PublicKeyCredential | null

    if (!assertion) return null

    const extensionResults = (assertion as any).getClientExtensionResults()
    const prfOutput = extensionResults?.prf?.results?.first

    if (!prfOutput) {
      throw new Error('PRF extension did not return results. Authentication failed.')
    }

    const wrappingKey = await deriveWrappingKeyFromPRF(prfOutput, wrappingSalt)

    const decryptedKeyBuffer = await decrypt(wrappingKey, toArrayBuffer(encryptedKey))

    return crypto.subtle.importKey(
      'raw',
      decryptedKeyBuffer,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    )
  } catch (error) {
    console.error('Biometric authentication error:', error)
    return null
  }
}

export async function hasBiometricCredential(): Promise<boolean> {
  const result = await chrome.storage.local.get(BIOMETRIC_STORAGE_KEY)
  const cred = result[BIOMETRIC_STORAGE_KEY] as BiometricCredential | undefined
  return !!(cred && cred.encryptedKey && cred.prfSupported)
}

export async function clearBiometricCredential(): Promise<void> {
  await chrome.storage.local.remove(BIOMETRIC_STORAGE_KEY)
}
