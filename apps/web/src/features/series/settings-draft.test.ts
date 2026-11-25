import { describe, expect, it } from "vitest";
import type { Series } from "./api.ts";
import {
  adoptServer,
  type Draft,
  type DraftState,
  draftValues,
  fieldInvalid,
  isDirty,
  ruleComplete,
  toDraft,
} from "./settings-draft.ts";

const rule = (over: Partial<{ speaker: string; listener: string; address: string }> = {}) => ({
  speaker: "Minjun",
  listener: "Seoyeon",
  address: "anh/em",
  note: "",
  ...over,
});

const series = (over: Partial<Series> = {}): Series => ({
  id: "s1",
  title: "Series",
  source_lang: "ko",
  target_lang: "vi",
  page_format: "strip",
  honorific_policy: "translate",
  pronoun_rules: [{ ...rule(), origin: "user" }],
  style_prompt: "",
  style_origin: null,
  default_fonts: {},
  ignore_text: ["discord.gg/x"],
  glossary_rev: 0,
  settings_rev: 0,
  cover_custom: false,
  created_at: "",
  updated_at: "",
  ...over,
});

const state = (d: Draft, base: Draft = d): DraftState => ({ draft: d, base });
const never = () => false;

describe("ruleComplete", () => {
  it("needs speaker, listener and address (note is optional, blanks count as empty)", () => {
    expect(ruleComplete(rule())).toBe(true);
    expect(ruleComplete(rule({ listener: "  " }))).toBe(false);
    expect(ruleComplete(rule({ speaker: "" }))).toBe(false);
    expect(ruleComplete(rule({ address: "" }))).toBe(false);
  });
});

describe("draft values", () => {
  it("keeps the ignored text as typed and compares it as a list", () => {
    const d = toDraft(series({ ignore_text: ["a.com", "Nhóm Mèo"] }));
    expect(d.ignore_text).toBe("a.com\nNhóm Mèo");
    const typing = { ...d, ignore_text: "a.com\n\nNhóm Mèo\n" };
    expect(draftValues(typing).ignore_text).toEqual(["a.com", "Nhóm Mèo"]);
    expect(isDirty(state(typing, d), "ignore_text")).toBe(false);
    expect(isDirty(state({ ...d, ignore_text: "a.com" }, d), "ignore_text")).toBe(true);
  });

  it("does not count a dropped AI tag as a change", () => {
    const d = toDraft(series({ pronoun_rules: [{ ...rule(), origin: "ai" }] }));
    const touched = { ...d, pronoun_rules: [{ ...rule(), origin: "user" as const }] };
    expect(isDirty(state(touched, d), "pronoun_rules")).toBe(false);
  });

  it("blocks saving an empty title and a bad ignore line, but never the pronoun rules", () => {
    const d = toDraft(series());
    expect(fieldInvalid(d, "title")).toBe(false);
    expect(fieldInvalid({ ...d, title: "  " }, "title")).toBe(true);
    expect(fieldInvalid({ ...d, ignore_text: "discord.gg/x\nab" }, "ignore_text")).toBe(true);
    expect(fieldInvalid({ ...d, pronoun_rules: [rule({ address: "" })] }, "pronoun_rules")).toBe(false);
    expect(fieldInvalid({ ...d, style_prompt: "" }, "style_prompt")).toBe(false);
  });

  it("saves only complete pronoun rows; an incomplete row alone is not a change", () => {
    const d = toDraft(series());
    const added = { ...d, pronoun_rules: [...d.pronoun_rules, { ...rule({ listener: "" }), origin: "user" as const }] };
    expect(draftValues(added).pronoun_rules).toEqual(d.pronoun_rules);
    expect(isDirty(state(added, d), "pronoun_rules")).toBe(false);
    // Xoá hàng đủ trong khi còn hàng thiếu → vẫn là thay đổi cần lưu (danh sách rỗng).
    const removed = { ...d, pronoun_rules: added.pronoun_rules.slice(1) };
    expect(draftValues(removed).pronoun_rules).toEqual([]);
    expect(isDirty(state(removed, d), "pronoun_rules")).toBe(true);
  });
});

