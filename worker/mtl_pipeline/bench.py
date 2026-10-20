"""Bench golden set KO: recall/precision detect, CER OCR, tỉ lệ bịa crop rỗng, thời gian, chi phí → bench.csv
(theo tầng) + blind.html (so sánh mù bản dịch: mỗi provider × ngữ cảnh cuộn / không ngữ cảnh).

Cấu trúc golden (local, không commit — xem docs/benchmarks/phase-01-results.md):
  golden/images/*.png            slice KO strip
  golden/labels.json             COCO export từ Label Studio; tên category "<kind>:<tầng>" với kind ∈
                                 {text_bubble, text_free}, tầng ∈ {white, color, inverted, over_art};
                                 thêm "empty" (crop rỗng) và "sfx" (không tính recall, không tính là box thừa)
  golden/truth.jsonl             {"ann_id": int, "text": str} — OCR provider so sánh, owner sửa từng dòng
"""

from __future__ import annotations

import csv
import html
import json
import random
import statistics
import time
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import cv2

from .images import open_rgb, save_png
from .ocr import ocr_page
from .providers import make_provider
from .providers.base import LLMProvider, ProviderError, cost_usd
from .schema import BBox, OcrRequest, OcrResult, Region, TokenUsage, TranslateRequest, TranslateResult
from .textmask import estimate_polarity

TEXT_KINDS = ("text_bubble", "text_free")
MATCH_IOU = 0.5


@dataclass
class GtBox:
    ann_id: int
    image: str
    kind: str  # text_bubble | text_free | empty | sfx
    tier: str | None
    bbox: BBox


def load_coco(path: Path) -> list[GtBox]:
    data = json.loads(path.read_text())
    cats = {c["id"]: c["name"] for c in data["categories"]}
    images = {i["id"]: Path(i["file_name"]).name for i in data["images"]}
    out = []
    for a in data["annotations"]:
        name = cats[a["category_id"]]
        kind, _, tier = name.partition(":")
        x, y, w, h = (round(v) for v in a["bbox"])
        out.append(GtBox(a["id"], images[a["image_id"]], kind, tier or None, BBox(x=x, y=y, w=w, h=h)))
    return out


def iou(a: BBox, b: BBox) -> float:
    w = min(a.x2, b.x2) - max(a.x, b.x)
    h = min(a.y2, b.y2) - max(a.y, b.y)
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / (a.area() + b.area() - inter)


def greedy_match(gts: list[GtBox], preds: list[Region], thresh: float = MATCH_IOU) -> dict[int, Region]:
    """Khớp 1-1 theo IoU giảm dần → {ann_id: region}."""
    pairs = sorted(
        ((iou(g.bbox, p.bbox), gi, pi) for gi, g in enumerate(gts) for pi, p in enumerate(preds)),
        reverse=True,
    )
    used_g: set[int] = set()
    used_p: set[int] = set()
    out: dict[int, Region] = {}
    for v, gi, pi in pairs:
        if v < thresh:
            break
        if gi in used_g or pi in used_p:
            continue
        used_g.add(gi)
        used_p.add(pi)
        out[gts[gi].ann_id] = preds[pi]
    return out


def match_image(gts: list[GtBox], preds: list[Region]) -> dict[int, Region]:
    """text_bubble ↔ text_bubble trước; text_free ↔ phần còn lại (detector hay lẫn 2 lớp); sfx ↔ phần còn lại
    (để box SFX không bị tính là box thừa)."""
    texts = [p for p in preds if p.kind in TEXT_KINDS]
    out = greedy_match(
        [g for g in gts if g.kind == "text_bubble"], [p for p in texts if p.kind == "text_bubble"]
    )
    for kind in ("text_free", "sfx"):
        used = {p.id for p in out.values()}
        out |= greedy_match([g for g in gts if g.kind == kind], [p for p in texts if p.id not in used])
    return out


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def norm_text(s: str) -> str:
    return "".join(unicodedata.normalize("NFC", s).split())


def cer(pairs: list[tuple[str, str]]) -> float:
    """CER gộp: Σ edit(pred, truth) / Σ len(truth), bỏ khoảng trắng."""
    total = sum(len(norm_text(t)) for _, t in pairs)
    if total == 0:
        return 0.0
    return sum(levenshtein(norm_text(p), norm_text(t)) for p, t in pairs) / total


