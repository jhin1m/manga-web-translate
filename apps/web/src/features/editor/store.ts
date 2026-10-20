/**
 * Trạng thái editor (zustand). Nguồn sự thật là `doc` (PageState đang sửa); Konva chỉ render từ đây.
 * `base` + `baseVersion` = bản server đã xác nhận — save.ts diff `base → doc` để ra thay đổi chưa lưu.
 * Mọi sửa nội dung đi qua `apply(recipe)` → 1 bước undo (gộp theo key), không sửa khi read-only.
 */
import type { PageState } from "@mtl/shared";
import type { Draft } from "immer";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Layout } from "./actions.ts";
import { change, emptyHistory, type History, record, redo, undo } from "./history.ts";
import { type Conflict, restoreConflict } from "./rebase.ts";

export type Tool = "select" | "text" | "brush" | "eraser" | "ocr";
export type SaveStatus = "saved" | "dirty" | "saving" | "error";
/**
 * lock_denied: người khác giữ khoá; lock_lost: server trả 423 khi lưu; recovery: đang chờ người dùng quyết
 * khôi phục thay đổi chưa lưu của phiên trước (sửa lúc này sẽ ghi đè bản ghi đó).
 */
export type ReadOnlyReason = "lock_denied" | "lock_lost" | "loading" | "recovery" | null;

export type AiInfo = { state: PageState | null; rev: number; available: boolean };
/** Khung nhìn: toạ độ màn hình = (x, y) + toạ độ page · scale. */
export type View = { scale: number; x: number; y: number };
/** Nét mask người vẽ (toạ độ page) — không nằm trong page_state/undo, chỉ để gửi reinpaint. */
export type MaskStroke = { mode: "paint" | "erase"; size: number; points: number[] };

export type EditorState = {
  pageId: string | null;
  doc: PageState | null;
  base: PageState | null;
  baseVersion: number;
  ai: AiInfo;
  history: History;
  selection: string | null;
  tool: Tool;
  showOriginal: boolean;
  readOnly: ReadOnlyReason;
  save: { status: SaveStatus; error: string | null };
  conflicts: Conflict[];
  layout: Layout | null;
  view: View;
  /** Box đang sửa chữ bằng textarea. */
  editing: string | null;
  mask: { strokes: MaskStroke[]; size: number };
};

// biome-ignore lint/suspicious/noConfusingVoidType: cùng kiểu recipe của immer (sửa draft tại chỗ hoặc trả state mới).
type Recipe = (draft: Draft<PageState>) => void | PageState;

export type EditorActions = {
  load(p: { pageId: string; state: PageState; version: number; ai: AiInfo }): void;
  apply(recipe: Recipe, key?: string | null): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  setTool(t: Tool): void;
  setShowOriginal(v: boolean): void;
  setLayout(l: Layout | null): void;
  setReadOnly(r: ReadOnlyReason): void;
  setAi(ai: Partial<AiInfo>): void;
  setSave(status: SaveStatus, error?: string | null): void;
  /** Server xác nhận đã lưu `sent` ở `version`. */
  saved(sent: PageState, version: number): void;
  /** Sau 409/khôi phục: base = server, doc = kết quả rebase; lịch sử undo cũ (patch theo chỉ số) bị bỏ. */
  rebased(server: PageState, version: number, doc: PageState, conflicts: Conflict[]): void;
  resolveConflict(key: string, restore: boolean): void;
  setView(v: View): void;
  setEditing(id: string | null): void;
  setMask(m: Partial<EditorState["mask"]>): void;
};

export type EditorStore = ReturnType<typeof createEditorStore>;

const initial = (): EditorState => ({
  pageId: null,
  doc: null,
  base: null,
  baseVersion: 0,
  ai: { state: null, rev: 0, available: false },
  history: emptyHistory(),
  selection: null,
  tool: "select",
  showOriginal: false,
  readOnly: "loading",
  save: { status: "saved", error: null },
  conflicts: [],
  layout: null,
  view: { scale: 1, x: 0, y: 0 },
  editing: null,
  mask: { strokes: [], size: 24 },
});

export function createEditorStore() {
  return createStore<EditorState & EditorActions>()((set, get) => ({
    ...initial(),

    load: ({ pageId, state, version, ai }) =>
      set((s) => ({
        ...initial(),
        tool: s.tool,
        layout: s.layout,
        mask: { strokes: [], size: s.mask.size },
        readOnly: s.readOnly,
        pageId,
        doc: state,
        base: state,
        baseVersion: version,
        ai,
      })),

    apply: (recipe, key = null) => {
      const s = get();
      if (!s.doc || s.readOnly) return;
      const r = change(s.doc, recipe);
      if (r.patches.length === 0) return;
      const selection = s.selection && r.state.text_boxes.some((b) => b.id === s.selection) ? s.selection : null;
      set({
        doc: r.state,
        history: record(s.history, r.patches, r.inverse, key),
        selection,
        save: { status: "dirty", error: null },
      });
    },

    undo: () => {
      const s = get();
      if (!s.doc || s.readOnly) return;
      const r = undo(s.doc, s.history);
      if (r) set({ doc: r.state, history: r.history, save: { status: "dirty", error: null } });
    },

    redo: () => {
      const s = get();
      if (!s.doc || s.readOnly) return;
      const r = redo(s.doc, s.history);
      if (r) set({ doc: r.state, history: r.history, save: { status: "dirty", error: null } });
    },

    select: (selection) => set({ selection }),
    setTool: (tool) => set({ tool }),
    setShowOriginal: (showOriginal) => set({ showOriginal }),
    setLayout: (layout) => set({ layout }),
    setReadOnly: (readOnly) => set({ readOnly }),
    setAi: (ai) => set((s) => ({ ai: { ...s.ai, ...ai } })),
    setSave: (status, error = null) => set({ save: { status, error } }),

    saved: (sent, version) =>
      set((s) => ({
        base: sent,
        baseVersion: version,
        save: { status: s.doc === sent ? "saved" : "dirty", error: null },
      })),

    rebased: (server, version, doc, conflicts) =>
      set((s) => {
        const keys = new Set(conflicts.map((c) => c.key));
        return {
          base: server,
          baseVersion: version,
          doc,
          history: emptyHistory(),
          conflicts: [...s.conflicts.filter((c) => !keys.has(c.key)), ...conflicts],
          save: { status: doc === server ? "saved" : "dirty", error: null },
        };
      }),

    setView: (view) => set({ view }),
    setEditing: (editing) => set({ editing }),
    setMask: (m) => set((s) => ({ mask: { ...s.mask, ...m } })),

    resolveConflict: (key, restore) => {
      const c = get().conflicts.find((x) => x.key === key);
      if (!c) return;
      if (restore) get().apply(restoreConflict(c) as Recipe);
      set((s) => ({ conflicts: s.conflicts.filter((x) => x.key !== key) }));
    },
  }));
}

/** Store dùng chung của màn editor (1 editor mỗi tab). */
export const editorStore = createEditorStore();

export function useEditor<T>(selector: (s: EditorState & EditorActions) => T): T {
  return useStore(editorStore, selector);
}
