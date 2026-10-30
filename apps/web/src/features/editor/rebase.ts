/**
 * Thay đổi chưa lưu dạng op theo id (không theo chỉ số mảng như immer patch — chỉ số lệch ngay khi server
 * thêm/xoá box). `diffStates(base, local)` sinh op; `rebase(server, ops)` áp lại op lên state mới của server
 * khi PUT bị 409 hoặc khi khôi phục sau crash.
 *
 * Luật (không ghi đè mù): field server vẫn giữ giá trị gốc (hoặc đã trùng giá trị của mình) → áp; server đã đổi
 * field đó sang giá trị khác → xung đột, giữ bản server. Box/region mình sửa mà server đã xoá → xung đột.
 * Xoá box mà server đã sửa → xung đột. Người dùng chọn "khôi phục bản của tôi" hoặc "bỏ" cho từng xung đột.
 */
import type { PageState, Region, TextBox } from "@mtl/shared";

export type Coll = "regions" | "text_boxes";
type Entity = Region | TextBox;
type Field = { from: unknown; to: unknown };

export type Op =
  | { t: "update"; coll: Coll; id: string; fields: Record<string, Field>; local: Entity }
  | { t: "add"; coll: Coll; entity: Entity }
  | { t: "remove"; coll: Coll; id: string; from: Entity }
  | { t: "root"; field: "view" | "meta"; from: unknown; to: unknown };

export type Conflict = {
  /** Khoá ổn định để UI liệt kê/xử lý. */
  key: string;
  reason: "deleted_on_server" | "changed_on_server" | "removed_but_changed" | "id_exists";
  op: Op;
  /** Field xung đột (reason changed_on_server). */
  fields?: string[];
};

const COLLS: Coll[] = ["regions", "text_boxes"];

/** So sánh JSON sâu (state là JSON thuần). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as never)[k], (b as never)[k]));
}

const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));

export function diffStates(base: PageState, local: PageState): Op[] {
  const ops: Op[] = [];
  for (const coll of COLLS) {
    const b = byId<Entity>(base[coll]);
    const l = byId<Entity>(local[coll]);
    for (const [id, from] of b) if (!l.has(id)) ops.push({ t: "remove", coll, id, from });
    for (const ent of local[coll] as Entity[]) {
      const prev = b.get(ent.id);
      if (!prev) {
        ops.push({ t: "add", coll, entity: ent });
        continue;
      }
      const fields: Record<string, Field> = {};
      const keys = new Set([...Object.keys(prev), ...Object.keys(ent)]);
      for (const k of keys) {
        const from = (prev as Record<string, unknown>)[k];
        const to = (ent as Record<string, unknown>)[k];
        if (!same(from, to)) fields[k] = { from, to };
      }
      if (Object.keys(fields).length) ops.push({ t: "update", coll, id: ent.id, fields, local: ent });
    }
  }
  for (const field of ["view", "meta"] as const) {
    if (!same(base[field], local[field])) ops.push({ t: "root", field, from: base[field], to: local[field] });
  }
  return ops;
}

const keyOf = (op: Op) =>
  op.t === "root" ? `root:${op.field}` : `${op.coll}:${op.t === "add" ? op.entity.id : op.id}`;

/** Field quyết định ngắt dòng (đầu vào `layoutBox`); x/y/màu/viền không đổi `lines`. */
const LINE_INPUTS = ["text", "w", "h", "font_family", "font_size", "line_height", "pad", "letter_spacing", "auto_fit"];
const sameLineInputs = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  LINE_INPUTS.every((k) => same(a[k], b[k]));

/**
 * `lines` là ngắt dòng suy ra từ text + kiểu của chính box (hợp đồng layout mục 5), không gộp riêng từng field được:
 * box gộp (vd text của server + font của mình) mà giữ `lines` của một bên thì canvas/export vẽ chữ khác `text`.
 * Giữ `lines` của bên mà box gộp trùng mọi đầu vào ngắt dòng; lẫn cả hai → `[]` để renderer ngắt lại.
 */