def row(metric: str, value: float, n: int, provider: str = "-", tier: str = "all") -> dict:
    return {"metric": metric, "provider": provider, "tier": tier, "value": value, "n": n}


def detection_rows(gts: list[GtBox], preds_by_image: dict[str, list[Region]]) -> list[dict]:
    """Recall theo lớp × tầng (khớp IoU 1-1) + precision vùng chữ (box SFX khớp GT sfx không tính là thừa)."""
    hits: dict[tuple[str, str], list[bool]] = defaultdict(list)
    n_pred = n_pred_matched = 0
    for image, preds in preds_by_image.items():
        g_img = [g for g in gts if g.image == image]
        m = match_image(g_img, preds)
        for g in g_img:
            if g.kind not in TEXT_KINDS:
                continue
            hit = g.ann_id in m
            hits[(g.kind, "all")].append(hit)
            if g.tier:
                hits[(g.kind, g.tier)].append(hit)
        matched = {p.id for p in m.values()}
        texts = [p for p in preds if p.kind in TEXT_KINDS]
        n_pred += len(texts)
        n_pred_matched += sum(1 for p in texts if p.id in matched)
    rows = [
        row(f"recall_{k}", round(sum(v) / len(v), 4), len(v), tier=t) for (k, t), v in sorted(hits.items())
    ]
    rows.append(row("precision_text", round(n_pred_matched / n_pred, 4) if n_pred else 0.0, n_pred))
    return rows


def p50(values: list[float]) -> float:
    return round(statistics.median(values), 3) if values else 0.0


@dataclass
class RetryingProvider:
    """Bench trả tiền thật: chờ theo retry_after (hoặc backoff) khi rate_limit/provider tạm thời thay vì mất cả lượt."""

    inner: LLMProvider
    max_tries: int = 6
    waited_s: float = field(default=0.0)

    @property
    def name(self) -> str:
        return self.inner.name

    @property
    def model(self) -> str:
        return self.inner.model

    def _call(self, fn, req):
        for attempt in range(self.max_tries):
            try:
                return fn(req)
            except ProviderError as e:
                if e.error_class == "schema" or not e.retryable or attempt == self.max_tries - 1:
                    raise
                wait = e.retry_after if e.retry_after is not None else min(60.0, 2.0 * 2**attempt)
                self.waited_s += wait
                time.sleep(wait)
        raise AssertionError("unreachable")

    def ocr_page(self, req: OcrRequest) -> OcrResult:
        return self._call(self.inner.ocr_page, req)

    def translate_batch(self, req: TranslateRequest) -> TranslateResult:
        return self._call(self.inner.translate_batch, req)


def gt_regions(img_gray, gts: list[GtBox]) -> list[Region]:
    """Box GT → Region (id = g<ann_id>) để OCR thẳng trên crop GT, tách lỗi OCR khỏi lỗi detect."""
    out = []
    for g in gts:
        b = g.bbox
        crop = img_gray[b.y : b.y2, b.x : b.x2]
        pol = estimate_polarity(crop) if crop.size else "dark_on_light"
        out.append(Region(id=f"g{g.ann_id}", kind="text_bubble", bbox=b, score=1.0, polarity=pol))
    return out


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["metric", "provider", "tier", "value", "n"])
        w.writeheader()
        w.writerows(rows)


