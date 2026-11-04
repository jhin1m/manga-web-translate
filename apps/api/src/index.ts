import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { closeDb } from "./db.ts";
import { env } from "./env.ts";
import { inJobTx } from "./jobs/enqueue.ts";
import { verifyProviderSecrets } from "./lib/ai-providers.ts";

const server = serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
  console.info(`api listening on http://localhost:${info.port}`);
});

// Key provider không giải mã được (đổi / mất SECRETS_KEY) → cảnh báo, không chặn khởi động.
void inJobTx(verifyProviderSecrets).catch((err) => console.error("[secrets] kiểm tra lúc khởi động lỗi", err));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => void closeDb().finally(() => process.exit(0)));
  });
}
