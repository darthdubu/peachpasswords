// Core crypto operations using Web Crypto API
import { argon2id } from 'hash-wasm';

export interface DerivedKeyResult {
  key: CryptoKey;
  rawBytes: Uint8Array;
}

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const result = await deriveKeyFromPasswordWithRaw(password, salt);
  return result.key;
}

export async function deriveKeyFromPasswordWithRaw(
  password: string,
  salt: Uint8Array
): Promise<DerivedKeyResult> {
  // Run Argon2id (via WASM)
  const hash = await argon2id({
    password,
    salt,
    parallelism: 4,
    iterations: 3,
    memorySize: 65536, // 64 MiB
    hashLength: 32,
    outputType: 'binary'
  });

  // Keep a copy of the raw bytes before importing
  const rawBytes = new Uint8Array(hash as Uint8Array);

  // Import as CryptoKey
  const key = await crypto.subtle.importKey(
    "raw",
    rawBytes,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  return { key, rawBytes };
}

export async function deriveSubKey(
  masterKey: CryptoKey,
  info: string,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32), // Empty salt (Argon2 already salted)
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
  const algorithm: AesGcmParams = { name: "AES-GCM", iv };
  if (aad) {
    algorithm.additionalData = aad;
  }
  
  const ciphertext = await crypto.subtle.encrypt(
    algorithm,
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
  
  const algorithm: AesGcmParams = { name: "AES-GCM", iv };
  if (aad) {
    algorithm.additionalData = aad;
  }

  return crypto.subtle.decrypt(
    algorithm,
    key,
    ciphertext
  );
}