def run_bench(golden: Path, out: Path, providers: list[str]) -> None:
    from .pipeline import Pipeline, list_pages, translate_dir, write_regions
    from .translate import SeriesSettings

    out.mkdir(parents=True, exist_ok=True)
    pages_dir = out / "pages"
    gts = load_coco(golden / "labels.json")
    truth = {
        int(j["ann_id"]): j["text"]
        for j in (
            json.loads(line) for line in (golden / "truth.jsonl").read_text().splitlines() if line.strip()
        )
    }
    pipe = Pipeline()
    pages = list_pages(golden / "images")
    rows: list[dict] = []

    # Giai đoạn 1 không LLM: chạy 1 lần (tuần tự để đo thời gian sạch), dùng chung cho mọi provider.
    preds: dict[str, list[Region]] = {}
    t_local: dict[str, float] = {}
    for i, p in enumerate(pages):
        img = open_rgb(p)
        regions, mask, clean, timing = pipe.prepare_image(img)
        d = pages_dir / p.stem
        d.mkdir(parents=True, exist_ok=True)
        save_png(clean, d / "clean.png")
        save_png(mask, d / "mask.png")
        write_regions(d, regions, img.shape[1], img.shape[0], i, p.name)
        preds[p.name], t_local[p.name] = regions, timing.stage1_no_llm
    rows += detection_rows(gts, preds)
    rows.append(row("stage1_local_p50_s", p50(list(t_local.values())), len(t_local)))
    write_csv(out / "bench.csv", rows)

    for name in providers:
        provider = RetryingProvider(make_provider(name))
        pipeline_usage: list[TokenUsage] = []  # OCR trên box detect + dịch ngữ cảnh cuộn = chi phí thật/trang
        extra_usage: list[TokenUsage] = []  # OCR crop GT, crop rỗng, nhánh không ngữ cảnh (chỉ để đo)
        t_stage1: list[float] = []
        gt_pairs: dict[str, list[tuple[str, str]]] = defaultdict(list)
        e2e_pairs: list[tuple[str, str]] = []
        for i, p in enumerate(pages):
            img = open_rgb(p)
            g_img = [g for g in gts if g.image == p.name and g.kind in TEXT_KINDS and g.ann_id in truth]
            t = time.perf_counter()
            res = ocr_page(provider, img, preds[p.name], i)
            t_stage1.append(t_local[p.name] + time.perf_counter() - t)
            pipeline_usage += res.usage
            (pages_dir / p.stem / f"ocr.{name}.json").write_text(res.model_dump_json(indent=2))
            # CER end-to-end: chỉ GT đã được detect (trượt detect đã tính ở recall).
            by_id = {it.id: it.source for it in res.items}
            for ann_id, r in match_image(g_img, preds[p.name]).items():
                e2e_pairs.append((by_id.get(r.id, ""), truth[ann_id]))
            # CER OCR thuần: OCR thẳng crop GT.
            if g_img:
                gres = ocr_page(provider, img, gt_regions(cv2.cvtColor(img, cv2.COLOR_RGB2GRAY), g_img), i)
                extra_usage += gres.usage
                gby = {it.id: it.source for it in gres.items}
                for g in g_img:
                    pair = (gby.get(f"g{g.ann_id}", ""), truth[g.ann_id])
                    gt_pairs["all"].append(pair)
                    if g.tier:
                        gt_pairs[g.tier].append(pair)
        for tier, pairs in sorted(gt_pairs.items()):
            rows.append(row("ocr_cer", round(cer(pairs), 4), len(pairs), name, tier))
        rows.append(row("e2e_cer", round(cer(e2e_pairs), 4), len(e2e_pairs), name))
        rows.append(row("stage1_p50_s", p50(t_stage1), len(t_stage1), name))

        # Bịa trên crop rỗng: gửi thẳng box GT "empty" (bỏ qua detector).
        empties = [g for g in gts if g.kind == "empty"]
        halluc = 0
        for g in empties:
            img = open_rgb(golden / "images" / g.image)
            res = ocr_page(provider, img, gt_regions(cv2.cvtColor(img, cv2.COLOR_RGB2GRAY), [g]), 0)
            extra_usage += res.usage
            halluc += any(not it.empty and it.source.strip() for it in res.items)
        rate = round(halluc / len(empties), 4) if empties else 0.0
        rows.append(row("empty_hallucination_rate", rate, len(empties), name))

        # Giai đoạn 2: nhánh ngữ cảnh cuộn + nhánh không ngữ cảnh (đối chứng), dùng OCR của chính provider.
        for p in pages:
            d = pages_dir / p.stem
            (d / "ocr.json").write_text((d / f"ocr.{name}.json").read_text())
        n_pages = max(1, len(pages))
        for mode in ("rolling", "none"):
            translate_dir(pages_dir, provider, SeriesSettings(), mode, suffix=f".{name}.{mode}")
            raw = json.loads((pages_dir / f"translate_usage.{name}.{mode}.json").read_text())
            tu = [TokenUsage.model_validate(u) for u in raw]
            (pipeline_usage if mode == "rolling" else extra_usage).extend(tu)
            rows.append(
                row(f"translate_cost_usd_per_page_{mode}", round(cost_usd(tu) / n_pages, 6), len(pages), name)
            )
        # Gate chi phí: OCR trên box detect + dịch ngữ cảnh cuộn, token đo thật.
        rows += [
            row(
                "llm_cost_usd_per_page_total", round(cost_usd(pipeline_usage) / n_pages, 6), len(pages), name
            ),
            row(
                "tokens_in_per_page",
                round(sum(u.input_tokens for u in pipeline_usage) / n_pages),
                len(pages),
                name,
            ),
            row(
                "tokens_out_per_page",
                round(sum(u.output_tokens for u in pipeline_usage) / n_pages),
                len(pages),
                name,
            ),
            row("bench_extra_cost_usd", round(cost_usd(extra_usage), 4), 0, name),
            row("rate_limit_wait_s", round(provider.waited_s, 1), 0, name),
        ]
        write_csv(out / "bench.csv", rows)

    write_blind_html(pages_dir, providers, out)


