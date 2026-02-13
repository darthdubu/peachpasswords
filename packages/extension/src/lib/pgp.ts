import * as openpgp from 'openpgp'

export interface PGPDecryptionResult {
  success: boolean
  decryptedContent?: string
  error?: string
}

export async function decryptPGPMessage(
  encryptedContent: string,
  passphrase: string
): Promise<PGPDecryptionResult> {
  try {
    const message = await openpgp.readMessage({ armoredMessage: encryptedContent })
    
    const { data: decrypted } = await openpgp.decrypt({
      message,
      passwords: [passphrase],
      format: 'binary'
    })
    
    const decoder = new TextDecoder('utf-8')
    const decryptedContent = decoder.decode(decrypted as Uint8Array)
    
    return {
      success: true,
      decryptedContent
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to decrypt PGP message'
    }
  }
}

export function isPGPEncrypted(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.includes('-----BEGIN PGP MESSAGE-----') ||
    trimmed.includes('-----BEGIN PGP SIGNED MESSAGE-----')
}

export interface PGPEncryptionResult {
  success: boolean
  encryptedContent?: string
  error?: string
}

export async function encryptPGPMessage(
  content: string,
  passphrase: string
): Promise<PGPEncryptionResult> {
  try {
    const message = await openpgp.createMessage({ text: content })

    const encrypted = await openpgp.encrypt({
      message,
      passwords: [passphrase],
      format: 'armored'
    })

    return {
      success: true,
      encryptedContent: encrypted as string
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to encrypt PGP message'
    }
  }
}
