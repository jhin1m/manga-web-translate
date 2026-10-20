/**
 * Autosave: debounce 2s sau mỗi thay đổi + `flush()` khi rời trang/chuyển page. Một lượt lưu:
 *   1. ghi op chưa lưu vào IndexedDB (trước khi gửi)
 *   2. PUT state với If-Match = baseVersion
 *   3. 200 → base = bản đã gửi; IndexedDB còn đúng phần sửa sau lúc gửi (hoặc xoá)
 *      409 → tải state server, rebase op chưa lưu lên đó (xung đột liệt kê cho người dùng), lưu lại
 *      423 → mất khoá: editor chuyển read-only, op vẫn nằm trong IndexedDB
 *      lỗi mạng → báo lỗi, thử lại sau
 * Ngoài ra op được ghi IndexedDB ngay sau mỗi thay đổi (PERSIST_MS) để kill tab giữa 2 lần lưu không mất gì.
 * Các lượt lưu chạy tuần tự (single-flight).
 */
import type { PageState } from "@mtl/shared";
import type { PendingQueue } from "./pending-queue.ts";
import { diffStates, rebase } from "./rebase.ts";
import type { EditorStore } from "./store.ts";

export const SAVE_DEBOUNCE_MS = 2000;
export const PERSIST_MS = 300;
export const RETRY_MS = 5000;
const MAX_REBASE_ROUNDS = 3;

export type SaveApi = {
  put(pageId: string, state: PageState, version: number): Promise<{ version: number }>;
  get(pageId: string): Promise<{ state: PageState; version: number }>;
};

const statusOf = (e: unknown) =>
  e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 0;

export class Saver {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: EditorStore,
    private readonly api: SaveApi,
    private readonly queue: PendingQueue,
    private readonly opts = { debounceMs: SAVE_DEBOUNCE_MS, persistMs: PERSIST_MS, retryMs: RETRY_MS },
  ) {}

  /** Gọi sau mỗi thay đổi doc. */
  schedule() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist(), this.opts.persistMs);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), this.opts.debounceMs);
  }

  /** Lưu ngay (đợi lượt đang chạy). */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.chain = this.chain.then(() => this.saveOnce()).catch(() => undefined);
    return this.chain;
  }

  dispose() {
    clearTimeout(this.saveTimer);
    clearTimeout(this.persistTimer);
  }

  /** Ghi diff base → doc hiện tại vào IndexedDB (rỗng → xoá bản ghi). */
  async persist() {
    const s = this.store.getState();
    if (!s.pageId || !s.base || !s.doc) return;
    await this.queue.put({
      pageId: s.pageId,
      baseVersion: s.baseVersion,
      ops: diffStates(s.base, s.doc),
      updatedAt: Date.now(),
    });
  }

  private async saveOnce(round = 0): Promise<void> {
    const s = this.store.getState();
    if (!s.pageId || !s.doc || !s.base || s.readOnly) return;
    if (s.doc === s.base) return;
    const { pageId, baseVersion } = s;
    const sent = s.doc;
    await this.persist();
    this.store.getState().setSave("saving");
    try {
      const { version } = await this.api.put(pageId, sent, baseVersion);
      if (this.store.getState().pageId !== pageId) return;
      this.store.getState().saved(sent, version);
      await this.persist();
      if (this.store.getState().doc !== sent) this.schedule();
    } catch (e) {
      if (this.store.getState().pageId !== pageId) return;
      const status = statusOf(e);
      if (status === 409 && round < MAX_REBASE_ROUNDS) {
        const server = await this.api.get(pageId);
        const cur = this.store.getState();
        if (cur.pageId !== pageId || !cur.base || !cur.doc) return;
        // Tính op từ doc tại thời điểm này (gồm cả sửa trong lúc PUT đang bay).
        const r = rebase(server.state, diffStates(cur.base, cur.doc));
        cur.rebased(server.state, server.version, r.state, r.conflicts);
        await this.persist();
        return this.saveOnce(round + 1);
      }
      if (status === 423) {
        this.store.getState().setReadOnly("lock_lost");
        this.store.getState().setSave("error", "Mất khoá chương — thay đổi chưa lưu vẫn giữ trên máy này.");
        return;
      }
      this.store.getState().setSave("error", e instanceof Error ? e.message : String(e));
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => void this.flush(), this.opts.retryMs);
    }
  }
}
