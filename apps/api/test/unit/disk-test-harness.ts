/** Disk driver + route `/files` trong bộ nhớ (Hono `app.request`, không mở cổng, không env/DB). */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createFilesRoutes } from "../../src/routes/files.ts";
import { createDiskDriver, type DiskDriver } from "../../src/storage-drivers/disk-driver.ts";
import { deriveFilesKey } from "../../src/storage-drivers/file-signing.ts";

export type DiskHarness = {
  driver: DiskDriver;
  root: string;
  /** Tua đồng hồ của driver. */
  advance: (ms: number) => void;
  fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  /** Gửi nguyên request (không tự thêm Content-Length). */
  rawRequest: (url: string, init?: RequestInit) => Promise<Response>;
};

export async function createDiskHarness(): Promise<DiskHarness> {
  const root = await mkdtemp(join(tmpdir(), "mtl-disk-"));
  let offset = 0;
  const driver = createDiskDriver({
    root,
    signingKey: deriveFilesKey("x".repeat(32)),
    now: () => Date.now() + offset,
  });
  const app = new Hono().route("/files", createFilesRoutes(driver));

  /** Như client HTTP thật: body tuần tự hoá trước để có Content-Length (Request với FormData không tự đặt). */
  async function fetcher(url: string, init: RequestInit = {}): Promise<Response> {
    const req = new Request(new URL(url, "http://local"), init);
    if (req.body === null) return app.request(req);
    const body = new Uint8Array(await req.arrayBuffer());
    const headers = new Headers(req.headers);
    headers.set("content-length", String(body.byteLength));
    return app.request(new Request(req.url, { method: req.method, headers, body }));
  }

  const rawRequest = async (url: string, init?: RequestInit) =>
    app.request(new Request(new URL(url, "http://local"), init));

  return { driver, root, advance: (ms) => (offset += ms), fetcher, rawRequest };
}
