/** Admin: provider / model / slot. Key không bao giờ rời API; xoá / sửa bị chặn khi còn dùng. */
import { aiProviders, jobs } from "@mtl/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../src/env.ts";
import { decryptSecret } from "../src/lib/secrets.ts";
import { call, db, seedAdmin, seedUser, uniq } from "./helpers.ts";

const KEY = "sk-live-AAAABBBBCCCCDDDD1234";
const NEW_KEY = "sk-live-ZZZZYYYYXXXXWWWW5678";
const MINI = { model_id: "gpt-4.1-mini", price_in: 0.4, price_out: 1.6, vision: true };

type Admin = Awaited<ReturnType<typeof seedAdmin>>;
type View = {
  id: string;
  type: string;
  base_url: string | null;
  key_last4: string;
  models: { id: string; model_id: string; vision: boolean }[];
};
let admin: Admin;

const as =
  (a: Admin) =>
  (path: string, method = "GET", body?: unknown) =>
    call(`/api/admin${path}`, { method, cookie: a.cookie, body });
let api: ReturnType<typeof as>;

beforeAll(async () => {
  admin = await seedAdmin("admin-prov");
  api = as(admin);
});

// seedAdmin đặt ADMIN_EMAILS và isolate-queue khôi phục sau mỗi ca → mỗi ca phải đặt lại.
const loginAdmin = () => {
  if (!env.ADMIN_EMAILS.includes(admin.email)) env.ADMIN_EMAILS.push(admin.email);
};

