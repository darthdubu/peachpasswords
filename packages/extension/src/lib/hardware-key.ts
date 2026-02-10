import { bufferToBase64, base64ToBuffer } from '../lib/crypto-utils'

export interface HardwareKeyCredential {
  credentialId: string
  publicKey: string
  counter: number
}

export async function registerHardwareKey(): Promise<HardwareKeyCredential | null> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'Lotus Password Manager',
          id: window.location.hostname,
        },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'lotus-user',
          displayName: 'Lotus User',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'cross-platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        attestation: 'direct',
      },
    }) as PublicKeyCredential

    if (!credential) return null

    const response = credential.response as AuthenticatorAttestationResponse

    return {
      credentialId: bufferToBase64(credential.rawId),
      publicKey: bufferToBase64(response.getPublicKey()!),
      counter: 0,
    }
  } catch (error) {
    return null
  }
}

export async function authenticateWithHardwareKey(
  credentialId: string
): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            type: 'public-key',
            id: base64ToBuffer(credentialId),
          },
        ],
        userVerification: 'required',
      },
    }) as PublicKeyCredential

    return assertion !== null
  } catch (error) {
    return false
  }
}

export async function deriveKeyFromHardwareKey(
  credentialId: string
): Promise<Uint8Array | null> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            type: 'public-key',
            id: base64ToBuffer(credentialId),
          },
        ],
        userVerification: 'required',
        extensions: {
          largeBlob: {
            support: 'required',
          },
        } as any,
      },
    }) as PublicKeyCredential

    if (!assertion) return null

    const signature = (assertion.response as AuthenticatorAssertionResponse).signature
    const hash = await crypto.subtle.digest('SHA-256', signature)
    return new Uint8Array(hash)
  } catch (error) {
    return null
  }
}
