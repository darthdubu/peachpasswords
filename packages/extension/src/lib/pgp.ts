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
