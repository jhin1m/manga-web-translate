import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { PendingQueue } from "../pending-queue.ts";
import { diffStates } from "../rebase.ts";
import { doc } from "./fixtures.ts";

describe("pending queue (IndexedDB)", () => {
  it("survives reopening (crash) and deletes on empty ops", async () => {
    const factory = new IDBFactory();
    const local = doc(2);
    const first = local.text_boxes[0];
    if (first) first.x = 999;
    const ops = diffStates(doc(2), local);
    const q1 = new PendingQueue(factory);
    await q1.put({ pageId: "p1", baseVersion: 7, ops, updatedAt: 1 });
    q1.close();

    const q2 = new PendingQueue(factory);
    const rec = await q2.get("p1");
    expect(rec).toMatchObject({ pageId: "p1", baseVersion: 7 });
    expect(rec?.ops).toEqual(ops);
    expect(await q2.get("other")).toBeUndefined();

    await q2.put({ pageId: "p1", baseVersion: 8, ops: [], updatedAt: 2 });
    expect(await q2.get("p1")).toBeUndefined();
  });
});
