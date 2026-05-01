import type { FastifyInstance } from "fastify";
import { browse, getHome } from "../fs/browse.js";

export async function registerFsRoutes(app: FastifyInstance) {
  app.get("/api/fs/home", async () => ({ home: getHome() }));

  app.get<{ Querystring: { path?: string } }>("/api/fs/list", async (req, reply) => {
    const path = req.query.path ?? getHome();
    try {
      return await browse(path);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "browse failed";
      return reply.status(400).send({ error: message });
    }
  });
}
