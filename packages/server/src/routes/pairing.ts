import { FastifyInstance } from "fastify";

interface PairingSession {
  serverUrl: string;
  syncSecret: string;
  createdAt: number;
}

const pairingStore = new Map<string, PairingSession>();
const PAIRING_TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of pairingStore.entries()) {
    if (now - session.createdAt > PAIRING_TTL) {
      pairingStore.delete(token);
    }
  }
}, 60 * 1000);

export async function pairingRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { token: string }; Body: { serverUrl: string; syncSecret: string } }>("/pair/:token", async (req, reply) => {
    const { token } = req.params;
    const { serverUrl, syncSecret } = req.body;

    if (!serverUrl || !syncSecret) {
      return reply.status(400).send({ error: "Missing serverUrl or syncSecret" });
    }

    pairingStore.set(token, {
      serverUrl,
      syncSecret,
      createdAt: Date.now()
    });

    return { success: true };
  });

  fastify.get<{ Params: { token: string } }>("/pair/:token", async (req, reply) => {
    const { token } = req.params;
    const session = pairingStore.get(token);

    if (!session) {
      return reply.status(404).send({ error: "Token not found or expired" });
    }

    if (Date.now() - session.createdAt > PAIRING_TTL) {
      pairingStore.delete(token);
      return reply.status(404).send({ error: "Token expired" });
    }

    return {
      serverUrl: session.serverUrl,
      syncSecret: session.syncSecret
    };
  });
}
