/** Font của workspace (khớp apps/api/src/routes/fonts.ts) + danh sách font gói sẵn từ /fonts/manifest.json. */
import { useQuery } from "@tanstack/react-query";
import { api, wsPath } from "../../lib/api.ts";

export const MAX_FONT_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_FONTS = 20;

export type WorkspaceFont = {
  /** `custom-<8 hex>` — dùng làm font_family / default_fonts. */
  id: string;
  name: string;
  bytes: number;
  units_per_em: number;
  ascent: number;
  descent: number;
  metrics_source: string;
  vi_complete: boolean;
  /** Chữ Việt font không có. */
  missing: string[];
  /** Presigned GET ngắn hạn; hết hạn lúc `url_expires_at`. */
  url: string;
  url_expires_at: string;
  created_at: string;
};

export const fontKeys = { list: (ws: string) => ["fonts", ws] as const, bundled: ["fonts", "bundled"] as const };

export const fetchFonts = (ws: string) => api<{ fonts: WorkspaceFont[] }>(wsPath(ws, "/fonts")).then((r) => r.fonts);

export const deleteFont = (ws: string, id: string) => api<void>(wsPath(ws, `/fonts/${id}`), { method: "DELETE" });

type UploadSlot = { key: string; url: string; fields: Record<string, string> };

/** Xin URL upload → POST thẳng lên storage → xác nhận với API (kiểm TTF/OTF, đọc metrics). */
export async function uploadFont(ws: string, file: File): Promise<WorkspaceFont> {
  const slot = await api<UploadSlot>(wsPath(ws, "/fonts/upload-url"), { method: "POST", body: { bytes: file.size } });
  const form = new FormData();
  for (const [k, v] of Object.entries(slot.fields)) form.append(k, v);
  form.append("file", file);
  const res = await fetch(slot.url, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload font thất bại (${res.status})`);
  return api<WorkspaceFont>(wsPath(ws, "/fonts"), { method: "POST", body: { key: slot.key } });
}

/** Font của workspace; URL sống 10 phút nên làm tươi định kỳ (editor chỉ cần URL lúc nạp font). */
export function useWorkspaceFonts(ws: string) {
  return useQuery({
    queryKey: fontKeys.list(ws),
    queryFn: () => fetchFonts(ws),
    staleTime: 5 * 60_000,
    refetchInterval: 8 * 60_000,
  });
}

/** Id font gói sẵn (manifest do sync-fonts chép từ worker/fonts). */
export function useBundledFontIds() {
  return useQuery({
    queryKey: fontKeys.bundled,
    queryFn: async () => {
      const res = await fetch("/fonts/manifest.json");
      if (!res.ok) throw new Error(`không tải được manifest font (${res.status})`);
      const m = (await res.json()) as { fonts: Record<string, unknown> };
      return Object.keys(m.fonts).sort();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Tên hiển thị gọn: "PatrickHand-Regular" → "PatrickHand"; font nhóm → tên trong file; chưa chọn → mặc định. */
export function fontLabel(id: string | undefined, custom: readonly WorkspaceFont[] = []): string {
  if (!id) return "Mặc định";
  return custom.find((f) => f.id === id)?.name ?? id.replace(/-(Regular|Variable|Bold)$/, "");
}