async function create(over: Record<string, unknown> = {}): Promise<View> {
  loginAdmin();
  const res = await api("/providers", "POST", {
    type: "openai",
    name: uniq("OpenAI"),
    api_key: KEY,
    models: [MINI, { model_id: "gpt-4o-mini", price_in: 0.15, price_out: 0.6, vision: false }],
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as View;
}

const model = (p: View, id: string) => {
  const m = p.models.find((x) => x.model_id === id);
  if (!m) throw new Error(`no model ${id}`);
  return m;
};

const insertActiveJob = async (llm: unknown, status: "queued" | "succeeded" = "queued") => {
  const u = await seedUser(uniq("jobowner"));
  await db.insert(jobs).values({
    userId: u.userId,
    type: "chapter.proofread",
    status,
    payload: { type: "chapter.proofread", llm } as never,
    inputRev: "r",
    idempotencyKey: uniq("llm-ref"),
    chapterId: u.chapterId,
  });
};

describe("create + list", () => {
  it("creates openai + compatible; responses never carry the key or its ciphertext", async () => {
    loginAdmin();
    const a = await create();
    const b = await create({
      type: "openai_compatible",
      base_url: "https://llm.example.com/v1/",
      structured_output: "json_object",
    });
    expect(a).toMatchObject({ type: "openai", base_url: null, key_last4: "1234" });
    expect(b).toMatchObject({ type: "openai_compatible", base_url: "https://llm.example.com/v1" });
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, a.id));
    expect(row?.apiKeyEnc).not.toContain(KEY);
    expect(decryptSecret(row?.apiKeyEnc ?? "", a.id)).toBe(KEY);

    const list = await api("/providers");
    const text = await list.text();
    expect(list.status).toBe(200);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY.slice(0, -4)); // chỉ last4
    expect(text).not.toContain("api_key");
    expect(text).not.toContain(row?.apiKeyEnc ?? "never");
    const parsed = JSON.parse(text) as { providers: View[]; secrets_configured: boolean };
    expect(parsed.secrets_configured).toBe(true);
    expect(parsed.providers.map((p) => p.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("invalid bodies → 400 and the key is not echoed back", async () => {
    loginAdmin();
    const bad = [
      { type: "openai_compatible", name: "x", api_key: KEY }, // thiếu base_url
      { type: "openai_compatible", name: "x", api_key: KEY, base_url: "http://llm.example.com/v1" },
      { type: "openai", name: "x", api_key: "sk-has space-1234" },
      { type: "nope", name: "", api_key: KEY },
      { type: "openai", name: "x", api_key: KEY, models: [{ model_id: "m", price_in: -1, price_out: 1 }] },
      { type: "openai", name: "x", api_key: KEY, models: [{ model_id: "m", price_in: 1 }] },
    ];
    for (const body of bad) {
      const res = await api("/providers", "POST", body);
      const text = await res.text();
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("has space");
    }
  });

  it("missing SECRETS_KEY → 409 secrets_key_missing on create and key change; list reports it", async () => {
    const p = await create();
    env.SECRETS_KEY = undefined;
    const res = await api("/providers", "POST", { type: "openai", name: "x", api_key: KEY });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "secrets_key_missing" });
    expect((await api(`/providers/${p.id}`, "PATCH", { api_key: NEW_KEY })).status).toBe(409);
    // Sửa tên không cần khoá.
    expect((await api(`/providers/${p.id}`, "PATCH", { name: "Đổi tên" })).status).toBe(200);
    const list = (await (await api("/providers")).json()) as { secrets_configured: boolean };
    expect(list.secrets_configured).toBe(false);
    // Kiểm tra cũng báo thiếu khoá thay vì ném 500.
    expect((await api(`/providers/${p.id}/test`, "POST", {})).status).toBe(409);
  });

  it("a regular user gets 403 on every provider route", async () => {
    const plain = await seedUser("prov-plain");
    for (const [method, path] of [
      ["GET", "/providers"],
      ["POST", "/providers"],
      ["PATCH", "/providers/x"],
      ["DELETE", "/models/x"],
      ["PUT", "/settings/slots"],
    ] as const) {
      const res = await call(`/api/admin${path}`, {
        method,
        cookie: plain.cookie,
        body: method === "GET" ? undefined : {},
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("update", () => {
  it("renames, changes key (new last4 + decryptable), type is immutable", async () => {
    const p = await create();
    const res = await api(`/providers/${p.id}`, "PATCH", {
      name: "Mới",
      api_key: NEW_KEY,
      structured_output: "json_object",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(NEW_KEY);
    expect(JSON.parse(text)).toMatchObject({ name: "Mới", key_last4: "5678", structured_output: "json_object" });
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, p.id));
    expect(decryptSecret(row?.apiKeyEnc ?? "", p.id)).toBe(NEW_KEY);
    expect((await api(`/providers/${p.id}`, "PATCH", { type: "gemini" })).status).toBe(400);
    expect(
      (await api(`/providers/${p.id}`, "PATCH", { base_url: "https://x.example.com/v1", api_key: NEW_KEY })).status,
    ).toBe(400);
  });

  it("changing base_url without a new key → 409 key_required; with a key → 200; same url needs no key", async () => {
    const p = await create({ type: "openai_compatible", base_url: "https://llm.example.com/v1" });
    const before = (await db.select().from(aiProviders).where(eq(aiProviders.id, p.id)))[0]?.apiKeyEnc;
    const denied = await api(`/providers/${p.id}`, "PATCH", { base_url: "https://evil.example.com/v1" });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ error: "key_required" });
    expect((await db.select().from(aiProviders).where(eq(aiProviders.id, p.id)))[0]).toMatchObject({
      baseUrl: "https://llm.example.com/v1",
      apiKeyEnc: before,
    });
    expect((await api(`/providers/${p.id}`, "PATCH", { base_url: "https://llm.example.com/v1/" })).status).toBe(200);
    const ok = await api(`/providers/${p.id}`, "PATCH", { base_url: "https://other.example.com/v1", api_key: NEW_KEY });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ base_url: "https://other.example.com/v1", key_last4: "5678" });
  });

  it("model_id is immutable; price/vision/reasoning editable; duplicate add → 409", async () => {
    const p = await create();
    const m = model(p, "gpt-4o-mini");
    expect((await api(`/models/${m.id}`, "PATCH", { model_id: "other" })).status).toBe(400);
    const res = await api(`/models/${m.id}`, "PATCH", { price_in: 0.2, vision: true, reasoning: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ model_id: "gpt-4o-mini", price_in: 0.2, vision: true, reasoning: true });
    expect((await api(`/models/${m.id}`, "PATCH", {})).status).toBe(200);
    expect((await api(`/models/${m.id}`, "PATCH", { price_out: -1 })).status).toBe(400);

    const added = await api(`/providers/${p.id}/models`, "POST", {
      model_id: "gpt-5-mini",
      price_in: 0.25,
      price_out: 2,
    });
    expect(added.status).toBe(201);
    const dup = await api(`/providers/${p.id}/models`, "POST", { model_id: "gpt-5-mini", price_in: 1, price_out: 1 });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "duplicate_model" });
  });

  it("unknown ids → 404", async () => {
    loginAdmin();
    const missing = "0194f6a0-0000-7000-8000-00000000dead";
    for (const [method, path] of [
      ["PATCH", `/providers/${missing}`],
      ["DELETE", `/providers/${missing}`],
      ["PATCH", `/models/${missing}`],
      ["DELETE", `/models/${missing}`],
      ["PATCH", "/providers/not-a-uuid"],
    ] as const) {
      expect(
        (
          await api(
            path,
            method,
            method === "PATCH" ? (path.includes("/models/") ? { price_in: 1 } : { name: "x" }) : undefined,
          )
        ).status,
        `${method} ${path}`,
      ).toBe(404);
    }
  });
});

describe("slots", () => {
  it("assigns models, GET /settings returns them, vision is enforced for ocr/proofread", async () => {
    const p = await create();
    const vision = model(p, "gpt-4.1-mini");
    const text = model(p, "gpt-4o-mini");
    const ok = await api("/settings/slots", "PUT", { ocr: vision.id, translate: text.id, proofread: vision.id });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ slots: { ocr: vision.id, translate: text.id, proofread: vision.id } });
    const settings = (await (await api("/settings")).json()) as { slots: unknown };
    expect(settings.slots).toEqual({ ocr: vision.id, translate: text.id, proofread: vision.id });

    for (const slot of ["ocr", "proofread"] as const) {
      const res = await api("/settings/slots", "PUT", { ocr: null, translate: null, proofread: null, [slot]: text.id });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "model_not_vision", slot });
    }
    const unknown = await api("/settings/slots", "PUT", {
      ocr: null,
      translate: "0194f6a0-0000-7000-8000-00000000dead",
      proofread: null,
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "model_not_found", slot: "translate" });
    // Lỗi không ghi dở: slot cũ còn nguyên.
    expect(((await (await api("/settings")).json()) as { slots: { ocr: string } }).slots.ocr).toBe(vision.id);
    expect((await api("/settings/slots", "PUT", { ocr: null, translate: null, proofread: null })).status).toBe(200);
    expect((await api("/settings/slots", "PUT", { ocr: null })).status).toBe(400);
  });

  it("assigned model/provider cannot be deleted (409 in_use + slot); vision=false on an assigned ocr model → 409", async () => {
    const p = await create();
    const vision = model(p, "gpt-4.1-mini");
    await api("/settings/slots", "PUT", { ocr: vision.id, translate: null, proofread: null });
    const delModel = await api(`/models/${vision.id}`, "DELETE");
    expect(delModel.status).toBe(409);
    expect(await delModel.json()).toEqual({ error: "in_use", slot: "ocr" });
    const delProv = await api(`/providers/${p.id}`, "DELETE");
    expect(delProv.status).toBe(409);
    expect(await delProv.json()).toEqual({ error: "in_use", slot: "ocr" });
    const unvision = await api(`/models/${vision.id}`, "PATCH", { vision: false });
    expect(unvision.status).toBe(409);
    expect(await unvision.json()).toEqual({ error: "in_use", slot: "ocr" });
    // Provider còn nguyên (không xoá dở model nào).
    const list = (await (await api("/providers")).json()) as { providers: View[] };
    expect(list.providers.find((x) => x.id === p.id)?.models).toHaveLength(2);

    await api("/settings/slots", "PUT", { ocr: null, translate: null, proofread: null });
    expect((await api(`/models/${vision.id}`, "DELETE")).status).toBe(204);
    expect((await api(`/providers/${p.id}`, "DELETE")).status).toBe(204);
  });
});

