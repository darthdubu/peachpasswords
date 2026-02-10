import { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => {
    return { status: "ok", version: "1.0.0" };
  });
}
