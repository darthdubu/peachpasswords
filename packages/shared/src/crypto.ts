// Core crypto operations using Web Crypto API
// SECURITY FIX (LOTUS-011): Standardize on hash-wasm (actively maintained)
import { argon2id } from 'hash-wasm';

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Run Argon2id (via WASM)
  const hash = await argon2id({
    password,
    salt,
    parallelism: 4,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: 'binary'
  });

  // Import as CryptoKey
  return crypto.subtle.importKey(
    "raw",
    hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );
}

export async function deriveSubKey(
  masterKey: CryptoKey,
  info: string,
  usage: KeyUsage[],
  salt?: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const saltBuffer: ArrayBuffer = salt ?
    salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer :
    new Uint8Array(32).buffer;
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBuffer,
      info: encoder.encode(info),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

export async function encrypt(
  key: CryptoKey,
  data: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    data
  );
  // Prepend IV to ciphertext
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result.buffer;
}

export async function decrypt(
  key: CryptoKey,
  data: ArrayBuffer,
  aad?: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = new Uint8Array(data, 0, 12);
  const ciphertext = new Uint8Array(data, 12);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    ciphertext
  );
}
