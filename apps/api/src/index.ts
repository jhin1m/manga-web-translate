import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { closeDb } from "./db.ts";
import { env } from "./env.ts";
import { inJobTx } from "./jobs/enqueue.ts";
import { verifyProviderSecrets } from "./lib/ai-providers.ts";
import { bootLocal } from "./local/boot.ts";

async function main() {
  // Chế độ local: backup + migrate + user local + token worker TRƯỚC khi nhận request (healthcheck chờ cổng mở).
  if (env.MTL_LOCAL_MODE) await bootLocal();

  const server = serve({ fetch: createApp().fetch, port: env.API_PORT }, (info) => {
    console.info(`api listening on http://localhost:${info.port}${env.MTL_LOCAL_MODE ? " (local mode)" : ""}`);
  });

  // Key provider không giải mã được (đổi / mất SECRETS_KEY) → cảnh báo, không chặn khởi động.
  void inJobTx(verifyProviderSecrets).catch((err) => console.error("[secrets] kiểm tra lúc khởi động lỗi", err));

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      server.close(() => void closeDb().finally(() => process.exit(0)));
    });
  }
}

main().catch((err) => {
  console.error("[boot] khởi động lỗi", err);
  void closeDb().finally(() => process.exit(1));
});