function syncLines(cur: Record<string, unknown>, local: Entity, server: Record<string, unknown>) {
  const mine = local as unknown as Record<string, unknown>;
  if (sameLineInputs(cur, mine)) cur.lines = [...(mine.lines as string[])];
  else if (sameLineInputs(cur, server)) cur.lines = [...(server.lines as string[])];
  else cur.lines = [];
}

type Mutable = { regions: Entity[]; text_boxes: Entity[] } & Omit<PageState, "regions" | "text_boxes">;

/** Áp op lên bản sao `server`; trả state mới + danh sách xung đột (không đoán khi id không còn). */
export function rebase(server: PageState, ops: readonly Op[]): { state: PageState; conflicts: Conflict[] } {
  const s = structuredClone(server) as unknown as Mutable;
  const conflicts: Conflict[] = [];
  for (const op of ops) {
    if (op.t === "root") {
      if (same(s[op.field], op.from) || same(s[op.field], op.to)) (s as Record<string, unknown>)[op.field] = op.to;
      else conflicts.push({ key: keyOf(op), reason: "changed_on_server", op, fields: [op.field] });
      continue;
    }
    const list = s[op.coll];
    if (op.t === "add") {
      const cur = list.find((e) => e.id === op.entity.id);
      if (!cur) list.push(structuredClone(op.entity));
      else if (!same(cur, op.entity)) conflicts.push({ key: keyOf(op), reason: "id_exists", op });
      continue;
    }
    const i = list.findIndex((e) => e.id === op.id);
    if (op.t === "remove") {
      if (i < 0) continue;
      if (same(list[i], op.from)) list.splice(i, 1);
      else conflicts.push({ key: keyOf(op), reason: "removed_but_changed", op });
      continue;
    }
    if (i < 0) {
      conflicts.push({ key: keyOf(op), reason: "deleted_on_server", op });
      continue;
    }
    const cur = list[i] as Record<string, unknown>;
    const serverEnt = structuredClone(cur);
    const clashed: string[] = [];
    for (const [k, f] of Object.entries(op.fields)) {
      if (same(cur[k], f.from) || same(cur[k], f.to)) cur[k] = structuredClone(f.to);
      else clashed.push(k);
    }
    if (op.coll === "text_boxes") syncLines(cur, op.local, serverEnt);
    if (clashed.length) conflicts.push({ key: keyOf(op), reason: "changed_on_server", op, fields: clashed });
  }
  return { state: s as unknown as PageState, conflicts };
}

/**
 * "Khôi phục bản của tôi" cho 1 xung đột (người dùng đã xem và chọn) — áp bản local lên state hiện tại.
 * Dùng như recipe immer (đi qua undo + save như thao tác thường).
 */
export function restoreConflict(c: Conflict) {
  return (s: PageState) => {
    const m = s as unknown as Mutable;
    const op = c.op;
    if (op.t === "root") {
      (m as Record<string, unknown>)[op.field] = structuredClone(op.to);
      return;
    }
    const list = m[op.coll];
    if (op.t === "remove") {
      const i = list.findIndex((e) => e.id === op.id);
      if (i >= 0) list.splice(i, 1);
      return;
    }
    const ent = op.t === "add" ? op.entity : op.local;
    const i = list.findIndex((e) => e.id === ent.id);
    // Chỉ field xung đột — field server đổi mà mình không đụng đã được giữ ở bước rebase.
    if (op.t === "update" && i >= 0) {
      const cur = list[i] as Record<string, unknown>;
      const before = JSON.parse(JSON.stringify(cur)) as Record<string, unknown>; // draft immer: không structuredClone được
      for (const k of c.fields ?? Object.keys(op.fields)) cur[k] = structuredClone(op.fields[k]?.to);
      if (op.coll === "text_boxes") syncLines(cur, op.local, before);
      return;
    }
    if (i >= 0) list[i] = structuredClone(ent);
    else list.push(structuredClone(ent));
  };
}
