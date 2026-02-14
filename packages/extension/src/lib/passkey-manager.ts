export interface PasskeyCredential {
  id: string
  rawId: string
  type: 'public-key'
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle?: string
    attestationObject?: string
  }
  clientExtensionResults: Record<string, unknown>
  authenticatorAttachment?: 'platform' | 'cross-platform'
}

export interface StoredPasskey {
  id: string
  rawId: string
  credentialId: string
  rpId: string
  rpName: string
  userId: string
  userName: string
  userDisplayName: string
  publicKey: string
  privateKey: string
  signCount: number
  createdAt: number
  lastUsedAt: number
  algorithm: 'ES256' | 'RS256' | 'EdDSA'
  transports: string[]
  isResidentKey: boolean
  isUserVerified: boolean
  backupEligibility: boolean
  backupState: boolean
}

export interface PasskeyCreationOptions {
  rp: {
    name: string
    id: string
  }
  user: {
    id: string
    name: string
    displayName: string
  }
  challenge: string
  pubKeyCredParams: Array<{
    type: 'public-key'
    alg: number
  }>
  timeout?: number
  excludeCredentials?: Array<{
    id: string
    type: 'public-key'
    transports?: string[]
  }>
  authenticatorSelection?: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'required' | 'preferred' | 'discouraged'
    requireResidentKey?: boolean
    userVerification?: 'required' | 'preferred' | 'discouraged'
  }
  attestation?: 'none' | 'indirect' | 'direct'
  extensions?: Record<string, unknown>
}

export interface PasskeyRequestOptions {
  challenge: string
  timeout?: number
  rpId?: string
  allowCredentials?: Array<{
    id: string
    type: 'public-key'
    transports?: string[]
  }>
  userVerification?: 'required' | 'preferred' | 'discouraged'
  extensions?: Record<string, unknown>
}

export class PasskeyManager {
  private passkeys: Map<string, StoredPasskey> = new Map()
  private isAvailable: boolean

  constructor() {
    this.isAvailable = this.checkAvailability()
  }

  private checkAvailability(): boolean {
    if (typeof window === 'undefined') return false
    return !!(
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    )
  }

