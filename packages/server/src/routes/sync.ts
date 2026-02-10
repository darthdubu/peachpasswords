import { FastifyInstance } from "fastify";
import { bus } from "../lib/events";
import { WebSocket } from "ws";
import { CONFIG } from "../lib/config";

export async function syncRoutes(fastify: FastifyInstance) {
  fastify.get("/sync", { websocket: true }, (socket, request) => {
    let isAuthenticated = false;

    // Timeout to disconnect if no auth received
    const authTimeout = setTimeout(() => {
      if (!isAuthenticated) {
        socket.close(1008, "Auth timeout");
      }
    }, 5000);

    const onUpdate = (data: { version: number }) => {
      if (socket.readyState === WebSocket.OPEN && isAuthenticated) {
        socket.send(JSON.stringify({ type: "vault_updated", version: data.version }));
      }
    };

    bus.on("vault_updated", onUpdate);

    socket.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        
        if (msg.type === "auth") {
          if (msg.token === CONFIG.SYNC_SECRET) {
            isAuthenticated = true;
            clearTimeout(authTimeout);
            socket.send(JSON.stringify({ type: "auth_success" }));
          } else {
            socket.send(JSON.stringify({ type: "auth_failed" }));
            socket.close(1008, "Invalid token");
          }
          return;
        }

        // Ignore other messages if not authenticated
        if (!isAuthenticated) return;

        // Handle other messages if needed (e.g. ping/pong)
      } catch (e) {
        // Ignore malformed JSON
      }
    });

    socket.on("close", () => {
      bus.off("vault_updated", onUpdate);
      clearTimeout(authTimeout);
    });
  });
}