def write_blind_html(pages_dir: Path, providers: list[str], out: Path, seed: int = 7) -> None:
    """HTML chấm mù: mỗi vùng hiện các bản dịch đã xáo (ẩn provider/nhánh), kèm câu nguồn mà CHÍNH biến thể đó
    đọc được (OCR mỗi provider có thể khác); khoá giải mã ở blind_key.json."""
    rng = random.Random(seed)
    variants = [(p, m) for p in providers for m in ("rolling", "none")]
    key: dict[str, dict[str, str]] = {}
    rows_html = []
    for d in sorted(p for p in pages_dir.iterdir() if p.is_dir()):
        states = {}
        for prov, mode in variants:
            f = d / f"state.{prov}.{mode}.json"
            if f.is_file():
                states[(prov, mode)] = json.loads(f.read_text())
        if not states:
            continue
        ids = list(dict.fromkeys(o["id"] for st in states.values() for o in st["ocr"]))
        for rid in ids:
            opts = []
            for (prov, mode), st in states.items():
                src = next((o["source"] for o in st["ocr"] if o["id"] == rid), "")
                tr = next((t["translation"] for t in st["translations"] if t["id"] == rid), "")
                opts.append((f"{prov}.{mode}", src, tr))
            rng.shuffle(opts)
            qid = f"{d.name}/{rid}"
            key[qid] = {chr(65 + i): v for i, (v, _, _) in enumerate(opts)}
            cells = "".join(
                f"<li><b>{chr(65 + i)}</b> {html.escape(t)} <small>(nguồn: {html.escape(s)})</small> "
                f"<select data-q='{html.escape(qid)}' data-o='{chr(65 + i)}'>"
                + "".join(f"<option>{v}</option>" for v in ("", "1", "2", "3", "4", "5"))
                + "</select></li>"
                for i, (_, s, t) in enumerate(opts)
            )
            rows_html.append(f"<section><h3>{html.escape(qid)}</h3><ol>{cells}</ol></section>")
    (out / "blind_key.json").write_text(json.dumps(key, ensure_ascii=False, indent=2))
    script = (
        "document.getElementById('dl').onclick=()=>{const r={};document.querySelectorAll('select').forEach(s=>"
        "{if(s.value)(r[s.dataset.q]??={})[s.dataset.o]=+s.value});const a=document.createElement('a');"
        "a.href=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)]));a.download='blind_scores.json';a.click()}"
    )
    (out / "blind.html").write_text(
        "<!doctype html><meta charset='utf-8'><title>Chấm mù bản dịch</title>"
        "<style>body{font:16px system-ui;max-width:900px;margin:auto;padding:16px}section{border-bottom:1px solid #ccc}"
        "</style><h1>Chấm mù 1–5</h1><button id='dl'>Tải điểm (JSON)</button>"
        + "".join(rows_html)
        + f"<script>{script}</script>",
        encoding="utf-8",
    )
