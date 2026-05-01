import type { FastifyInstance } from "fastify";
import { metadataStore } from "../store/metadata.js";

export async function registerSessionRoutes(app: FastifyInstance) {
  app.get("/api/sessions", async () => ({ sessions: metadataStore.list() }));

  app.patch<{
    Params: { id: string };
    Body: { title?: string };
  }>("/api/sessions/:id", async (req, reply) => {
    const body = req.body ?? {};
    if (typeof body.title === "string" && body.title.length > 0) {
      metadataStore.rename(req.params.id, body.title);
    }
    const updated = metadataStore.get(req.params.id);
    if (!updated) return reply.status(404).send({ error: "not found" });
    return { session: updated };
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    metadataStore.remove(req.params.id);
    return { ok: true };
  });
}