  async isPlatformAuthenticatorAvailable(): Promise<boolean> {
    if (!this.isAvailable) return false
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    } catch {
      return false
    }
  }

  canUsePasskeys(): boolean {
    return this.isAvailable
  }

  async createPasskey(
    options: PasskeyCreationOptions
  ): Promise<PasskeyCredential | null> {
    if (!this.isAvailable) {
      throw new Error('WebAuthn is not available in this browser')
    }

    try {
      const publicKeyCredential = await navigator.credentials.create({
        publicKey: {
          ...options,
          challenge: this.base64ToArrayBuffer(options.challenge),
          user: {
            ...options.user,
            id: this.stringToArrayBuffer(options.user.id)
          },
          excludeCredentials: options.excludeCredentials?.map(cred => ({
            ...cred,
            id: this.base64ToArrayBuffer(cred.id)
          })) as PublicKeyCredentialDescriptor[]
        }
      })

      if (!publicKeyCredential) {
        return null
      }

      return this.credentialToPasskey(publicKeyCredential as PublicKeyCredential)
    } catch (error) {
      console.error('Error creating passkey:', error)
      throw error
    }
  }

  async getPasskey(
    options: PasskeyRequestOptions
  ): Promise<PasskeyCredential | null> {
    if (!this.isAvailable) {
      throw new Error('WebAuthn is not available in this browser')
    }

    try {
      const publicKeyCredential = await navigator.credentials.get({
        publicKey: {
          ...options,
          challenge: this.base64ToArrayBuffer(options.challenge),
          allowCredentials: options.allowCredentials?.map(cred => ({
            ...cred,
            id: this.base64ToArrayBuffer(cred.id)
          })) as PublicKeyCredentialDescriptor[]
        }
      })

      if (!publicKeyCredential) {
        return null
      }

      return this.credentialToPasskey(publicKeyCredential as PublicKeyCredential)
    } catch (error) {
      console.error('Error getting passkey:', error)
      throw error
    }
  }

  storePasskey(passkey: StoredPasskey): void {
    this.passkeys.set(passkey.id, passkey)
  }

  getPasskeyById(id: string): StoredPasskey | undefined {
    return this.passkeys.get(id)
  }

  getPasskeysForSite(rpId: string): StoredPasskey[] {
    return Array.from(this.passkeys.values()).filter(
      passkey => passkey.rpId === rpId
    )
  }

  getAllPasskeys(): StoredPasskey[] {
    return Array.from(this.passkeys.values())
  }

  deletePasskey(id: string): boolean {
    return this.passkeys.delete(id)
  }

  updatePasskeyUsage(id: string): void {
    const passkey = this.passkeys.get(id)
    if (passkey) {
      passkey.lastUsedAt = Date.now()
      passkey.signCount++
    }
  }

  private credentialToPasskey(credential: PublicKeyCredential): PasskeyCredential {
    const response = credential.response as AuthenticatorAttestationResponse | AuthenticatorAssertionResponse

    return {
      id: credential.id,
      rawId: this.arrayBufferToBase64(credential.rawId),
      type: credential.type as 'public-key',
      response: {
        clientDataJSON: this.arrayBufferToBase64(response.clientDataJSON),
        authenticatorData: 'attestationObject' in response
          ? this.arrayBufferToBase64((response as AuthenticatorAttestationResponse).attestationObject)
          : this.arrayBufferToBase64((response as AuthenticatorAssertionResponse).authenticatorData),
        signature: 'signature' in response
          ? this.arrayBufferToBase64((response as AuthenticatorAssertionResponse).signature)
          : '',
        userHandle: 'userHandle' in response && response.userHandle
          ? this.arrayBufferToBase64(response.userHandle)
          : undefined,
        attestationObject: 'attestationObject' in response
          ? this.arrayBufferToBase64((response as AuthenticatorAttestationResponse).attestationObject)
          : undefined
      },
      clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
      authenticatorAttachment: (credential as any).authenticatorAttachment
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  private stringToArrayBuffer(str: string): ArrayBuffer {
    const encoder = new TextEncoder()
    return encoder.encode(str).buffer
  }

  async isConditionalMediationAvailable(): Promise<boolean> {
    if (!this.isAvailable) return false
    try {
      return await (PublicKeyCredential as any).isConditionalMediationAvailable()
    } catch {
      return false
    }
  }

  async createWithConditionalUI(
    options: PasskeyCreationOptions
  ): Promise<PasskeyCredential | null> {
    if (!this.isAvailable) {
      throw new Error('WebAuthn is not available')
    }

    try {
      const credentialOptions = {
        publicKey: {
          ...options,
          challenge: this.base64ToArrayBuffer(options.challenge),
          user: {
            ...options.user,
            id: this.stringToArrayBuffer(options.user.id)
          },
          excludeCredentials: options.excludeCredentials?.map(cred => ({
            ...cred,
            id: this.base64ToArrayBuffer(cred.id)
          })) as PublicKeyCredentialDescriptor[]
        } as PublicKeyCredentialCreationOptions,
        mediation: 'conditional' as CredentialMediationRequirement
      } as any
      const publicKeyCredential = await navigator.credentials.create(credentialOptions)

      if (!publicKeyCredential) return null
      return this.credentialToPasskey(publicKeyCredential as PublicKeyCredential)
    } catch (error) {
      console.error('Error creating passkey with conditional UI:', error)
      throw error
    }
  }

  async getWithConditionalUI(
    options: PasskeyRequestOptions
  ): Promise<PasskeyCredential | null> {
    if (!this.isAvailable) {
      throw new Error('WebAuthn is not available')
    }

    try {
      const credentialOptions = {
        publicKey: {
          ...options,
          challenge: this.base64ToArrayBuffer(options.challenge),
          allowCredentials: options.allowCredentials?.map(cred => ({
            ...cred,
            id: this.base64ToArrayBuffer(cred.id)
          })) as PublicKeyCredentialDescriptor[]
        } as PublicKeyCredentialRequestOptions,
        mediation: 'conditional' as CredentialMediationRequirement
      } as any
      const publicKeyCredential = await navigator.credentials.get(credentialOptions)

      if (!publicKeyCredential) return null
      return this.credentialToPasskey(publicKeyCredential as PublicKeyCredential)
    } catch (error) {
      console.error('Error getting passkey with conditional UI:', error)
      throw error
    }
  }
}

export const passkeyManager = new PasskeyManager()
