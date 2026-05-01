import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { registerWebSocket } from "./ws.js";
import { registerFsRoutes } from "./routes/fs.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { sessionManager } from "./sessions/manager.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

await app.register(websocket);
await registerWebSocket(app);
await registerFsRoutes(app);
await registerSessionRoutes(app);
await registerInternalRoutes(app);

// Serve the built web assets if they exist. In dev, Vite serves them on a
// different port and proxies /api + /ws to this server.
if (existsSync(config.webDistDir)) {
  await app.register(fastifyStatic, {
    root: config.webDistDir,
    prefix: "/",
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
      return reply.status(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
} else {
  app.get("/", async () => ({
    ok: true,
    message:
      "ccweb server is running. Web bundle not built yet — run `pnpm -C web dev` for hot reload or `pnpm -C web build` then refresh.",
  }));
}

const close = async () => {
  sessionManager.stopAll();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

process.on("uncaughtException", (err) => {
  app.log.error({ err }, "uncaughtException — continuing");
});
process.on("unhandledRejection", (reason) => {
  app.log.error({ reason }, "unhandledRejection — continuing");
});

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`ccweb listening on http://${config.host}:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
