import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { closeDb } from "./db.ts";
import { env } from "./env.ts";

const server = serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
  console.info(`api listening on http://localhost:${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => void closeDb().finally(() => process.exit(0)));
  });
}
