import { FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { db } from "../storage/sqlite";
import { CONFIG } from "../lib/config";

interface AuthHeader {
  clientId: string;
  timestamp: string;
  signature: string;
}

export async function verifyHMAC(req: FastifyRequest, reply: FastifyReply) {
  // 1. Check for Simple Sync Secret (Effortless Mode)
  const secretHeader = req.headers['x-lotus-secret'];
  if (secretHeader) {
    // SECURITY FIX (LOTUS-008): Use timing-safe comparison to prevent timing attacks
    const provided = Buffer.from(secretHeader as string);
    const expected = Buffer.from(CONFIG.SYNC_SECRET);
    
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      return; // Authenticated
    }
  }

  // 2. Fallback to HMAC (Legacy / Advanced Mode)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("HMAC-SHA256 ")) {
    return reply.status(401).send({ error: "Missing or invalid Authorization header" });
  }

  const parts = authHeader.replace("HMAC-SHA256 ", "").split(":");
  if (parts.length !== 3) {
    return reply.status(401).send({ error: "Invalid Authorization format" });
  }

  const [clientId, timestamp, signature] = parts;
  
  // Prevent replay attacks (allow 5 minute window)
  const ts = parseInt(timestamp);
  const now = Date.now();
  if (isNaN(ts) || Math.abs(now - ts) > 5 * 60 * 1000) {
    return reply.status(401).send({ error: "Request expired" });
  }

  // Fetch client key hash
  const client = await db.get<{ auth_key_hash: string }>("SELECT auth_key_hash FROM clients WHERE id = ?", [clientId]);
  if (!client) {
    return reply.status(401).send({ error: "Unknown client" });
  }

  // Recompute signature
  // signature = HMAC-SHA256(auth_key, method + path + timestamp + body_hash)
  // But wait, the server doesn't know the auth_key, it only knows auth_key_hash?
  // The spec says: "The server stores a hashed version of each registered client's auth key. It can verify signatures without knowing the master password."
  // Actually, standard HMAC verification requires the server to know the secret key.
  // If the server only stores a hash of the key, it cannot compute the HMAC.
  // The spec might be implying a challenge-response or that "hashed version" means the server *stores* the key but derived from master.
  // "The server's Auth Key (derived from master key) ... The server can verify the client's identity without ever learning the master password."
  // This means the "Auth Key" IS the shared secret between client and server.
  // So the server MUST store the "Auth Key" (or a derived session key) to verify HMAC.
  // Storing "hashed version" of the auth key would imply the client sends the key, which it doesn't.
  // I will assume the server stores the `auth_key` (which is derived from master but effectively a shared secret for API auth).
  // The "hashed version" in spec might refer to how it's stored at rest if it was a password, but for HMAC key it needs to be available.
  // Or maybe it means the client authenticates by proving knowledge of the key.
  // For this implementation, I will assume `clients` table stores the actual `auth_key` (in hex/base64) that is used for HMAC.
  // To be safe, let's assume the column `auth_key_hash` actually holds the `auth_key`. I'll rename it in my mental model or just use it as the key.
  
  const authKey = client.auth_key_hash; // Treating this as the shared secret key

  // Body hash
  let bodyHash = "";
  if (req.body) {
    bodyHash = crypto.createHash("sha256").update(JSON.stringify(req.body)).digest("hex");
  }

  const message = `${req.method}${req.url}${timestamp}${bodyHash}`;
  const expectedSignature = crypto.createHmac("sha256", authKey).update(message).digest("hex");

  if (signature !== expectedSignature) {
    return reply.status(401).send({ error: "Invalid signature" });
  }
}
