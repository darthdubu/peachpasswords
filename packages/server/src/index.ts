import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fs from "fs";
import path from "path";
import { vaultRoutes } from "./routes/vault";
import { syncRoutes } from "./routes/sync";
import { healthRoutes } from "./routes/health";
import { pairingRoutes } from "./routes/pairing";
import { CONFIG } from "./lib/config";

// SECURITY FIX (LOTUS-002): TLS is mandatory - refuse to start without valid certificates
let httpsOptions;
try {
  httpsOptions = {
    key: fs.readFileSync(path.join(CONFIG.CERTS_DIR, "server-key.pem")),
    cert: fs.readFileSync(path.join(CONFIG.CERTS_DIR, "server.pem")),
    ca: fs.readFileSync(path.join(CONFIG.CERTS_DIR, "ca.pem")),
    requestCert: true,
    rejectUnauthorized: true,
  };
} catch (e) {
  console.error("FATAL: TLS certificates not found. Server cannot start in insecure mode.");
  console.error("Please run 'scripts/generate-certs.sh' to generate certificates.");
  console.error("Alternatively, set VAULTKEY_CERTS to a directory containing:");
  console.error("  - server-key.pem (private key)");
  console.error("  - server.pem (certificate)");
  console.error("  - ca.pem (CA certificate)");
  process.exit(1);
}

const app = Fastify({
  https: httpsOptions as any,
  logger: true,
});

app.register(cors, {
  origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    const allowedOrigins = [
      /^chrome-extension:\/\/[a-z]+/,
      /^https?:\/\/localhost(:\d+)?$/,
    ];

    if (!origin || allowedOrigins.some((pattern: RegExp) => pattern.test(origin))) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
});

// Add security headers
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
});

app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] as string || req.ip;
  },
  errorResponseBuilder: (req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${context.after}`,
    retryAfter: context.after
  })
});

app.register(websocket);
app.register(vaultRoutes, { prefix: "/api" });
app.register(syncRoutes, { prefix: "/api" });
app.register(pairingRoutes, { prefix: "/api" });
app.register(healthRoutes);

app.listen({ port: CONFIG.PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Lotus server listening on ${address}`);
});
