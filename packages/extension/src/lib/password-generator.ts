import { logSecurityEvent } from './security-events'

export interface PasswordOptions {
  length: number
  useNumbers: boolean
  useSymbols: boolean
  useUppercase: boolean
}

export function generatePassword(options: PasswordOptions = {
  length: 16,
  useNumbers: true,
  useSymbols: true,
  useUppercase: true
}): string {
  // Log password generator usage (fire and forget)
  void logSecurityEvent('password-generator-used', 'info', {
    length: options.length,
    useNumbers: options.useNumbers,
    useSymbols: options.useSymbols,
    useUppercase: options.useUppercase
  })
  const charset = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
  }
  
  let chars = charset.lower
  if (options.useUppercase) chars += charset.upper
  if (options.useNumbers) chars += charset.numbers
  if (options.useSymbols) chars += charset.symbols
  
  let password = ''
  const array = new Uint32Array(options.length)
  
  // SECURITY FIX (LOTUS-016): Use rejection sampling to eliminate modulo bias
  // When chars.length doesn't evenly divide 2^32, some characters are slightly more likely
  const maxValid = Math.floor((2 ** 32) / chars.length) * chars.length
  
  for (let i = 0; i < options.length; i++) {
    let value
    do {
      crypto.getRandomValues(array.subarray(i, i + 1))
      value = array[i]
    } while (value >= maxValid) // Reject values in the biased range
    
    password += chars[value % chars.length]
  }
  
  return password
}