describe("adoptServer", () => {
  it("returns the same state when the server has nothing new", () => {
    const st = state(toDraft(series()));
    expect(adoptServer(st, toDraft(series()), never)).toBe(st);
  });

  it("shows what AI wrote in fields the user is not editing", () => {
    const st = state(toDraft(series()));
    const ai = toDraft(
      series({
        style_prompt: "Giọng trẻ",
        style_origin: "ai",
        pronoun_rules: [
          { ...rule(), origin: "user" },
          { ...rule({ speaker: "Seoyeon", listener: "Minjun", address: "em/anh" }), origin: "ai" },
        ],
      }),
    );
    const next = adoptServer(st, ai, never);
    expect(next.draft.style_prompt).toBe("Giọng trẻ");
    expect(next.draft.pronoun_rules).toHaveLength(2);
    // Mốc theo bản đã nhận → lần lưu sau coi cả cặp AI là "đã thấy".
    expect(next.base.pronoun_rules).toHaveLength(2);
  });

  it("keeps the draft and the seen pairs of a field being edited", () => {
    const d = toDraft(series());
    const edited = { ...d, pronoun_rules: [{ ...rule({ address: "tớ/cậu" }), origin: "user" as const }] };
    const ai = toDraft(
      series({
        style_prompt: "Giọng trẻ",
        pronoun_rules: [
          { ...rule(), origin: "user" },
          { ...rule({ speaker: "Seoyeon", listener: "Minjun" }), origin: "ai" },
        ],
      }),
    );
    const next = adoptServer(state(edited, d), ai, never);
    expect(next.draft.pronoun_rules).toEqual(edited.pronoun_rules);
    expect(next.base.pronoun_rules).toEqual(d.pronoun_rules);
    // Trường khác vẫn nhận bản server.
    expect(next.draft.style_prompt).toBe("Giọng trẻ");
  });

  it("skips held fields (being typed in or waiting to save) even when unchanged", () => {
    const st = state(toDraft(series()));
    const next = adoptServer(st, toDraft(series({ title: "Tên khác", style_prompt: "x" })), (k) => k === "title");
    expect(next.draft.title).toBe("Series");
    expect(next.draft.style_prompt).toBe("x");
  });

  it("takes the server's cleaned list once the ignored text matches what was saved", () => {
    const d = toDraft(series());
    const typed = { ...d, ignore_text: "discord.gg/x\nDISCORD.GG/X" };
    // Vừa lưu xong: mốc = bản đã gửi; server gộp mục trùng.
    const next = adoptServer(state(typed, typed), toDraft(series({ ignore_text: ["discord.gg/x"] })), never);
    expect(next.draft.ignore_text).toBe("discord.gg/x");
  });

  it("keeps incomplete pronoun rows of the form near their place when the server sends new pairs", () => {
    const d = toDraft(series());
    const half = { ...rule({ speaker: "Seoyeon", address: "" }), origin: "user" as const };
    const empty = { speaker: "", listener: "", address: "", note: "", origin: "user" as const };
    const st = state({ ...d, pronoun_rules: [half, ...d.pronoun_rules, empty] }, d);
    const aiPair = { ...rule({ speaker: "Jiwoo", listener: "Minjun" }), origin: "ai" as const };
    const server = toDraft(series({ pronoun_rules: [{ ...rule(), origin: "user" }, aiPair] }));
    const next = adoptServer(st, server, never);
    expect(next.draft.pronoun_rules).toEqual([half, ...d.pronoun_rules, empty, aiPair]);
    expect(next.base.pronoun_rules).toEqual(server.pronoun_rules);
    // Server không có gì mới → không đổi gì (không render lại, không mất hàng thiếu).
    expect(adoptServer(next, server, never)).toBe(next);
  });

  it("only touches the listed fields", () => {
    const st = state(toDraft(series()));
    const next = adoptServer(st, toDraft(series({ title: "A", style_prompt: "B" })), never, ["title"]);
    expect([next.draft.title, next.draft.style_prompt]).toEqual(["A", ""]);
  });
});