describe("active jobs", () => {
  it("an active job whose payload.llm references the provider blocks delete (provider and model); a finished one does not", async () => {
    const p = await create();
    const mini = model(p, "gpt-4.1-mini");
    const other = model(p, "gpt-4o-mini");
    await insertActiveJob({ translate: { provider_id: p.id, model: "gpt-4.1-mini" } }, "succeeded");
    expect((await api(`/models/${mini.id}`, "DELETE")).status).toBe(204);

    await insertActiveJob({
      translate: { provider_id: p.id, model: "gpt-4o-mini" },
      ocr: { provider_id: "x", model: "y" },
    });
    const blockedModel = await api(`/models/${other.id}`, "DELETE");
    expect(blockedModel.status).toBe(409);
    expect(await blockedModel.json()).toEqual({ error: "in_use_by_jobs", jobs: 1 });
    const blockedProvider = await api(`/providers/${p.id}`, "DELETE");
    expect(blockedProvider.status).toBe(409);
    expect(await blockedProvider.json()).toEqual({ error: "in_use_by_jobs", jobs: 1 });
  });

  it("jobs without payload.llm do not block deletion", async () => {
    const p = await create();
    await insertActiveJob(undefined);
    await insertActiveJob("not-an-object");
    expect((await api(`/providers/${p.id}`, "DELETE")).status).toBe(204);
  });
});

