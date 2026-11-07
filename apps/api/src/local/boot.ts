/**
 * Khởi động chế độ local (chỉ process `app`, trước khi listen): tạo thư mục dữ liệu → backup DB → migrate →
 * user local → file token worker. `jobs`/`worker` chỉ chạy sau khi app healthy (/readyz) nên thấy DB đã migrate.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runMigrations } from "@mtl/db";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { backupBeforeMigrate } from "./boot-backup.ts";
import { ensureLocalUser } from "./local-user.ts";
import { ensureWorkerTokenFile } from "./worker-token-file.ts";

export const workerTokenPath = (dataDir: string) => join(dataDir, "worker", "token");

export async function bootLocal(): Promise<void> {
  const data = env.MTL_DATA_DIR;
  const backups = join(data, "backups");
  for (const d of [env.FILES_DIR, backups]) await mkdir(d, { recursive: true });
  await mkdir(join(data, "worker"), { recursive: true, mode: 0o700 });

  if (env.MTL_SKIP_BOOT_BACKUP) {
    console.warn("[boot] MTL_SKIP_BOOT_BACKUP=1 → bỏ qua backup trước migrate");
  } else {
    const b = await backupBeforeMigrate({ databaseUrl: env.DATABASE_URL, dir: backups });
    console.info(b.skipped ? "[boot] DB trống → không cần backup" : `[boot] backup ${b.file}`);
  }

  await runMigrations(env.DATABASE_URL);
  console.info("[boot] migrate xong");

  const u = await ensureLocalUser(db);
  console.info(`[boot] user local ${u.email}`);

  const t = await ensureWorkerTokenFile(db, workerTokenPath(data));
  console.info(`[boot] token worker: ${t}`);
}
