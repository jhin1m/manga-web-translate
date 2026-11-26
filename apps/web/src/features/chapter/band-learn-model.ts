/**
 * "Luôn cắt ở series này": kết quả học từng mép riêng (một mép lỗi không chặn mép kia), thông báo gộp và danh sách mép
 * đáng thử lại. Thuần, không đụng mạng.
 */
import { type MessageKey, t, tp } from "../../i18n/t.ts";
import { ApiError } from "../../lib/api.ts";

export type BandEdge = "top" | "bottom";

export type BandResult =
  | { edge: BandEdge; ok: true; learned: number; known: number }
  | { edge: BandEdge; ok: false; reason: string; retry: boolean };

const EDGE_LABEL: Record<BandEdge, MessageKey> = {
  top: "chapter.bandLearnModel.edge.top",
  bottom: "chapter.bandLearnModel.edge.bottom",
};
const edgeLabel = (edge: BandEdge) => t(EDGE_LABEL[edge]);

/** Mã lỗi server → lý do hiển thị. */
const REASON: Record<string, MessageKey> = {
  plain_image: "chapter.bandLearnModel.reason.plain_image",
  no_trim: "chapter.bandLearnModel.reason.no_trim",
  skip_images_full: "chapter.bandLearnModel.reason.skip_images_full",
  band_too_small: "chapter.bandLearnModel.reason.band_too_small",
  trim_changed: "chapter.bandLearnModel.reason.trim_changed",
  no_hash: "chapter.bandLearnModel.reason.no_hash",
  not_uploaded: "chapter.bandLearnModel.reason.not_uploaded",
};

/** Lỗi tạm (mạng, giải mã, 5xx, ảnh chưa tải xong) thử lại được; 4xx còn lại là kết luận của server, thử lại vẫn vậy. */
export function failedBand(edge: BandEdge, e: unknown): BandResult {
  if (!(e instanceof ApiError))
    return { edge, ok: false, reason: t("chapter.bandLearnModel.reason.unreadable"), retry: true };
  const code = typeof e.body.error === "string" ? e.body.error : "";
  const retry = e.status >= 500 || code === "not_uploaded";
  const known = Object.hasOwn(REASON, code) ? REASON[code] : undefined;
  const fallback = retry ? "chapter.bandLearnModel.reason.serverError" : "chapter.bandLearnModel.reason.serverRejected";
  return { edge, ok: false, reason: t(known ?? fallback), retry };
}

export function retryEdges(results: BandResult[]): BandEdge[] {
  return results.flatMap((r) => (!r.ok && r.retry ? [r.edge] : []));
}

const join = (xs: string[]) => xs.join(t("chapter.bandLearnModel.and"));
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Nội dung toast sau khi học: tất cả thành công giữ câu cũ; có mép lỗi thì nói rõ từng mép. */
export function bandSummary(results: BandResult[]): { text: string; tone: "info" | "danger" } {
  const failed = results.flatMap((r) => (r.ok ? [] : [r]));
  const oks = results.flatMap((r) => (r.ok ? [r] : []));
  if (!failed.length) {
    const learned = oks.reduce((n, r) => n + r.learned, 0);
    const known = oks.reduce((n, r) => n + r.known, 0);
    return {
      tone: "info",
      text: learned ? tp("chapter.bandLearnModel.learned", learned) : tp("chapter.bandLearnModel.known", known),
    };
  }
  const parts: string[] = [];
  const fresh = oks.filter((r) => r.learned > 0).map((r) => edgeLabel(r.edge));
  const had = oks.filter((r) => r.learned === 0).map((r) => edgeLabel(r.edge));
  if (fresh.length) parts.push(t("chapter.bandLearnModel.learnedEdges", { edges: join(fresh) }));
  if (had.length) parts.push(t("chapter.bandLearnModel.knownEdges", { edges: join(had) }));
  for (const r of failed) parts.push(`${edgeLabel(r.edge)}: ${r.reason}`);
  return { tone: "danger", text: `${upper(parts.join("; "))}.` };
}