describe("test endpoint", () => {
  it("decrypts the stored key, calls the provider with it and returns only a classification", async () => {
    const p = await create();
    const seen: { url: string; auth?: string }[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      seen.push({ url: String(url), auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      return new Response(JSON.stringify({ data: [{ id: "gpt-4.1-mini" }], secret: KEY }), { status: 200 });
    });
    try {
      const res = await api(`/providers/${p.id}/test`, "POST", {});
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(JSON.parse(text)).toEqual({ ok: true, reason: "ok", http_status: 200, model_found: true });
      expect(text).not.toContain(KEY);
      expect(seen).toEqual([{ url: "https://api.openai.com/v1/models", auth: `Bearer ${KEY}` }]);
    } finally {
      spy.mockRestore();
    }
  });

  it("a blob that no longer decrypts (other SECRETS_KEY) → 409 key_unreadable, no leak", async () => {
    const p = await create();
    env.SECRETS_KEY = Buffer.alloc(32, 9).toString("base64");
    const res = await api(`/providers/${p.id}/test`, "POST", {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "key_unreadable" });
  });
});

describe("concurrency and logging", () => {
  it("racing PATCHes never pair a new key with a base_url that needs no key", async () => {
    const p = await create({ type: "openai_compatible", base_url: "https://a.example.com/v1" });
    const [x, y] = await Promise.all([
      api(`/providers/${p.id}`, "PATCH", { base_url: "https://b.example.com/v1", api_key: NEW_KEY }),
      api(`/providers/${p.id}`, "PATCH", { base_url: "https://a.example.com/v1/" }),
    ]);
    expect([x.status, y.status].every((s) => s === 200 || s === 409)).toBe(true);
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, p.id));
    // Key mới chỉ đi với host B; nếu base_url về lại A thì key phải là key cũ.
    if (row?.baseUrl === "https://a.example.com/v1") expect(row.keyLast4).toBe(KEY.slice(-4));
    else expect(row?.keyLast4).toBe(NEW_KEY.slice(-4));
  });

  it("add model to a provider that no longer exists → 404", async () => {
    const p = await create();
    expect((await api(`/providers/${p.id}`, "DELETE")).status).toBe(204);
    expect((await api(`/providers/${p.id}/models`, "POST", { model_id: "x", price_in: 1, price_out: 1 })).status).toBe(
      404,
    );
  });

  it("an unexpected DB failure returns 500 and logs neither ciphertext nor key material", async () => {
    loginAdmin();
    const logged: string[] = [];
    const spies = (["error", "warn", "info", "log"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logged.push(
          a.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : JSON.stringify(x))).join(" "),
        );
      }),
    );
    try {
      // NUL không lưu được vào text của Postgres → insert lỗi sau khi key đã mã hoá thành tham số câu lệnh.
      const res = await api("/providers", "POST", { type: "openai", name: "a\u0000b", api_key: KEY });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const out = logged.join("\n");
    expect(out).toContain("[admin-providers]");
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(KEY.slice(-4));
    expect(out).not.toMatch(/[A-Za-z0-9+/]{40,}/); // không có blob base64 (ciphertext)
    expect(out).not.toContain("api_key_enc");
  });
});
