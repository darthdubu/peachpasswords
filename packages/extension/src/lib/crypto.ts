// Core crypto operations using Web Crypto API
import { argon2id } from 'hash-wasm';

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // 2. Run Argon2id (via WASM)
  const hash = await argon2id({
    password,
    salt,
    parallelism: 4,
    iterations: 3,
    memorySize: 65536, // 64 MiB
    hashLength: 32,
    outputType: 'binary'
  });

  // 3. Import as CryptoKey
  return crypto.subtle.importKey(
    "raw",
    hash as any,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );
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