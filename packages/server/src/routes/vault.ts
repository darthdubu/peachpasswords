import { FastifyInstance } from "fastify";
import { verifyHMAC } from "../middleware/auth";
import { db } from "../storage/sqlite";
import { VaultRecord } from "../lib/types";

import { bus } from "../lib/events";

export async function vaultRoutes(fastify: FastifyInstance) {
  // GET /api/vault
  fastify.get("/vault", { preHandler: verifyHMAC }, async (req, reply) => {
    // ... (rest of GET handler)
    const vaultId = "default";
    
    const vault = await db.get<VaultRecord>("SELECT * FROM vaults WHERE id = ?", [vaultId]);
    if (!vault) {
      return reply.status(404).send({ error: "Vault not found" });
    }
    
    return {
      data: vault.data, 
      blob: vault.data.toString('base64'),
      version: vault.version,
      last_modified: vault.last_modified
    };
  });

  // PUT /api/vault
  fastify.put<{ Body: { blob: string; version: number } }>("/vault", { preHandler: verifyHMAC }, async (req, reply) => {
    const { blob, version } = req.body;
    const vaultId = "default";

    const currentVault = await db.get<VaultRecord>("SELECT * FROM vaults WHERE id = ?", [vaultId]);
    
    if (currentVault && currentVault.version >= version) {
      return reply.status(409).send({ 
        error: "Conflict", 
        serverVersion: currentVault.version 
      });
    }

    const buffer = Buffer.from(blob, 'base64');
    const now = Date.now();

    if (currentVault) {
      await db.run(
        "UPDATE vaults SET data = ?, version = ?, last_modified = ? WHERE id = ?",
        [buffer, version, now, vaultId]
      );
    } else {
      await db.run(
        "INSERT INTO vaults (id, data, version, last_modified) VALUES (?, ?, ?, ?)",
        [vaultId, buffer, version, now]
      );
    }

    bus.emit("vault_updated", { version });
    
    return { success: true, version };
  });


  // GET /api/vault/version
  fastify.get("/vault/version", { preHandler: verifyHMAC }, async (req, reply) => {
    const vaultId = "default";
    const vault = await db.get<VaultRecord>("SELECT version FROM vaults WHERE id = ?", [vaultId]);
    return { version: vault ? vault.version : 0 };
  });
}
