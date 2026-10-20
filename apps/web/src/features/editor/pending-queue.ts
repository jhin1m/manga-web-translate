/**
 * Thay đổi chưa lưu của từng page trong IndexedDB (sống qua crash/đóng tab). Ghi TRƯỚC khi gửi PUT, xoá khi
 * server xác nhận; mở lại editor → còn bản ghi → đề nghị khôi phục (rebase op lên state server hiện tại).
 * Op theo id (rebase.ts) nên khôi phục được cả khi server đã lên version khác.
 */
import type { Op } from "./rebase.ts";

export type PendingRecord = {
  pageId: string;
  /** Version server mà op được tính từ đó. */
  baseVersion: number;
  ops: Op[];
  updatedAt: number;
};

const DB_NAME = "mtl-editor";
const STORE = "pending";

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export class PendingQueue {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const r = this.factory.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "pageId" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode) {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async get(pageId: string): Promise<PendingRecord | undefined> {
    return req<PendingRecord | undefined>((await this.store("readonly")).get(pageId));
  }

  /** Bản ghi của nhiều page (bỏ qua page không có), cùng 1 transaction đọc. */
  async getMany(pageIds: string[]): Promise<PendingRecord[]> {
    if (pageIds.length === 0) return [];
    const store = await this.store("readonly");
    const out = await Promise.all(pageIds.map((id) => req<PendingRecord | undefined>(store.get(id))));
    return out.filter((r): r is PendingRecord => !!r);
  }

  /** Ghi đè bản ghi của page (op luôn là diff đầy đủ base → local, không cộng dồn). Rỗng → xoá. */
  async put(rec: PendingRecord): Promise<void> {
    if (rec.ops.length === 0) return this.delete(rec.pageId);
    await req((await this.store("readwrite")).put(structuredClone(rec)));
  }

  async delete(pageId: string): Promise<void> {
    await req((await this.store("readwrite")).delete(pageId));
  }

  close() {
    void this.db?.then((d) => d.close());
    this.db = null;
  }
}
