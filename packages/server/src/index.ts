import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import fs from "fs";
import path from "path";
import { vaultRoutes } from "./routes/vault";
import { syncRoutes } from "./routes/sync";
import { healthRoutes } from "./routes/health";
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
app.register(websocket);
app.register(vaultRoutes, { prefix: "/api" });
app.register(syncRoutes, { prefix: "/api" });
app.register(healthRoutes);

app.listen({ port: CONFIG.PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Lotus server listening on ${address}`);
});
