import type { PageState } from "@mtl/shared";
import { describe, expect, it } from "vitest";
import { addBox, deleteBox, editText, moveBox, setStyle } from "../actions.ts";
import { change } from "../history.ts";
import { diffStates, rebase, restoreConflict } from "../rebase.ts";
import { box, doc, layout } from "./fixtures.ts";

const run = (s: PageState, ...recipes: Parameters<typeof change<PageState>>[1][]) =>
  recipes.reduce((acc, r) => change(acc, r).state, s);

describe("rebase pending ops onto a newer server state", () => {
  const base = doc(3);

  it("diff is id-based and empty for equal states", () => {
    expect(diffStates(base, structuredClone(base))).toEqual([]);
    const local = run(base, deleteBox("t0"), moveBox("t2", 5, 5));
    const ops = diffStates(base, local);
    expect(ops.map((o) => o.t)).toEqual(["remove", "update"]);
  });

  it("applies local edits by id even after the server reordered/removed other boxes", () => {
    const local = run(base, moveBox("t2", 500, 600), addBox(box("t9")));
    const server = run(base, deleteBox("t0"), editText("t1", "server sửa", layout));
    const r = rebase(server, diffStates(base, local));
    expect(r.conflicts).toEqual([]);
    expect(r.state.text_boxes.map((b) => b.id)).toEqual(["t1", "t2", "t9"]);
    expect(r.state.text_boxes.find((b) => b.id === "t2")).toMatchObject({ x: 500, y: 600 });
    expect(r.state.text_boxes.find((b) => b.id === "t1")?.text).toBe("server sửa");
  });

  it("merges different fields of the same box; lists same-field conflicts (no blind overwrite)", () => {
    const local = run(base, moveBox("t1", 1, 2), editText("t1", "của tôi", layout));
    const server = run(base, setStyle("t1", { fill: "#ff0000" }, layout), editText("t1", "của server", layout));
    const r = rebase(server, diffStates(base, local));
    const b = r.state.text_boxes.find((x) => x.id === "t1");
    expect(b).toMatchObject({ x: 1, y: 2, fill: "#ff0000", text: "của server" });
    const c = r.conflicts.find((x) => x.key === "text_boxes:t1");
    expect(c?.reason).toBe("changed_on_server");
    expect(c?.fields).toEqual(expect.arrayContaining(["text", "lines"]));
    // Khôi phục: chỉ field xung đột lấy bản của tôi, fill của server giữ nguyên.
    const restored = run(r.state, restoreConflict(c as NonNullable<typeof c>) as never);
    expect(restored.text_boxes.find((x) => x.id === "t1")).toMatchObject({ text: "của tôi", fill: "#ff0000", x: 1 });
  });

  it("edit of a box deleted on server → conflict; restore re-adds it", () => {
    const local = run(base, moveBox("t0", 9, 9));
    const server = run(base, deleteBox("t0"));
    const r = rebase(server, diffStates(base, local));
    expect(r.state.text_boxes.find((b) => b.id === "t0")).toBeUndefined();
    expect(r.conflicts[0]).toMatchObject({ key: "text_boxes:t0", reason: "deleted_on_server" });
    const restored = run(r.state, restoreConflict(r.conflicts[0] as never) as never);
    expect(restored.text_boxes.find((b) => b.id === "t0")).toMatchObject({ x: 9, y: 9 });
  });

  it("delete of a box the server changed → conflict, server box kept", () => {
    const local = run(base, deleteBox("t1"));
    const server = run(base, moveBox("t1", 70, 70));
    const r = rebase(server, diffStates(base, local));
    expect(r.state.text_boxes.find((b) => b.id === "t1")).toMatchObject({ x: 70 });
    expect(r.conflicts[0]?.reason).toBe("removed_but_changed");
  });

  // Tìm/Thay phía server đổi `text` và để `lines: []`; gốc cũng `lines: []` (box AI chưa qua editor) nên `lines` của server
  // "không đổi" — không được lấy `lines` của mình ghép với `text` của server.
  const serverReplace = (s: PageState, id: string, text: string) => {
    const next = structuredClone(s);
    const b = next.text_boxes.find((x) => x.id === id) as (typeof next.text_boxes)[number];
    b.text = text;
    b.lines = [];
    return next;
  };
  const unlaid = (s: PageState) => ({ ...s, text_boxes: s.text_boxes.map((b) => ({ ...b, lines: [] })) });

  it("keeps the server's lines when the server's text wins a text conflict", () => {
    const fresh = unlaid(base);
    const local = run(fresh, editText("t1", "của tôi", layout));
    expect(local.text_boxes[1]?.lines.length).toBeGreaterThan(0);
    const r = rebase(serverReplace(fresh, "t1", "của server"), diffStates(fresh, local));
    expect(r.state.text_boxes[1]).toMatchObject({ text: "của server", lines: [] });
    expect(r.conflicts.map((c) => c.key)).toContain("text_boxes:t1");
  });

  it("drops stale lines when my style change meets the server's text change", () => {
    const fresh = unlaid(base);
    const local = run(fresh, setStyle("t1", { font_size: 40 }, layout));
    const r = rebase(serverReplace(fresh, "t1", "của server"), diffStates(fresh, local));
    expect(r.conflicts).toEqual([]);
    expect(r.state.text_boxes[1]).toMatchObject({ text: "của server", font_size: 40, lines: [] });
  });

  it("keeps the server's lines when I only moved the box", () => {
    const local = run(base, moveBox("t1", 7, 7));
    const server = run(base, editText("t1", "server sửa", layout));
    const r = rebase(server, diffStates(base, local));
    expect(r.state.text_boxes[1]).toMatchObject({ x: 7, text: "server sửa", lines: server.text_boxes[1]?.lines });
  });

  it("restoring my text brings my lines back with it", () => {
    const fresh = unlaid(base);
    const local = run(fresh, editText("t1", "của tôi", layout));
    const r = rebase(serverReplace(fresh, "t1", "của server"), diffStates(fresh, local));
    const c = r.conflicts.find((x) => x.key === "text_boxes:t1") as NonNullable<(typeof r.conflicts)[number]>;
    const restored = run(r.state, restoreConflict(c) as never);
    expect(restored.text_boxes[1]).toEqual(local.text_boxes[1]);
  });

  it("is idempotent when the server already has my change", () => {
    const local = run(base, moveBox("t1", 3, 3));
    const r = rebase(local, diffStates(base, local));
    expect(r.conflicts).toEqual([]);
    expect(r.state).toEqual(local);
  });
});
